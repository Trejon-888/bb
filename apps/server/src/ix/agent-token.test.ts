import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, createThread, getThread, noopNotifier, upsertHost, type DbConnection } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import { TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY } from "../request-context.js";
import { assertIxThreadAccess, noteIxThreadCreated, noteIxTurnSender, runWithIxRequestAccess } from "./access.js";
import {
  IX_AGENT_TOKEN_ENV,
  ixAgentTokenEnv,
  ixTerminalTokenEnv,
  mintIxAgentToken,
  setIxAgentTokenIssuer,
  verifyIxAgentToken,
  withoutReservedIxEnv,
} from "./agent-token.js";
import { createIxAuthService, type IxAuthService } from "./auth-service.js";
import { readIxAuthConfig, type IxRole } from "./config.js";
import { getIxActor, ixBindPluginCliContext } from "./context.js";
import { assertIxEnrollAllowed, ixApiGate } from "./middleware.js";
import { createIxRoutes } from "./routes.js";
import { IX_TEST_BASE, cookieOf, json } from "./test-harness.js";

const noopLogger = { debug() {}, error() {}, info() {}, warn() {} };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  setIxAgentTokenIssuer(null);
  while (cleanups.length > 0) await cleanups.pop()?.();
});

interface Person { cookie: string; userId: string }

async function world(loopback: "owner" | "deny" = "deny") {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-ix-token-test-"));
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
  const db: DbConnection = createMigratedConnection();
  const ixAuth: IxAuthService = await createIxAuthService({
    db,
    dataDir,
    logger: noopLogger,
    config: readIxAuthConfig({ BB_IX_AUTH: "team", BB_IX_AUTH_LOOPBACK: loopback, BB_IX_AUTH_ORG_NAME: "Acme", BB_IX_AUTH_BOOTSTRAP_EMAIL: "owner@example.test", BB_IX_AUTH_BOOTSTRAP_PASSWORD: "password-1" }, IX_TEST_BASE),
  });
  await ixAuth.ensureReady();
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.set(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY, context.req.header("x-test-remote") ?? "203.0.113.9");
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof ApiError) return context.json(error.body, error.status);
    throw error;
  });
  app.route("/api/ix", createIxRoutes({ ixAuth, db }));
  const api = new Hono();
  api.use("*", ixApiGate({ ixAuth, pluginRouteAuth: (id, _method, subPath) => (id === "hub" && subPath === "/v1/messages" ? "none" : id === "hub" ? "local" : undefined) }));
  api.post("/plugins/hub/http/v1/messages", (context) => context.json({ actor: getIxActor(context) ?? null }));
  api.post("/plugins/hub/http/v1/private", (context) => context.json({ reached: true }));
  api.get("/whoami", (context) => context.json({ actor: getIxActor(context) ?? null }));
  api.get("/threads/:id", (context) => {
    const thread = getThread(db, context.req.param("id"));
    if (thread === null) throw new ApiError(404, "thread_not_found", "Thread not found");
    assertIxThreadAccess(thread);
    return context.json({ id: thread.id });
  });
  api.post("/plugins", (context) => context.json({ installed: true }));
  api.post("/plugins/p1/cli", async (context) => {
    const body = (await context.req.json()) as { threadId?: string; projectId?: string };
    return context.json(ixBindPluginCliContext(getIxActor(context), { ...body }, (id) => getThread(db, id)?.projectId ?? null));
  });
  app.route("/api/v1", api);

  const signIn = async (email: string, password: string): Promise<Person> => {
    const response = await app.request("/api/ix/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const body = await json(response);
    return { cookie: cookieOf(response), userId: (body.actor as { user: { id: string } }).user.id };
  };
  const owner = await signIn("owner@example.test", "password-1");
  const enroll = async (name: string, role: IxRole = "member"): Promise<Person> => {
    const invite = await app.request("/api/ix/members/invite", { method: "POST", headers: { origin: IX_TEST_BASE, cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ email: `${name}@example.test`, role }) });
    const invitation = (await json(invite)).invitation as { id: string };
    const accept = await app.request("/api/ix/invitations/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: invitation.id, name, password: "password-9" }) });
    return { cookie: cookieOf(accept), userId: (await json(accept)).userId as string };
  };
  const host = upsertHost(db, noopNotifier, { name: "Test" });
  const project = createProject(db, noopNotifier, { name: "alpha", source: { type: "local_path", hostId: host.id, path: "/tmp/alpha" } }).project;
  const asUser = (person: Person) => ({ kind: "user" as const, user: { id: person.userId, email: "x@example.test", name: "x" }, organizationId: "org", memberId: "m", role: "member" as const });
  const start = (by: Person) =>
    runWithIxRequestAccess(asUser(by), ixAuth.access, null, async () => {
      const created = createThread(db, noopNotifier, { projectId: project.id, providerId: "codex", status: "pending" });
      noteIxThreadCreated(created);
      return created;
    });
  const send = (by: Person, threadId: string) => runWithIxRequestAccess(asUser(by), ixAuth.access, null, async () => noteIxTurnSender(threadId));
  const call = (token: string | null, method: string, path: string, extra: Record<string, string> = {}, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "x-test-remote": "127.0.0.1", ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(body === undefined ? {} : { "content-type": "application/json" }), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const tokenFor = async (threadId: string) => {
    const env = await ixAgentTokenEnv({ threadId });
    const entry = env.find((e) => e.name === IX_AGENT_TOKEN_ENV);
    if (entry === undefined || typeof entry.value !== "string") throw new Error("no token minted");
    return entry.value;
  };
  return { db, dataDir, ixAuth, app, owner, enroll, project, start, send, call, tokenFor };
}

async function actorOf(response: Response) {
  return ((await json(response)).actor ?? null) as { kind: string; role?: string; user?: { id: string }; via?: unknown } | null;
}

describe("ix agent tokens", () => {
  it("mints a stable token per thread and acting person, and rotates it when the person changes", async () => {
    const w = await world();
    const ana = await w.enroll("ana");
    const ben = await w.enroll("ben");
    const t1 = await w.start(ana);
    const t2 = await w.start(ana);
    const first = await w.tokenFor(t1.id);
    expect(await w.tokenFor(t1.id)).toBe(first);
    expect(await w.tokenFor(t2.id)).not.toBe(first);
    expect(verifyIxAgentToken("wrong-key", first)).toBeNull();
    const whoAna = await actorOf(await w.call(first, "GET", "/api/v1/whoami"));
    expect(whoAna).toMatchObject({ kind: "user", role: "member", user: { id: ana.userId }, via: { kind: "agent-token", threadId: t1.id } });

    w.ixAuth.access.addThreadMember(t1.id, ben.userId, ana.userId);
    await w.send(ben, t1.id);
    const second = await w.tokenFor(t1.id);
    expect(second).not.toBe(first);
    expect((await w.call(first, "GET", "/api/v1/whoami")).status).toBe(401);
    expect(await actorOf(await w.call(second, "GET", "/api/v1/whoami"))).toMatchObject({ user: { id: ben.userId } });
  });

  it("gives a member's chat member power and an owner's chat owner power", async () => {
    const w = await world();
    const ana = await w.enroll("ana");
    const ben = await w.enroll("ben");
    const anaChat = await w.start(ana);
    const benChat = await w.start(ben);
    const ownerChat = await w.start(w.owner);
    const memberToken = await w.tokenFor(anaChat.id);
    const ownerToken = await w.tokenFor(ownerChat.id);

    expect((await w.call(memberToken, "POST", "/api/v1/plugins", {}, {})).status).toBe(403);
    expect((await w.call(memberToken, "GET", `/api/v1/threads/${anaChat.id}`)).status).toBe(200);
    expect((await w.call(memberToken, "GET", `/api/v1/threads/${benChat.id}`)).status).toBe(404);
    expect((await w.call(memberToken, "POST", "/api/ix/tokens/rotate", {}, {})).status).toBe(403);

    expect(await actorOf(await w.call(ownerToken, "GET", "/api/v1/whoami"))).toMatchObject({ kind: "user", role: "owner", user: { id: w.owner.userId } });
    expect((await w.call(ownerToken, "POST", "/api/v1/plugins", {}, {})).status).toBe(200);
  });

  it("rejects a token whose person lost the chat or the workspace", async () => {
    const w = await world();
    const ana = await w.enroll("ana");
    const ben = await w.enroll("ben");
    const chat = await w.start(ana);
    w.ixAuth.access.addThreadMember(chat.id, ben.userId, ana.userId);
    await w.send(ben, chat.id);
    const benToken = await w.tokenFor(chat.id);
    expect((await w.call(benToken, "GET", "/api/v1/whoami")).status).toBe(200);
    w.ixAuth.access.removeThreadMember(chat.id, ben.userId);
    expect((await w.call(benToken, "GET", "/api/v1/whoami")).status).toBe(401);

    const solo = await w.start(ana);
    const anaToken = await w.tokenFor(solo.id);
    const anaMember = (await w.ixAuth.listMembers()).find((m) => m.userId === ana.userId);
    await w.ixAuth.removeMember(anaMember?.id ?? "");
    expect((await w.call(anaToken, "GET", "/api/v1/whoami")).status).toBe(401);
  });

  it("refuses tampered tokens and tokens from an earlier epoch", async () => {
    const w = await world();
    const ana = await w.enroll("ana");
    const chat = await w.start(ana);
    const token = await w.tokenFor(chat.id);
    const parts = token.split(".");
    const forged = mintIxAgentToken("not-the-key", { threadId: chat.id, userId: w.owner.userId, epoch: 0 });
    const swapped = [parts[0], parts[1], Buffer.from(w.owner.userId).toString("base64url"), parts[3], parts[4]].join(".");
    for (const bad of [forged, swapped, `${token}x`, token.replace(/\.0\./u, ".1.")]) {
      expect((await w.call(bad, "GET", "/api/v1/whoami")).status).toBe(401);
    }
    const before = w.ixAuth.ownerToken();
    await w.ixAuth.rotateTokens("test");
    expect((await w.call(token, "GET", "/api/v1/whoami")).status).toBe(401);
    expect((await w.call(before, "GET", "/api/v1/whoami")).status).toBe(401);
    expect((await w.call(await w.tokenFor(chat.id), "GET", "/api/v1/whoami")).status).toBe(200);
    expect((await readFile(w.ixAuth.ownerTokenPath, "utf8")).trim()).toBe(w.ixAuth.ownerToken());
  });

  it("with loopback deny, needs a token; the owner token file acts as owner over loopback only", async () => {
    const w = await world("deny");
    expect((await w.call(null, "GET", "/api/v1/whoami")).status).toBe(401);
    const fileToken = (await readFile(join(w.dataDir, "ix-owner-token"), "utf8")).trim();
    expect(((await stat(join(w.dataDir, "ix-owner-token"))).mode & 0o777).toString(8)).toBe("600");
    expect(fileToken).toBe(w.ixAuth.ownerToken());
    expect(await actorOf(await w.call(fileToken, "GET", "/api/v1/whoami"))).toEqual({ kind: "loopback-owner", via: "owner-token" });
    expect((await w.call(fileToken, "GET", "/api/v1/whoami", { "x-test-remote": "203.0.113.9" })).status).toBe(401);
    expect((await w.call(fileToken, "GET", "/api/v1/whoami", { "x-forwarded-for": "198.51.100.4" })).status).toBe(401);
    expect((await w.call(fileToken, "POST", "/api/v1/plugins", {}, {})).status).toBe(200);
  });

  it("with loopback deny, lets local processes reach a plugin's own-auth (auth none) routes and nothing else", async () => {
    const w = await world("deny");
    const hub = await w.call("ixp-thread.abc", "POST", "/api/v1/plugins/hub/http/v1/messages", {}, {});
    expect(hub.status).toBe(200);
    expect(await actorOf(hub)).toEqual({ kind: "plugin-public", pluginId: "hub" });
    expect((await w.call(null, "POST", "/api/v1/plugins/hub/http/v1/private", {}, {})).status).toBe(401);
    expect((await w.call(null, "POST", "/api/v1/plugins/hub/http/v1/messages", { "x-forwarded-for": "198.51.100.4" }, {})).status).toBe(401);
    expect((await w.call(null, "POST", "/api/v1/plugins/hub/http/v1/messages", { "x-test-remote": "203.0.113.9" }, {})).status).toBe(401);
  });

  it("keeps loopback owner by default and still honors tokens there", async () => {
    const w = await world("owner");
    const ana = await w.enroll("ana");
    const chat = await w.start(ana);
    expect(await actorOf(await w.call(null, "GET", "/api/v1/whoami"))).toEqual({ kind: "loopback-owner" });
    expect(await actorOf(await w.call(await w.tokenFor(chat.id), "GET", "/api/v1/whoami"))).toMatchObject({ kind: "user", role: "member" });
    expect((await w.call("ixt1.bad.bad.0.bad", "GET", "/api/v1/whoami")).status).toBe(401);
  });

  it("binds plugin CLI calls to the token's chat and person", async () => {
    const w = await world();
    const ana = await w.enroll("ana");
    const chat = await w.start(ana);
    const other = await w.start(w.owner);
    const response = await w.call(await w.tokenFor(chat.id), "POST", "/api/v1/plugins/p1/cli", {}, { threadId: other.id, projectId: "spoofed" });
    expect(response.status).toBe(200);
    const ctx = await json(response);
    expect(ctx.threadId).toBe(chat.id);
    expect(ctx.projectId).toBe(w.project.id);
    expect(ctx.experimental_user).toMatchObject({ id: ana.userId, role: "member" });

    const asOwner = await json(await w.call(w.ixAuth.ownerToken(), "POST", "/api/v1/plugins/p1/cli", {}, { threadId: other.id }));
    expect(asOwner).toEqual({ threadId: other.id });
  });

  it("gates host enroll keys on the owner token in team mode", async () => {
    const w = await world();
    expect(() => assertIxEnrollAllowed(w.ixAuth, undefined)).toThrow(ApiError);
    expect(() => assertIxEnrollAllowed(w.ixAuth, "Bearer ixo1.0.forged")).toThrow(ApiError);
    const ana = await w.enroll("ana");
    const agentToken = await w.tokenFor((await w.start(ana)).id);
    expect(() => assertIxEnrollAllowed(w.ixAuth, `Bearer ${agentToken}`)).toThrow(ApiError);
    expect(() => assertIxEnrollAllowed(w.ixAuth, `Bearer ${w.ixAuth.ownerToken()}`)).not.toThrow();
  });

  it("never passes the owner token path or a spoofed token into agent or terminal env", async () => {
    const w = await world();
    const ana = await w.enroll("ana");
    const contributed = [
      { name: "BB_IX_OWNER_TOKEN_FILE", value: w.ixAuth.ownerTokenPath, source: { plugin: "evil" }, reason: "x" },
      { name: IX_AGENT_TOKEN_ENV, value: "spoof", source: { plugin: "evil" }, reason: "x" },
      { name: "KEEP", value: "1", source: { plugin: "ok" }, reason: "x" },
    ];
    expect(withoutReservedIxEnv(contributed).map((e) => e.name)).toEqual(["KEEP"]);
    const terminalEnv = await runWithIxRequestAccess(
      { kind: "user", user: { id: ana.userId, email: "ana@example.test", name: "ana" }, organizationId: "org", memberId: "m", role: "member" },
      w.ixAuth.access,
      null,
      () => ixTerminalTokenEnv(contributed),
    );
    expect(terminalEnv.map((e) => e.name)).toEqual(["KEEP", IX_AGENT_TOKEN_ENV]);
    const terminalToken = terminalEnv[1]?.value;
    expect(typeof terminalToken).toBe("string");
    expect(await actorOf(await w.call(String(terminalToken), "GET", "/api/v1/whoami"))).toMatchObject({ user: { id: ana.userId }, via: { kind: "agent-token", threadId: null } });
    expect(JSON.stringify(terminalEnv)).not.toContain("ix-owner-token");
  });
});
