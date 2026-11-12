import {
  createProject,
  createThread,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import {
  assertIxProjectAccess,
  assertIxThreadAccess,
  createIxAccessStore,
  filterIxThreads,
  filterIxThreadsById,
  ixThreadListScope,
  ixThreadOversightOnly,
  restrictedScopeFor,
  runWithIxRequestAccess,
  setIxThreadPointLookupBudget,
  type IxAccessStore,
} from "./access.js";
import type { IxActor } from "./context.js";
import { createIxKv } from "./kv.js";

const POINT = 1_000_000;
const VIEW = 0;
afterEach(() => setIxThreadPointLookupBudget(8));

type Role = "member" | "admin" | "owner";
const person = (id: string, role: Role = "member"): IxActor => ({
  kind: "user",
  user: { id, email: `${id}@example.test`, name: id },
  organizationId: "org",
  memberId: `m-${id}`,
  role,
});

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

interface Row {
  id: string;
  projectId: string;
}

function randomWorld(seed: number) {
  const random = rng(seed);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)] as T;
  const db: DbConnection = createMigratedConnection();
  const store = createIxAccessStore(db, createIxKv(db));
  const host = upsertHost(db, noopNotifier, { name: "Test" });
  const projects = ["alpha", "beta", "gamma"].map(
    (name) =>
      createProject(db, noopNotifier, {
        name,
        source: {
          type: "local_path",
          hostId: host.id,
          path: `/tmp/${name}-${seed}`,
        },
      }).project.id,
  );
  const allProjects = [...projects, PERSONAL_PROJECT_ID];
  const users = ["ana", "ben", "cy", "dee"];
  const rows: Row[] = [];
  for (let i = 0; i < 36; i += 1) {
    const parent = rows.length > 0 && random() < 0.45 ? pick(rows) : null;
    const projectId =
      parent !== null && random() < 0.8 ? parent.projectId : pick(allProjects);
    const thread = createThread(db, noopNotifier, {
      projectId,
      providerId: "codex",
      status: "pending",
      ...(parent === null ? {} : { parentThreadId: parent.id }),
    });
    rows.push({ id: thread.id, projectId: thread.projectId });
    if (random() < 0.85) store.recordThreadOwner(thread.id, pick(users));
    const shareRoll = random();
    if (shareRoll < 0.3) store.setThreadShare(thread.id, "private");
    else if (shareRoll < 0.55) store.setThreadShare(thread.id, "project");
    else if (shareRoll < 0.8) store.setThreadShare(thread.id, "workspace");
    if (random() < 0.2) store.addThreadMember(thread.id, pick(users), null);
  }
  for (let i = 0; i < 3; i += 1)
    db.$client
      .prepare(
        "INSERT OR IGNORE INTO ix_thread_member (thread_id, user_id, added_by, added_at) VALUES (?, ?, NULL, 1)",
      )
      .run(pick(rows).id, pick(users));
  const ghosts: Row[] = [];
  for (const share of ["private", "project", "workspace"] as const) {
    const id = `thr_ghost_${share}_${seed}`;
    db.$client
      .prepare(
        "INSERT INTO ix_thread_owner (thread_id, user_id, created_at) VALUES (?, ?, 1)",
      )
      .run(id, pick(users));
    store.setThreadShare(id, share);
    ghosts.push({ id, projectId: pick(allProjects) });
  }
  const orphanRoot = `thr_orphan_root_${seed}`;
  db.$client.exec("PRAGMA foreign_keys = OFF");
  const orphanChild = createThread(db, noopNotifier, {
    projectId: pick(projects),
    providerId: "codex",
    status: "pending",
  });
  db.$client
    .prepare("UPDATE threads SET parent_thread_id = ? WHERE id = ?")
    .run(orphanRoot, orphanChild.id);
  db.$client.exec("PRAGMA foreign_keys = ON");
  store.recordThreadOwner(orphanChild.id, pick(users));
  store.setThreadShare(orphanChild.id, "private");
  db.$client
    .prepare(
      "INSERT INTO ix_thread_member (thread_id, user_id, added_by, added_at) VALUES (?, ?, NULL, 1)",
    )
    .run(orphanRoot, pick(users));
  rows.push({ id: orphanChild.id, projectId: orphanChild.projectId });

  if (random() < 0.5) store.setMode("restricted");
  for (const user of users)
    for (const project of projects) {
      const roll = random();
      if (roll < 0.35) store.setGrant(user, project, "read");
      else if (roll < 0.6) store.setGrant(user, project, "write");
    }
  const adminsSeeAll = random() < 0.5;
  store.setSharingPolicy({ ...store.sharingPolicy(), adminsSeeAll });
  const actors: IxActor[] = [
    person("ana"),
    person("ben"),
    person("cy", "admin"),
    person("dee"),
    person("root", "owner"),
  ];
  return { db, store, rows: [...rows, ...ghosts], actors };
}

interface Decision {
  byId: boolean;
  byRow: boolean;
  read: string;
  write: string;
  oversight: boolean;
  projectAfterRead: string;
}

const outcome = (fn: () => void): string => {
  try {
    fn();
    return "ok";
  } catch (error) {
    if (error instanceof ApiError) return `${error.status}:${error.body.code}`;
    throw error;
  }
};

async function decide(
  store: IxAccessStore,
  actor: IxActor,
  row: Row,
): Promise<Decision> {
  const inRequest = <T>(method: string, fn: () => T) =>
    runWithIxRequestAccess(
      actor,
      store,
      restrictedScopeFor(actor, store, method),
      async () => fn(),
      method !== "GET",
    );
  const byId = await inRequest(
    "GET",
    () => filterIxThreadsById([row]).length === 1,
  );
  const byRow = await inRequest(
    "GET",
    () => filterIxThreads([row]).length === 1,
  );
  const oversight = await inRequest("GET", () => ixThreadOversightOnly(row.id));
  let projectAfterRead = "";
  const read = await inRequest("GET", () =>
    outcome(() => {
      assertIxThreadAccess(row);
      projectAfterRead = outcome(() => assertIxProjectAccess(row.projectId));
    }),
  );
  const write = await inRequest("POST", () =>
    outcome(() => assertIxThreadAccess(row)),
  );
  return { byId, byRow, read, write, oversight, projectAfterRead };
}

describe("ix access: point lookups agree with the whole view", () => {
  it("threadAccessFacts equals membership in the hidden / shared / member sets", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const w = randomWorld(seed);
      for (const userId of ["ana", "ben", "cy", "dee", "nobody"]) {
        for (const visible of [
          () => true,
          (projectId: string) =>
            projectId.charCodeAt(projectId.length - 1) % 2 === 0,
        ]) {
          const hidden = w.store.hiddenThreadsFor(userId, visible);
          const shared = w.store.sharedThreadsFor(userId, visible);
          const members = w.store.memberThreadsFor(userId);
          for (const row of w.rows) {
            expect(
              w.store.threadAccessFacts(row.id, userId, visible),
              `seed ${seed} ${userId} ${row.id}`,
            ).toEqual({
              hidden: hidden.has(row.id),
              shared: shared.has(row.id),
              member: members.has(row.id),
            });
          }
        }
      }
    }
  });

  it("every request-level decision is identical on both paths (randomized workspaces)", async () => {
    let compared = 0;
    let denied = 0;
    for (let seed = 101; seed <= 115; seed += 1) {
      const w = randomWorld(seed);
      for (const actor of w.actors) {
        for (const row of w.rows) {
          setIxThreadPointLookupBudget(VIEW);
          const viaView = await decide(w.store, actor, row);
          setIxThreadPointLookupBudget(POINT);
          const viaPoint = await decide(w.store, actor, row);
          expect(
            viaPoint,
            `seed ${seed} ${actor.kind === "user" ? actor.user.id : "?"} ${row.id}`,
          ).toEqual(viaView);
          compared += 1;
          if (!viaView.byRow) denied += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(1500);
    expect(denied).toBeGreaterThan(200);
    expect(compared - denied).toBeGreaterThan(200);
  });

  it("mixing point lookups and the view inside one request gives the view's answers", async () => {
    setIxThreadPointLookupBudget(3);
    for (let seed = 201; seed <= 210; seed += 1) {
      const w = randomWorld(seed);
      for (const actor of w.actors) {
        const scope = () => restrictedScopeFor(actor, w.store, "GET");
        const expected = await runWithIxRequestAccess(
          actor,
          w.store,
          scope(),
          async () => {
            setIxThreadPointLookupBudget(VIEW);
            return filterIxThreads(w.rows).map((row) => row.id);
          },
        );
        setIxThreadPointLookupBudget(3);
        const mixed = await runWithIxRequestAccess(
          actor,
          w.store,
          scope(),
          async () => {
            for (const row of w.rows.slice(0, 5))
              outcome(() => assertIxThreadAccess(row));
            return filterIxThreads(w.rows).map((row) => row.id);
          },
        );
        expect(mixed).toEqual(expected);
      }
    }
  });
});

describe("ix access: hidden and forbidden chats stay hidden on the point path", () => {
  function world() {
    const db: DbConnection = createMigratedConnection();
    const store = createIxAccessStore(db, createIxKv(db));
    const host = upsertHost(db, noopNotifier, { name: "Test" });
    const project = (name: string) =>
      createProject(db, noopNotifier, {
        name,
        source: { type: "local_path", hostId: host.id, path: `/tmp/${name}` },
      }).project;
    const thread = (
      projectId: string,
      owner: string,
      share: "private" | "project" | "workspace",
      parentThreadId?: string,
    ) => {
      const created = createThread(db, noopNotifier, {
        projectId,
        providerId: "codex",
        status: "pending",
        ...(parentThreadId === undefined ? {} : { parentThreadId }),
      });
      store.recordThreadOwner(created.id, owner);
      store.setThreadShare(created.id, share);
      return { id: created.id, projectId: created.projectId };
    };
    const open = (actor: IxActor, row: Row, method = "GET") =>
      runWithIxRequestAccess(
        actor,
        store,
        restrictedScopeFor(actor, store, method),
        async () => outcome(() => assertIxThreadAccess(row)),
        method !== "GET",
      );
    return { db, store, project, thread, open };
  }

  it("someone else's private chat answers 404 by id, for members and admins alike", async () => {
    setIxThreadPointLookupBudget(POINT);
    const w = world();
    const p = w.project("alpha");
    const t = w.thread(p.id, "ana", "private");
    expect(await w.open(person("ana"), t)).toBe("ok");
    expect(await w.open(person("ben"), t)).toBe("404:thread_not_found");
    expect(await w.open(person("root", "owner"), t)).toBe(
      "404:thread_not_found",
    );
    const child = w.thread(p.id, "ana", "private", t.id);
    expect(await w.open(person("ben"), child)).toBe("404:thread_not_found");
  });

  it("restricted members cannot open shared chats in projects they were not granted", async () => {
    setIxThreadPointLookupBudget(POINT);
    const w = world();
    const a = w.project("alpha");
    const b = w.project("beta");
    w.store.setMode("restricted");
    w.store.setGrant("ben", a.id, "read");
    const inA = w.thread(a.id, "ana", "workspace");
    const inB = w.thread(b.id, "ana", "workspace");
    expect(await w.open(person("ben"), inA)).toBe("ok");
    expect(await w.open(person("ben"), inA, "POST")).toBe(
      "403:ix_project_read_only",
    );
    expect(await w.open(person("ben"), inB)).toBe("404:thread_not_found");
    const projectChat = w.thread(b.id, "ana", "project");
    expect(await w.open(person("ben"), projectChat)).toBe(
      "404:thread_not_found",
    );
  });

  it("people added to a chat reach it and its sub-chats, nobody else does", async () => {
    setIxThreadPointLookupBudget(POINT);
    const w = world();
    const a = w.project("alpha");
    w.store.setMode("restricted");
    const root = w.thread(a.id, "ana", "private");
    const sub = w.thread(a.id, "ana", "private", root.id);
    w.store.addThreadMember(root.id, "ben", "ana");
    expect(await w.open(person("ben"), root)).toBe("ok");
    expect(await w.open(person("ben"), sub)).toBe("ok");
    expect(await w.open(person("cy"), root)).toBe("404:thread_not_found");
    expect(await w.open(person("cy"), sub)).toBe("404:thread_not_found");
  });

  it("admin oversight stays read-only on the point path", async () => {
    setIxThreadPointLookupBudget(POINT);
    const w = world();
    const a = w.project("alpha");
    const t = w.thread(a.id, "ana", "private");
    w.store.setSharingPolicy({
      ...w.store.sharingPolicy(),
      adminsSeeAll: true,
    });
    expect(await w.open(person("root", "owner"), t)).toBe("ok");
    expect(await w.open(person("root", "owner"), t, "POST")).toBe(
      "403:ix_oversight_read_only",
    );
    expect(await w.open(person("ben"), t)).toBe("404:thread_not_found");
  });

  it("answers are memoized per request only: a share change shows on the next request", async () => {
    setIxThreadPointLookupBudget(POINT);
    const w = world();
    const a = w.project("alpha");
    const t = w.thread(a.id, "ana", "workspace");
    expect(await w.open(person("ben"), t)).toBe("ok");
    w.store.setThreadShare(t.id, "private");
    expect(await w.open(person("ben"), t)).toBe("404:thread_not_found");
    w.store.setThreadShare(t.id, "workspace");
    expect(await w.open(person("ben"), t)).toBe("ok");
  });

  it("concurrent requests by different people never see each other's answers", async () => {
    setIxThreadPointLookupBudget(POINT);
    const w = world();
    const a = w.project("alpha");
    const t = w.thread(a.id, "ana", "private");
    const ana = person("ana");
    const ben = person("ben");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const anaRequest = runWithIxRequestAccess(ana, w.store, null, async () => {
      const first = outcome(() => assertIxThreadAccess(t));
      await gate;
      return [first, outcome(() => assertIxThreadAccess(t))];
    });
    const benRequest = runWithIxRequestAccess(ben, w.store, null, async () => {
      const first = outcome(() => assertIxThreadAccess(t));
      release();
      await Promise.resolve();
      return [first, outcome(() => assertIxThreadAccess(t))];
    });
    expect(await anaRequest).toEqual(["ok", "ok"]);
    expect(await benRequest).toEqual([
      "404:thread_not_found",
      "404:thread_not_found",
    ]);
  });

  it("list scope sends hidden chats to SQL as an exclusion for unrestricted people", async () => {
    const w = world();
    const a = w.project("alpha");
    const hidden = w.thread(a.id, "ana", "private");
    const open = w.thread(a.id, "ana", "workspace");
    const scope = await runWithIxRequestAccess(
      person("ben"),
      w.store,
      null,
      async () => ixThreadListScope(undefined),
    );
    expect(scope.threadIds).toBeUndefined();
    expect(scope.excludeThreadIds).toContain(hidden.id);
    expect(scope.excludeThreadIds).not.toContain(open.id);
    const own = await runWithIxRequestAccess(
      person("ana"),
      w.store,
      null,
      async () => ixThreadListScope(undefined),
    );
    expect(own).toEqual({});
    w.store.setMode("restricted");
    w.store.setGrant("ben", a.id, "read");
    const restricted = await runWithIxRequestAccess(
      person("ben"),
      w.store,
      restrictedScopeFor(person("ben"), w.store, "GET"),
      async () => ixThreadListScope(undefined),
    );
    expect(restricted.excludeThreadIds).toBeUndefined();
    expect(restricted.threadIds).toEqual([open.id]);
  });
});
