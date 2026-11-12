import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { Hono } from "hono";
import { createThread } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertIxThreadAccess,
  createIxAccessStore,
  restrictedScopeFor,
  runWithIxRequestAccess,
  setIxThreadPointLookupBudget,
  type IxAccessStore,
} from "../../src/ix/access.js";
import { ApiError } from "../../src/errors.js";
import type { IxActor } from "../../src/ix/context.js";
import { createIxKv } from "../../src/ix/kv.js";
import { registerPluginRoutes } from "../../src/routes/plugins.js";
import { registerThreadBaseRoutes } from "../../src/routes/threads/base.js";
import { createPluginInstallJobs } from "../../src/services/plugins/plugin-install-jobs.js";
import { createPluginUpdateJobs } from "../../src/services/plugins/plugin-update-jobs.js";
import type { PluginService } from "../../src/services/plugins/plugin-service.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const enabled = process.env.CORE_PERF_BENCH === "1";
const results: string[] = [];
afterAll(() => {
  if (results.length === 0) return;
  const out = process.env.CORE_PERF_BENCH_OUT;
  if (out !== undefined && out !== "")
    writeFileSync(out, `${results.join("\n")}\n`);
  else process.stdout.write(`\n${results.join("\n")}\n`);
  setIxThreadPointLookupBudget(8);
});

const member = (id: string, role: "member" | "admin" = "member"): IxActor => ({
  kind: "user",
  user: { id, email: `${id}@example.test`, name: id },
  organizationId: "org",
  memberId: `m-${id}`,
  role,
});

async function time(
  label: string,
  iterations: number,
  run: () => Promise<unknown> | unknown,
): Promise<number> {
  for (let i = 0; i < Math.min(20, iterations); i += 1) await run();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    await run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)] as number;
  results.push(
    `${label.padEnd(64)} median ${median.toFixed(3)} ms  p90 ${(samples[Math.floor(samples.length * 0.9)] as number).toFixed(3)} ms  (n=${iterations})`,
  );
  return median;
}

function seedWorkspace(harness: TestAppHarness, store: IxAccessStore) {
  const { host } = seedHostSession(harness.deps, { id: "host-perf" });
  const projects = Array.from(
    { length: 12 },
    (_, i) =>
      seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: `p${i}`,
        path: `/tmp/perf-${i}`,
      }).project.id,
  );
  const people = ["ana", "ben", "cy", "dee", "eve", "fay", "gus", "hal"];
  const set = harness.db.$client.prepare(
    "UPDATE threads SET created_at = ?, updated_at = ?, latest_attention_at = ? WHERE id = ?",
  );
  const visible: Array<{ id: string; projectId: string }> = [];
  harness.db.$client.exec("BEGIN");
  for (let i = 0; i < 1_500; i += 1) {
    const projectId = projects[i % projects.length] as string;
    const root = createThread(harness.db, harness.deps.hub, {
      projectId,
      providerId: "codex",
      status: "idle",
      title: `Chat ${i}`,
    });
    set.run(i, (i * 7919) % 100_000, (i * 104_729) % 100_000, root.id);
    const owner = people[i % people.length] as string;
    store.recordThreadOwner(root.id, owner);
    store.setThreadShare(
      root.id,
      i % 10 < 5 ? "private" : i % 10 < 8 ? "project" : "workspace",
    );
    visible.push({ id: root.id, projectId });
    const worker = createThread(harness.db, harness.deps.hub, {
      projectId,
      providerId: "codex",
      status: "idle",
      parentThreadId: root.id,
      visibility: "hidden",
    });
    store.recordThreadOwner(worker.id, owner);
    store.setThreadShare(worker.id, store.threadShare(root.id));
  }
  harness.db.$client.exec("COMMIT");
  for (let i = 0; i < 40; i += 1)
    store.addThreadMember(
      (visible[i * 31] as { id: string }).id,
      people[(i + 3) % people.length] as string,
      null,
    );
  return { projects, visible };
}

function signedIn(
  harness: TestAppHarness,
  store: IxAccessStore,
  actor: IxActor,
) {
  const app = new Hono();
  app.use("*", (context, next) =>
    runWithIxRequestAccess(
      actor,
      store,
      restrictedScopeFor(actor, store, "GET"),
      () => next(),
      false,
    ),
  );
  registerThreadBaseRoutes(app, harness.deps);
  return app;
}

describe.skipIf(!enabled)(
  "perf: thread access, thread list, plugin list",
  () => {
    it("measures before/after on a synthetic 1,500-chat workspace", async () => {
      await withTestHarness(async (harness) => {
        const store = createIxAccessStore(harness.db, createIxKv(harness.db));
        const { projects, visible } = seedWorkspace(harness, store);
        results.push(
          `workspace: ${visible.length} visible chats + ${visible.length} hidden worker chats, ${projects.length} projects`,
        );

        const target = visible[770] as { id: string; projectId: string };
        for (const [who, actor, restricted] of [
          ["unrestricted member", member("ben"), false],
          ["admin", member("cy", "admin"), false],
          ["restricted member", member("dee"), true],
        ] as const) {
          if (restricted) {
            store.setMode("restricted");
            for (const projectId of projects.slice(0, 6))
              store.setGrant("dee", projectId, "read");
          }
          const open = () =>
            runWithIxRequestAccess(
              actor,
              store,
              restrictedScopeFor(actor, store, "GET"),
              async () => {
                try {
                  assertIxThreadAccess(target);
                } catch (error) {
                  if (!(error instanceof ApiError)) throw error;
                }
              },
              false,
            );
          setIxThreadPointLookupBudget(0);
          const before = await time(
            `open one chat, ${who}: whole view (before)`,
            300,
            open,
          );
          setIxThreadPointLookupBudget(8);
          const after = await time(
            `open one chat, ${who}: point lookups (after)`,
            300,
            open,
          );
          results.push(`  -> ${(before / after).toFixed(1)}x`);
          if (restricted) store.setMode("open");
        }

        const app = signedIn(harness, store, member("ben"));
        let fullBytes = 0;
        let pageBytes = 0;
        const before = await time(
          "last 10 chats: GET /threads, all rows (before)",
          40,
          async () => {
            const text = await (await app.request("/threads")).text();
            fullBytes = text.length;
            (JSON.parse(text) as Array<{ updatedAt: number }>)
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 10);
          },
        );
        const after = await time(
          "last 10 chats: GET /threads?sort=updated&limit=10 (after)",
          200,
          async () => {
            const text = await (
              await app.request("/threads?sort=updated&limit=10")
            ).text();
            pageBytes = text.length;
          },
        );
        results.push(
          `  -> ${(before / after).toFixed(1)}x, response ${(fullBytes / 1024).toFixed(0)} KiB -> ${(pageBytes / 1024).toFixed(1)} KiB`,
        );
        const viaClient = (
          JSON.parse(await (await app.request("/threads")).text()) as Array<{
            id: string;
            updatedAt: number;
          }>
        )
          .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1))
          .slice(0, 10)
          .map((t) => t.id);
        const viaServer = (
          JSON.parse(
            await (await app.request("/threads?sort=updated&limit=10")).text(),
          ) as Array<{ id: string }>
        ).map((t) => t.id);
        expect(viaServer).toEqual(viaClient);
      });

      const plugin = (i: number) => ({
        id: `plugin-${i}`,
        source: `git:https://github.com/example/plugin-${i}`,
        rootDir: `/srv/data/plugins/cache/plugin-${i}`,
        version: "1.2.3",
        provenance: "catalog",
        publisherLabel: "BB Official",
        sourceDisplay: `git · github.com/example/plugin-${i} · tracking main`,
        updateState: { lastCheckAt: 1_700_000_000_000 },
        enabled: true,
        description: `BB plugin number ${i} that adds tools to your BB agents and threads.`,
        name: `BB Plugin ${i}`,
        screenshots: [],
        collections: [],
        icon: "puzzle",
        iconUrl: `/api/v1/plugins/plugin-${i}/assets/icon.svg`,
        status: "running",
        statusDetail: null,
        handlerStats: {
          count: i * 13,
          totalMs: i * 7,
          maxMs: 40,
          errorCount: 0,
        },
        services: [{ name: "worker", state: "running" }],
        schedules: [],
        cliCommand: { name: `p${i}`, summary: "Do things with BB" },
        capabilities: Array.from({ length: 6 }, (_, k) => ({
          kind: "agent-tool",
          id: `tool_${k}`,
          label: `tool_${k}`,
          detail: "Tool this plugin adds to your BB agents",
        })),
        hasSettings: true,
        app: { hasApp: true, bundle: null },
        logoUrl: null,
        logoDarkUrl: null,
        providerIds: [],
        icons: {},
      });
      const build = () => Array.from({ length: 170 }, (_, i) => plugin(i));
      const routes = (service: PluginService) => {
        const api = new Hono();
        registerPluginRoutes(
          api,
          { config: { serverPort: 3334 }, db: createMigratedConnection() },
          service,
          createPluginInstallJobs({ notifyChanged: () => {} }),
          createPluginUpdateJobs({ notifyChanged: () => {} }),
        );
        return api;
      };
      const legacy = routes({ list: build } as unknown as PluginService);
      const current = routes({
        list: build,
        listRevision: () => "1:1",
      } as unknown as PluginService);
      const beforePlugins = await time(
        "GET /plugins x170: build + JSON every call (before)",
        300,
        async () => (await legacy.request("/plugins")).text(),
      );
      const afterPlugins = await time(
        "GET /plugins x170: reused answer within 1 s (after)",
        300,
        async () => (await current.request("/plugins")).text(),
      );
      results.push(
        `  -> ${(beforePlugins / afterPlugins).toFixed(1)}x per reused call (list() itself on ACRE is ~3 ms more, also skipped on reuse)`,
      );
      expect(await (await current.request("/plugins")).json()).toEqual(
        await (await legacy.request("/plugins")).json(),
      );
    }, 600_000);
  },
);
