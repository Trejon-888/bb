import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  createIxAccessStore,
  restrictedScopeFor,
  runWithIxRequestAccess,
  type IxAccessStore,
} from "../../src/ix/access.js";
import { registerThreadBaseRoutes } from "../../src/routes/threads/base.js";
import type { IxActor } from "../../src/ix/context.js";
import { createIxKv } from "../../src/ix/kv.js";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function listIds(
  harness: TestAppHarness,
  query: string,
): Promise<string[]> {
  const response = await harness.app.request(`/api/v1/threads${query}`);
  expect(response.status).toBe(200);
  return ((await readJson(response)) as Array<{ id: string }>).map(
    (thread) => thread.id,
  );
}

function signedIn(
  harness: TestAppHarness,
  store: IxAccessStore,
  actor: IxActor,
  restricted: boolean,
) {
  const app = new Hono();
  app.use("*", (context, next) =>
    runWithIxRequestAccess(
      actor,
      store,
      restricted ? restrictedScopeFor(actor, store, "GET") : null,
      () => next(),
      false,
    ),
  );
  registerThreadBaseRoutes(app, harness.deps);
  return async (query: string): Promise<string[]> => {
    const response = await app.request(`/threads${query}`);
    expect(response.status).toBe(200);
    return ((await readJson(response)) as Array<{ id: string }>).map(
      (thread) => thread.id,
    );
  };
}

const member = (id: string): IxActor => ({
  kind: "user",
  user: { id, email: `${id}@example.test`, name: id },
  organizationId: "org",
  memberId: `m-${id}`,
  role: "member",
});

function seedTimeline(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps, {
    id: "host-thread-list-sort",
  });
  const alpha = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    name: "alpha",
    path: "/tmp/thread-list-sort-alpha",
  }).project;
  const beta = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    name: "beta",
    path: "/tmp/thread-list-sort-beta",
  }).project;
  const set = harness.db.$client.prepare(
    "UPDATE threads SET created_at = ?, updated_at = ?, latest_attention_at = ? WHERE id = ?",
  );
  const spec = [
    { project: alpha.id, created: 1, updated: 50, activity: 30 },
    { project: beta.id, created: 2, updated: 10, activity: 60 },
    { project: alpha.id, created: 3, updated: 40, activity: 10 },
    { project: beta.id, created: 4, updated: 30, activity: 20 },
    { project: alpha.id, created: 5, updated: 20, activity: 50 },
    { project: beta.id, created: 6, updated: 60, activity: 40 },
  ];
  const ids = spec.map((row) => {
    const thread = seedThread(harness.deps, { projectId: row.project });
    set.run(row.created, row.updated, row.activity, thread.id);
    return thread.id;
  });
  const by = (key: "created" | "updated" | "activity") =>
    spec
      .map((row, index) => ({ id: ids[index] as string, at: row[key] }))
      .sort((a, b) => b.at - a.at)
      .map((row) => row.id);
  return { alpha, beta, ids, by };
}

describe("GET /threads sort + limit", () => {
  it("sorts newest first in SQL and limits/offsets the sorted list", async () => {
    await withTestHarness(async (harness) => {
      const { by } = seedTimeline(harness);
      for (const sort of ["created", "updated", "activity"] as const) {
        expect(await listIds(harness, `?sort=${sort}`)).toEqual(by(sort));
        expect(await listIds(harness, `?sort=${sort}&limit=2`)).toEqual(
          by(sort).slice(0, 2),
        );
        expect(
          await listIds(harness, `?sort=${sort}&limit=2&offset=3`),
        ).toEqual(by(sort).slice(3, 5));
      }
      const response = await harness.app.request("/api/v1/threads?sort=oldest");
      expect(response.status).toBe(400);
    });
  });

  it("keeps the grouped default order when no sort is given", async () => {
    await withTestHarness(async (harness) => {
      const { alpha, beta, ids } = seedTimeline(harness);
      const listed = await listIds(harness, "");
      const projectOf = new Map(
        ids.map((id, index) => [id, index % 2 === 0 ? alpha.id : beta.id]),
      );
      const projects = listed.map((id) => projectOf.get(id));
      expect(projects).toEqual([...projects].sort());
    });
  });

  it("limits after access filtering: a restricted member's page is full and only holds what they may see", async () => {
    await withTestHarness(async (harness) => {
      const { alpha, beta, ids, by } = seedTimeline(harness);
      const store = createIxAccessStore(harness.db, createIxKv(harness.db));
      store.setMode("restricted");
      store.setGrant("ben", beta.id, "read");
      for (const id of ids) {
        store.recordThreadOwner(id, "ben");
        store.setThreadShare(id, "private");
      }
      const ben = member("ben");
      const visible = by("created").filter((id) => ids.indexOf(id) % 2 === 1);
      expect(visible.length).toBe(3);
      const asBen = signedIn(harness, store, ben, true);
      expect(await asBen("?sort=created")).toEqual(visible);
      expect(await asBen("?sort=created&limit=2")).toEqual(visible.slice(0, 2));
      expect(await asBen("?sort=created&limit=2&offset=1")).toEqual(
        visible.slice(1, 3),
      );
      expect(alpha.id).not.toBe(beta.id);
    });
  });

  it("never returns someone else's private chat to an unrestricted member, with or without a limit", async () => {
    await withTestHarness(async (harness) => {
      const { ids, by } = seedTimeline(harness);
      const store = createIxAccessStore(harness.db, createIxKv(harness.db));
      ids.forEach((id, index) => {
        store.recordThreadOwner(id, index < 3 ? "ana" : "ben");
        store.setThreadShare(id, index === 0 ? "workspace" : "private");
      });
      const ben = member("ben");
      const expected = by("updated").filter(
        (id) => ids.indexOf(id) === 0 || ids.indexOf(id) >= 3,
      );
      const asBen = signedIn(harness, store, ben, false);
      expect(await asBen("?sort=updated")).toEqual(expected);
      expect(await asBen("?sort=updated&limit=3")).toEqual(
        expected.slice(0, 3),
      );
      expect(await asBen("?sort=updated&limit=10")).toEqual(expected);
      const unsorted = await asBen("");
      expect(new Set(unsorted)).toEqual(new Set(expected));
    });
  });
});
