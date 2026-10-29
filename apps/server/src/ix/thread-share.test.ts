import { createProject, createThread, noopNotifier, upsertHost, type DbConnection } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import {
  assertIxThreadAccess,
  createIxAccessStore,
  filterIxThreads,
  ixScopedThreadIds,
  ixSocketAccessFilter,
  noteIxThreadCreated,
  restrictedScopeFor,
  runWithIxRequestAccess,
} from "./access.js";
import type { IxActor } from "./context.js";
import { createIxKv } from "./kv.js";

const person = (id: string, role: "member" | "admin" | "owner" = "member"): IxActor => ({ kind: "user", user: { id, email: `${id}@example.test`, name: id }, organizationId: "org", memberId: `m-${id}`, role });

function world() {
  const db: DbConnection = createMigratedConnection();
  const store = createIxAccessStore(db, createIxKv(db));
  const host = upsertHost(db, noopNotifier, { name: "Test" });
  const project = (name: string) => createProject(db, noopNotifier, { name, source: { type: "local_path", hostId: host.id, path: `/tmp/${name}` } }).project;
  const start = async (actor: IxActor, projectId: string) => runWithIxRequestAccess(actor, store, restrictedScopeFor(actor, store, "POST"), async () => {
    const thread = createThread(db, noopNotifier, { projectId, providerId: "codex", status: "pending" });
    noteIxThreadCreated(thread);
    return thread;
  });
  const sees = async (actor: IxActor, thread: { id: string; projectId: string }) => runWithIxRequestAccess(actor, store, restrictedScopeFor(actor, store, "GET"), async () => {
    const listed = filterIxThreads([thread]).length === 1;
    let opened = true;
    try { assertIxThreadAccess(thread); } catch (error) { if (error instanceof ApiError && error.status === 404) opened = false; else throw error; }
    const scoped = ixScopedThreadIds(undefined);
    expect(listed).toBe(opened);
    if (scoped !== undefined) expect(scoped.includes(thread.id)).toBe(opened);
    return opened;
  });
  return { db, store, project, start, sees };
}

describe("thread sharing: private / project / workspace", () => {
  it("keeps new chats private to their owner — admins included — until shared", async () => {
    const w = world(); const p = w.project("alpha");
    const ana = person("ana"); const ben = person("ben"); const root = person("root", "owner");
    const t = await w.start(ana, p.id);
    expect(w.store.threadShare(t.id)).toBe("private");
    expect(await w.sees(ana, t)).toBe(true);
    expect(await w.sees(ben, t)).toBe(false);
    expect(await w.sees(root, t)).toBe(false);
    w.store.setThreadShare(t.id, "workspace");
    expect(await w.sees(ben, t)).toBe(true);
    expect(await w.sees(root, t)).toBe(true);
  });

  it("project sharing follows project access when the workspace is restricted", async () => {
    const w = world(); const a = w.project("alpha");
    const ana = person("ana"); const ben = person("ben"); const cy = person("cy");
    w.store.setMode("restricted");
    w.store.setGrant("ana", a.id, "write"); w.store.setGrant("ben", a.id, "read");
    const t = await w.start(ana, a.id);
    w.store.setThreadShare(t.id, "project");
    expect(await w.sees(ben, t)).toBe(true);
    expect(await w.sees(cy, t)).toBe(false);
    w.store.setThreadShare(t.id, "workspace");
    expect(await w.sees(cy, t)).toBe(false);
  });

  it("existing chats keep today's visibility; the workspace default applies to new ones", async () => {
    const db = createMigratedConnection(); const kv = createIxKv(db);
    db.$client.exec("CREATE TABLE IF NOT EXISTS ix_thread_owner (thread_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL)");
    db.$client.prepare("INSERT INTO ix_thread_owner (thread_id, user_id, created_at) VALUES ('thr_old', 'ana', 1)").run();
    const store = createIxAccessStore(db, kv);
    expect(store.threadShare("thr_old")).toBe("workspace");
    store.setDefaultThreadShare("project");
    expect(store.defaultThreadShare()).toBe("project");
  });

  it("live updates hide other people's private chats, admins included", async () => {
    const w = world(); const p = w.project("alpha");
    const ana = person("ana"); const root = person("root", "admin");
    const t = await w.start(ana, p.id);
    const forRoot = ixSocketAccessFilter(w.db, w.store, root);
    expect(forRoot?.canSeeThread(t.id)).toBe(false);
    expect(ixSocketAccessFilter(w.db, w.store, ana)?.canSeeThread(t.id)).toBe(true);
    w.store.setThreadShare(t.id, "project");
    expect(forRoot?.canSeeThread(t.id)).toBe(true);
  });

  it("sub-agent chats inherit their parent's sharing", async () => {
    const w = world(); const p = w.project("alpha");
    const ana = person("ana");
    const parent = await w.start(ana, p.id);
    w.store.setThreadShare(parent.id, "workspace");
    const child = await runWithIxRequestAccess(ana, w.store, null, async () => {
      const thread = createThread(w.db, noopNotifier, { projectId: p.id, providerId: "codex", status: "pending", parentThreadId: parent.id });
      noteIxThreadCreated(thread);
      return thread;
    });
    expect(w.store.threadShare(child.id)).toBe("workspace");
  });
});
