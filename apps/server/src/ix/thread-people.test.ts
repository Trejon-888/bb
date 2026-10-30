import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, createThread, getThread, noopNotifier, upsertHost, type DbConnection } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import { TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY } from "../request-context.js";
import {
  allowIxChatProjectRead,
  assertIxProjectAccess,
  assertIxThreadAccess,
  filterIxProjects,
  filterIxThreads,
  ixScopedThreadIds,
  ixSocketAccessFilter,
  noteIxThreadCreated,
  noteIxTurnRequested,
  noteIxTurnSender,
  runWithIxRequestAccess,
} from "./access.js";
import { createIxAuthService, type IxAuthService } from "./auth-service.js";
import { readIxAuthConfig, type IxRole } from "./config.js";
import { getIxActor } from "./context.js";
import { ixApiGate } from "./middleware.js";
import { createIxRoutes } from "./routes.js";
import { IX_TEST_BASE, cookieOf, json } from "./test-harness.js";

const noopLogger = { debug() {}, error() {}, info() {}, warn() {} };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

interface Person { cookie: string; userId: string }
type ThreadRow = { id: string; projectId: string };

async function world() {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-ix-people-test-"));
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
  const db: DbConnection = createMigratedConnection();
  const ixAuth: IxAuthService = await createIxAuthService({
    db,
    dataDir,
    logger: noopLogger,
    config: readIxAuthConfig({ BB_IX_AUTH: "team", BB_IX_AUTH_ORG_NAME: "Acme", BB_IX_AUTH_BOOTSTRAP_EMAIL: "owner@example.test", BB_IX_AUTH_BOOTSTRAP_PASSWORD: "password-1" }, IX_TEST_BASE),
  });
  await ixAuth.ensureReady();
  const threads: ThreadRow[] = [];
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.set(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY, "203.0.113.9");
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof ApiError) return context.json(error.body, error.status);
    throw error;
  });
  app.route("/api/ix", createIxRoutes({ ixAuth, db }));
  const api = new Hono();
  api.use("*", ixApiGate({ ixAuth }));
  const load = (id: string) => {
    const thread = getThread(db, id);
    if (thread === null) throw new ApiError(404, "thread_not_found", "Thread not found");
    return thread;
  };
  api.get("/threads", (context) => context.json({ ids: filterIxThreads(threads.map((t) => load(t.id))).map((t) => t.id), scoped: ixScopedThreadIds(undefined) ?? null }));
  api.get("/projects", (context) => context.json({ ids: filterIxProjects(projectRows).map((p) => p.id) }));
  api.get("/threads/:id", (context) => {
    const thread = load(context.req.param("id"));
    assertIxThreadAccess(thread);
    return context.json({ id: thread.id });
  });
  api.get("/projects/:id/attachment", (context) => {
    allowIxChatProjectRead(context.req.param("id"));
    assertIxProjectAccess(context.req.param("id"));
    return context.json({ ok: true });
  });
  api.get("/projects/:id", (context) => {
    assertIxProjectAccess(context.req.param("id"));
    return context.json({ ok: true });
  });
  api.post("/threads/:id/send", (context) => {
    const thread = load(context.req.param("id"));
    assertIxThreadAccess(thread);
    assertIxProjectAccess(thread.projectId);
    noteIxTurnSender(thread.id);
    const sequence = Number(context.req.query("seq") ?? "1");
    noteIxTurnRequested(thread.id, sequence, "user");
    return context.json({ ok: true });
  });
  app.route("/api/v1", api);

  const request = async (person: Person | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { origin: IX_TEST_BASE };
    if (person !== null) headers.cookie = person.cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  const signIn = async (email: string, password: string): Promise<Person> => {
    const response = await app.request("/api/ix/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const body = await json(response);
    const actor = body.actor as { user: { id: string } };
    return { cookie: cookieOf(response), userId: actor.user.id };
  };
  const owner = await signIn("owner@example.test", "password-1");
  const enroll = async (name: string, role: IxRole = "member"): Promise<Person> => {
    const invite = await request(owner, "POST", "/api/ix/members/invite", { email: `${name}@example.test`, role });
    const invitation = (await json(invite)).invitation as { id: string };
    const accept = await app.request("/api/ix/invitations/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: invitation.id, name, password: "password-9" }) });
    const body = await json(accept);
    return { cookie: cookieOf(accept), userId: body.userId as string };
  };
  const host = upsertHost(db, noopNotifier, { name: "Test" });
  const projectRows: Array<{ id: string }> = [];
  const project = (name: string) => {
    const created = createProject(db, noopNotifier, { name, source: { type: "local_path", hostId: host.id, path: `/tmp/${name}` } }).project;
    projectRows.push({ id: created.id });
    return created;
  };
  const start = async (by: Person, projectId: string, parentThreadId?: string): Promise<ThreadRow> => {
    const actor = { kind: "user" as const, user: { id: by.userId, email: "x@example.test", name: "x" }, organizationId: "org", memberId: "m", role: "member" as const };
    const thread = await runWithIxRequestAccess(actor, ixAuth.access, null, async () => {
      const created = createThread(db, noopNotifier, { projectId, providerId: "codex", status: "pending", ...(parentThreadId === undefined ? {} : { parentThreadId }) });
      noteIxThreadCreated(created);
      return created;
    });
    threads.push(thread);
    return thread;
  };
  const opens = async (person: Person, thread: ThreadRow) => (await request(person, "GET", `/api/v1/threads/${thread.id}`)).status;
  const listed = async (person: Person) => ((await json(await request(person, "GET", "/api/v1/threads"))).ids as string[]);
  const share = async (person: Person, thread: ThreadRow) => json(await request(person, "GET", `/api/ix/threads/${thread.id}/share`));
  const add = (person: Person, thread: ThreadRow, ...people: Person[]) => request(person, "POST", `/api/ix/threads/${thread.id}/people`, { userIds: people.map((p) => p.userId) });
  const policy = async (patch: Record<string, unknown>) => {
    const current = (await json(await request(owner, "GET", "/api/ix/sharing-policy"))).policy as Record<string, unknown>;
    const response = await request(owner, "PUT", "/api/ix/sharing-policy", { ...current, ...patch });
    expect(response.status).toBe(200);
  };
  const socket = (person: Person, role: IxRole = "member") => ixSocketAccessFilter(db, ixAuth.access, { kind: "user", user: { id: person.userId, email: "s@example.test", name: "s" }, organizationId: "org", memberId: "m", role });
  return { db, ixAuth, owner, enroll, project, start, opens, listed, share, add, policy, request, socket, getIxActor };
}

describe("chat people", () => {
  it("an added person sees, opens, sends and gets live updates; others still don't", async () => {
    const w = await world(); const p = w.project("alpha");
    const ana = await w.enroll("ana"); const ben = await w.enroll("ben"); const cy = await w.enroll("cy");
    const t = await w.start(ana, p.id);
    expect(await w.opens(ben, t)).toBe(404);
    expect(w.socket(ben)?.canSeeThread(t.id)).toBe(false);
    const added = await w.add(ana, t, ben);
    expect(added.status).toBe(200);
    expect(((await json(added)).people as Array<{ id: string }>).map((x) => x.id)).toEqual([ben.userId]);
    expect(await w.opens(ben, t)).toBe(200);
    expect(await w.listed(ben)).toContain(t.id);
    expect(w.socket(ben)?.canSeeThread(t.id)).toBe(true);
    expect((await w.request(ben, "POST", `/api/v1/threads/${t.id}/send`)).status).toBe(200);
    expect(await w.opens(cy, t)).toBe(404);
    expect(await w.listed(cy)).not.toContain(t.id);
    expect(w.socket(cy)?.canSeeThread(t.id)).toBe(false);
    const view = await w.share(ben, t);
    expect(view).toMatchObject({ member: true, canLeave: true, canChange: false, canAdd: false });
  });

  it("a restricted member added to a chat in a project they lack sees only that chat", async () => {
    const w = await world(); const p = w.project("alpha");
    const ana = await w.enroll("ana"); const ben = await w.enroll("ben");
    w.ixAuth.access.setMode("restricted");
    w.ixAuth.access.setGrant(ana.userId, p.id, "write");
    const t = await w.start(ana, p.id); const other = await w.start(ana, p.id);
    w.ixAuth.access.setThreadShare(other.id, "project");
    expect(await w.opens(ben, t)).toBe(404);
    await w.add(ana, t, ben);
    expect(await w.opens(ben, t)).toBe(200);
    expect(await w.opens(ben, other)).toBe(404);
    expect(await w.listed(ben)).toEqual([t.id]);
    expect((await json(await w.request(ben, "GET", "/api/v1/threads"))).scoped).toEqual([t.id]);
    expect((await json(await w.request(ben, "GET", "/api/v1/projects"))).ids).toEqual([p.id]);
    expect((await w.request(ben, "GET", `/api/v1/projects/${p.id}`)).status).toBe(404);
    expect((await w.request(ben, "GET", `/api/v1/projects/${p.id}/attachment`)).status).toBe(200);
    const q = w.project("beta");
    expect((await w.request(ben, "GET", `/api/v1/projects/${q.id}/attachment`)).status).toBe(404);
    expect((await w.request(ben, "POST", `/api/v1/threads/${t.id}/send`)).status).toBe(200);
    expect(w.socket(ben)?.canSeeThread(t.id)).toBe(true);
    expect(w.socket(ben)?.canSeeThread(other.id)).toBe(false);
  });

  it("sub-agent chats follow the root chat's people, and leaving drops access everywhere", async () => {
    const w = await world(); const p = w.project("alpha");
    const ana = await w.enroll("ana"); const ben = await w.enroll("ben");
    const root = await w.start(ana, p.id);
    await w.add(ana, root, ben);
    const child = await w.start(ana, p.id, root.id);
    const grandchild = await w.start(ana, p.id, child.id);
    expect(await w.opens(ben, child)).toBe(200);
    expect(await w.opens(ben, grandchild)).toBe(200);
    expect(w.socket(ben)?.canSeeThread(grandchild.id)).toBe(true);
    expect(((await w.share(ana, child)).people as Array<{ id: string }>).map((x) => x.id)).toEqual([ben.userId]);
    const left = await w.request(ben, "DELETE", `/api/ix/threads/${child.id}/people/${ben.userId}`);
    expect(left.status).toBe(200);
    expect(await w.opens(ben, root)).toBe(404);
    expect(await w.opens(ben, grandchild)).toBe(404);
    expect(w.socket(ben)?.canSeeThread(child.id)).toBe(false);
  });

  it("only the starter adds and removes people by default; added people can add others when allowed", async () => {
    const w = await world(); const p = w.project("alpha");
    const ana = await w.enroll("ana"); const ben = await w.enroll("ben"); const cy = await w.enroll("cy");
    const t = await w.start(ana, p.id);
    await w.add(ana, t, ben);
    expect((await w.add(ben, t, cy)).status).toBe(403);
    expect((await w.request(ben, "DELETE", `/api/ix/threads/${t.id}/people/${cy.userId}`)).status).toBe(403);
    await w.policy({ participantsCanAdd: true });
    expect((await w.add(ben, t, cy)).status).toBe(200);
    expect(await w.opens(cy, t)).toBe(200);
    expect((await w.request(ben, "DELETE", `/api/ix/threads/${t.id}/people/${cy.userId}`)).status).toBe(403);
    expect((await w.request(ana, "DELETE", `/api/ix/threads/${t.id}/people/${cy.userId}`)).status).toBe(200);
    expect(await w.opens(cy, t)).toBe(404);
    expect((await w.request(ana, "POST", `/api/ix/threads/${t.id}/people`, { userIds: ["nobody"] })).status).toBe(404);
  });
});

describe("sharing policy", () => {
  it("is readable by members and writable by admins only, and validates the default", async () => {
    const w = await world();
    const ana = await w.enroll("ana");
    const read = await json(await w.request(ana, "GET", "/api/ix/sharing-policy"));
    expect(read.policy).toEqual({ defaultShare: "private", allowedShares: ["private", "project", "workspace", "people"], whoCanChange: "starter", participantsCanAdd: false, adminsSeeAll: false });
    expect((await w.request(ana, "PUT", "/api/ix/sharing-policy", read.policy)).status).toBe(403);
    const bad = await w.request(w.owner, "PUT", "/api/ix/sharing-policy", { ...(read.policy as object), defaultShare: "workspace", allowedShares: ["private"] });
    expect(bad.status).toBe(400);
    await w.policy({ defaultShare: "project", allowedShares: ["project", "people"] });
    expect(w.ixAuth.access.defaultThreadShare()).toBe("project");
    const p = w.project("alpha");
    const t = await w.start(ana, p.id);
    expect(w.ixAuth.access.threadShare(t.id)).toBe("project");
  });

  it("allowedShares rejects choices members may not pick; admins are not limited", async () => {
    const w = await world(); const p = w.project("alpha");
    const ana = await w.enroll("ana"); const adam = await w.enroll("adam", "admin");
    await w.policy({ allowedShares: ["private", "project"] });
    const t = await w.start(ana, p.id);
    expect((await w.request(ana, "PUT", `/api/ix/threads/${t.id}/share`, { share: "workspace" })).status).toBe(403);
    expect((await w.request(ana, "PUT", `/api/ix/threads/${t.id}/share`, { share: "project" })).status).toBe(200);
    expect((await w.add(ana, t, adam)).status).toBe(403);
    expect((await w.share(ana, t)).allowedShares).toEqual(["private", "project"]);
    await w.policy({ allowedShares: ["people"] });
    expect((await w.request(ana, "PUT", `/api/ix/threads/${t.id}/share`, { share: "private" })).status).toBe(200);
    expect((await w.add(ana, t, adam)).status).toBe(200);
    await w.policy({ whoCanChange: "starter_and_admins" });
    expect((await w.request(adam, "PUT", `/api/ix/threads/${t.id}/share`, { share: "workspace" })).status).toBe(200);
  });

  it("whoCanChange: starter, starter_and_admins, participants", async () => {
    const w = await world(); const p = w.project("alpha");
    const ana = await w.enroll("ana"); const ben = await w.enroll("ben"); const adam = await w.enroll("adam", "admin");
    const t = await w.start(ana, p.id);
    await w.add(ana, t, ben);
    await w.request(ana, "PUT", `/api/ix/threads/${t.id}/share`, { share: "workspace" });
    const change = (person: Person, share: string) => w.request(person, "PUT", `/api/ix/threads/${t.id}/share`, { share }).then((r) => r.status);
    expect(await change(ben, "project")).toBe(403);
    expect(await change(adam, "project")).toBe(403);
    expect((await w.share(adam, t)).reason).toBe("Only the person who started this chat can change who sees it.");
    await w.policy({ whoCanChange: "starter_and_admins" });
    expect(await change(ben, "project")).toBe(403);
    expect(await change(adam, "project")).toBe(200);
    await w.policy({ whoCanChange: "participants" });
    expect(await change(ben, "workspace")).toBe(200);
    expect((await w.share(ben, t)).canAdd).toBe(true);
    expect(await change(ana, "private")).toBe(200);
  });

  it("adminsSeeAll lets owners and admins read any chat but not write to it", async () => {
    const w = await world(); const p = w.project("alpha");
    const ana = await w.enroll("ana"); const adam = await w.enroll("adam", "admin"); const ben = await w.enroll("ben");
    const t = await w.start(ana, p.id);
    expect(await w.opens(adam, t)).toBe(404);
    expect(w.socket(adam, "admin")?.canSeeThread(t.id)).toBe(false);
    await w.policy({ adminsSeeAll: true });
    expect(await w.opens(adam, t)).toBe(200);
    expect(await w.opens(w.owner, t)).toBe(200);
    expect(await w.listed(adam)).toContain(t.id);
    expect(w.socket(adam, "admin")?.canSeeThread(t.id)).toBe(true);
    expect((await w.request(adam, "POST", `/api/v1/threads/${t.id}/send`)).status).toBe(403);
    expect(await w.opens(ben, t)).toBe(404);
    expect(w.socket(ben)?.canSeeThread(t.id)).toBe(false);
    await w.policy({ whoCanChange: "participants" });
    expect((await w.request(adam, "PUT", `/api/ix/threads/${t.id}/share`, { share: "workspace" })).status).toBe(403);
  });
});

describe("message senders", () => {
  it("records who sent each user turn and reports them once a chat has more than one person", async () => {
    const w = await world(); const p = w.project("alpha");
    const ana = await w.enroll("ana"); const ben = await w.enroll("ben");
    const t = await w.start(ana, p.id);
    await w.request(ana, "POST", `/api/v1/threads/${t.id}/send?seq=3`);
    const solo = await json(await w.request(ana, "GET", `/api/ix/threads/${t.id}/senders`));
    expect(solo.multi).toBe(false);
    await w.add(ana, t, ben);
    await w.request(ben, "POST", `/api/v1/threads/${t.id}/send?seq=7`);
    const both = await json(await w.request(ben, "GET", `/api/ix/threads/${t.id}/senders`));
    expect(both.multi).toBe(true);
    expect(both.senders).toEqual([
      { sequence: 3, userId: ana.userId, name: "ana", email: "ana@example.test" },
      { sequence: 7, userId: ben.userId, name: "ben", email: "ben@example.test" },
    ]);
    noteIxTurnRequested(t.id, 9, "user");
    noteIxTurnRequested(t.id, 10, "agent");
    expect(w.ixAuth.access.messageSenders(t.id)).toEqual([
      { sequence: 3, userId: ana.userId },
      { sequence: 7, userId: ben.userId },
      { sequence: 9, userId: ben.userId },
    ]);
  });
});
