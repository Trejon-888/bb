import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMigratedConnection } from "@bb/db/testing";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import { createIxAuthService, type IxAuthService } from "./auth-service.js";
import { readIxAuthConfig } from "./config.js";
import { ixApiGate } from "./middleware.js";
import { createIxRoutes } from "./routes.js";
import { TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY } from "../request-context.js";

const BASE = "http://localhost";
const noopLogger = { debug() {}, error() {}, info() {}, warn() {} };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function makeService(env: NodeJS.ProcessEnv): Promise<IxAuthService> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-ix-auth-test-"));
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
  const service = await createIxAuthService({
    db: createMigratedConnection(),
    dataDir,
    logger: noopLogger,
    config: readIxAuthConfig(env, BASE),
  });
  await service.ensureReady();
  return service;
}

function makeApp(ixAuth: IxAuthService, remoteAddress = "203.0.113.9"): Hono {
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.set(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY, remoteAddress);
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof ApiError) return context.json(error.body, error.status);
    throw error;
  });
  app.on(["GET", "POST"], "/api/auth/*", (context) => ixAuth.handler(context.req.raw));
  app.route("/api/ix", createIxRoutes({ ixAuth }));
  const publicApi = new Hono();
  publicApi.use("*", ixApiGate({ ixAuth }));
  publicApi.get("/system/config", (context) => context.json({ ok: true }));
  publicApi.post("/projects", (context) => context.json({ created: true }));
  publicApi.post("/threads/t1/read", (context) => context.json({ read: true }));
  publicApi.post("/plugins/p1/rpc/m", (context) => context.json({ rpc: true }));
  app.route("/api/v1", publicApi);
  return app;
}

function cookieOf(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  return raw
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join("; ");
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("ix auth: mode off", () => {
  it("passes every request through and reports kind off", async () => {
    const ixAuth = await makeService({});
    const app = makeApp(ixAuth);
    const config = await app.request("/api/v1/system/config");
    expect(config.status).toBe(200);
    const me = await app.request("/api/ix/me");
    expect((await json(me)).actor).toEqual({ kind: "off" });
    const bootstrap = await app.request("/api/ix/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.test", password: "password-1", name: "A" }),
    });
    expect(bootstrap.status).toBe(409);
  });
});

describe("ix auth: team mode", () => {
  const env = { BB_IX_AUTH: "team", BB_IX_AUTH_ORG_NAME: "Acme" };

  it("requires sign-in, bootstraps an owner, and resolves the session", async () => {
    const ixAuth = await makeService(env);
    const app = makeApp(ixAuth);
    const blocked = await app.request("/api/v1/system/config", { headers: { origin: BASE } });
    expect(blocked.status).toBe(401);
    expect((await json(blocked)).code).toBe("ix_unauthenticated");
    const status = await json(await app.request("/api/ix/status"));
    expect(status).toMatchObject({ mode: "team", bootstrapped: false });

    const bootstrap = await app.request("/api/ix/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email: "owner@example.test", password: "password-1", name: "Owner" }),
    });
    expect(bootstrap.status).toBe(200);
    const cookie = cookieOf(bootstrap);
    expect(cookie).toContain("session_token");

    const me = await json(await app.request("/api/ix/me", { headers: { cookie } }));
    expect(me.actor).toMatchObject({ kind: "user", role: "owner", user: { email: "owner@example.test" } });
    expect(me.orgName).toBe("Acme");
    const config = await app.request("/api/v1/system/config", { headers: { cookie, origin: BASE } });
    expect(config.status).toBe(200);

    const again = await app.request("/api/ix/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@example.test", password: "password-1", name: "X" }),
    });
    expect(again.status).toBe(409);
  });

  it("bootstraps from env on ensureReady and signs in with password", async () => {
    const ixAuth = await makeService({
      ...env,
      BB_IX_AUTH_BOOTSTRAP_EMAIL: "boot@example.test",
      BB_IX_AUTH_BOOTSTRAP_PASSWORD: "password-1",
      BB_IX_AUTH_BOOTSTRAP_NAME: "Boot",
    });
    const app = makeApp(ixAuth);
    expect((await ixAuth.status()).bootstrapped).toBe(true);
    const bad = await app.request("/api/ix/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "boot@example.test", password: "wrong-password" }),
    });
    expect(bad.status).toBe(401);
    const good = await app.request("/api/ix/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "boot@example.test", password: "password-1" }),
    });
    expect(good.status).toBe(200);
    expect((await json(good)).actor).toMatchObject({ role: "owner" });
  });

  it("invites, accepts, enforces viewer read-only and admin-only management, protects the last owner", async () => {
    const ixAuth = await makeService({
      ...env,
      BB_IX_AUTH_BOOTSTRAP_EMAIL: "owner@example.test",
      BB_IX_AUTH_BOOTSTRAP_PASSWORD: "password-1",
    });
    const app = makeApp(ixAuth);
    const ownerCookie = cookieOf(
      await app.request("/api/ix/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@example.test", password: "password-1" }),
      }),
    );
    const invite = await app.request("/api/ix/members/invite", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ email: "Viewer@Example.test", role: "viewer" }),
    });
    expect(invite.status).toBe(200);
    const invitation = (await json(invite)).invitation as { id: string; email: string };
    expect(invitation.email).toBe("viewer@example.test");

    const accept = await app.request("/api/ix/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: invitation.id, name: "Vee", password: "password-2" }),
    });
    expect(accept.status).toBe(200);
    const viewerCookie = cookieOf(accept);
    const twice = await app.request("/api/ix/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: invitation.id, name: "Vee", password: "password-2" }),
    });
    expect(twice.status).toBe(400);

    const read = await app.request("/api/v1/system/config", { headers: { cookie: viewerCookie, origin: BASE } });
    expect(read.status).toBe(200);
    const write = await app.request("/api/v1/projects", { method: "POST", headers: { cookie: viewerCookie, origin: BASE } });
    expect(write.status).toBe(403);
    const markRead = await app.request("/api/v1/threads/t1/read", { method: "POST", headers: { cookie: viewerCookie, origin: BASE } });
    expect(markRead.status).toBe(200);
    const rpc = await app.request("/api/v1/plugins/p1/rpc/m", { method: "POST", headers: { cookie: viewerCookie, origin: BASE } });
    expect(rpc.status).toBe(200);
    const members = await app.request("/api/ix/members", { headers: { cookie: viewerCookie } });
    expect(members.status).toBe(200);
    const viewerInvite = await app.request("/api/ix/members/invite", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: viewerCookie },
      body: JSON.stringify({ email: "z@example.test", role: "member" }),
    });
    expect(viewerInvite.status).toBe(403);

    const list = (await json(members)).members as Array<{ id: string; email: string; role: string }>;
    const viewer = list.find((row) => row.email === "viewer@example.test");
    const owner = list.find((row) => row.email === "owner@example.test");
    expect(viewer?.role).toBe("viewer");
    const promote = await app.request(`/api/ix/members/${viewer?.id}/role`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ role: "member" }),
    });
    expect(promote.status).toBe(200);
    const nowWrite = await app.request("/api/v1/projects", { method: "POST", headers: { cookie: viewerCookie, origin: BASE } });
    expect(nowWrite.status).toBe(200);

    const demoteOwner = await app.request(`/api/ix/members/${owner?.id}/role`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: ownerCookie },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(demoteOwner.status).toBe(409);
    const removeOwner = await app.request(`/api/ix/members/${owner?.id}`, { method: "DELETE", headers: { cookie: ownerCookie } });
    expect(removeOwner.status).toBe(409);
    const removeViewer = await app.request(`/api/ix/members/${viewer?.id}`, { method: "DELETE", headers: { cookie: ownerCookie } });
    expect(removeViewer.status).toBe(200);
    const gone = await app.request("/api/ix/me", { headers: { cookie: viewerCookie } });
    expect(gone.status).toBe(401);
  });

  it("lets the loopback owner invite, recording the server owner as inviter", async () => {
    const ixAuth = await makeService({ ...env, BB_IX_AUTH_BOOTSTRAP_EMAIL: "own@example.test", BB_IX_AUTH_BOOTSTRAP_PASSWORD: "password-1" });
    const app = makeApp(ixAuth, "127.0.0.1");
    const invite = await app.request("/api/ix/members/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "cli@example.test", role: "member" }) });
    expect(invite.status).toBe(200);
    const owner = (await ixAuth.listMembers()).find((member) => member.role === "owner");
    expect(((await json(invite)).invitation as { inviterId: string }).inviterId).toBe(owner?.userId);
  });

  it("treats loopback requests without an Origin as the owner, and denies them when configured", async () => {
    const owner = await makeService(env);
    const loopbackApp = makeApp(owner, "127.0.0.1");
    expect((await loopbackApp.request("/api/v1/system/config")).status).toBe(200);
    expect((await json(await loopbackApp.request("/api/ix/me"))).actor).toEqual({ kind: "loopback-owner" });
    expect((await loopbackApp.request("/api/v1/system/config", { headers: { origin: BASE } })).status).toBe(401);
    for (const header of ["x-forwarded-for", "cf-connecting-ip", "cf-ray", "forwarded", "x-real-ip"]) {
      expect((await loopbackApp.request("/api/v1/system/config", { headers: { [header]: "203.0.113.7" } })).status, header).toBe(401);
    }
    expect((await json(await loopbackApp.request("/api/ix/me", { headers: { "cf-connecting-ip": "203.0.113.7" } }))).code).toBe("ix_unauthenticated");
    const denied = await makeService({ ...env, BB_IX_AUTH_LOOPBACK: "deny" });
    expect((await makeApp(denied, "127.0.0.1").request("/api/v1/system/config")).status).toBe(401);
  });

  it("signs out and drops the session", async () => {
    const ixAuth = await makeService({ ...env, BB_IX_AUTH_BOOTSTRAP_EMAIL: "o@example.test", BB_IX_AUTH_BOOTSTRAP_PASSWORD: "password-1" });
    const app = makeApp(ixAuth);
    const cookie = cookieOf(await app.request("/api/ix/sign-in", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "o@example.test", password: "password-1" }) }));
    expect((await app.request("/api/ix/me", { headers: { cookie } })).status).toBe(200);
    const out = await app.request("/api/ix/sign-out", { method: "POST", headers: { cookie } });
    expect(out.status).toBe(200);
    expect((await app.request("/api/ix/me", { headers: { cookie } })).status).toBe(401);
  });
});
