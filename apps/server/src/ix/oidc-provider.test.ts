import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMigratedConnection } from "@bb/db/testing";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { createIxAuthService, type IxAuthService } from "./auth-service.js";
import { readIxAuthConfig } from "./config.js";
import { createIxRoutes } from "./routes.js";
import { TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY } from "../request-context.js";

const BASE = "http://localhost";
const SITE_CALLBACK = "https://ops-board.example.com/__ix/callback";
const noopLogger = { debug() {}, error() {}, info() {}, warn() {} };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function setup(): Promise<{ ixAuth: IxAuthService; app: Hono; registrationToken: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-ix-oidc-test-"));
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
  const ixAuth = await createIxAuthService({ db: createMigratedConnection(), dataDir, logger: noopLogger, config: readIxAuthConfig({ BB_IX_AUTH: "team", BB_IX_AUTH_ORG_NAME: "Acme" }, BASE) });
  await ixAuth.ensureReady();
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.set(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY, "203.0.113.9");
    await next();
  });
  app.on(["GET", "POST"], "/api/auth/*", (context) => ixAuth.handler(context.req.raw));
  app.route("/api/ix", createIxRoutes({ ixAuth }));
  return { ixAuth, app, registrationToken: (await readFile(join(dataDir, "ix-oidc-registration-token"), "utf8")).trim() };
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(/,(?=[^;]+=)/).map((part) => part.split(";")[0]?.trim() ?? "").filter(Boolean).join("; ");
}

const registration = (token: string | null) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
  body: JSON.stringify({ client_name: "Ops board", redirect_uris: [SITE_CALLBACK], grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "client_secret_post", scope: "openid email profile" }),
});

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

describe("ix auth: Sign in with <workspace> (OpenID Connect provider)", () => {
  it("publishes discovery with the workspace as issuer", async () => {
    const { app } = await setup();
    const doc = (await (await app.request("/api/auth/.well-known/openid-configuration")).json()) as Record<string, string>;
    expect(doc.issuer).toBe(BASE);
    expect(doc.registration_endpoint).toBe(`${BASE}/api/auth/oauth2/register`);
    expect(doc.token_endpoint).toBe(`${BASE}/api/auth/oauth2/token`);
  });

  it("registers clients only with the workspace registration token", async () => {
    const { app, registrationToken } = await setup();
    expect((await app.request("/api/auth/oauth2/register", registration(null))).status).toBe(401);
    expect((await app.request("/api/auth/oauth2/register", registration("wrong"))).status).toBe(401);
    const ok = await app.request("/api/auth/oauth2/register", registration(registrationToken));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ client_id: expect.any(String), client_secret: expect.any(String) });
  });

  it("signs a member in end to end without a consent screen, and refuses non-members", async () => {
    const { app, registrationToken } = await setup();
    const owner = await app.request("/api/ix/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email: "owner@example.test", password: "password-1", name: "Owner" }),
    });
    const cookie = cookieOf(owner);
    const client = (await (await app.request("/api/auth/oauth2/register", registration(registrationToken))).json()) as { client_id: string; client_secret: string };
    const { verifier, challenge } = pkce();
    const query = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: SITE_CALLBACK, scope: "openid email profile", state: "s1", nonce: "n1", code_challenge: challenge, code_challenge_method: "S256" });

    const anonymous = await app.request(`/api/auth/oauth2/authorize?${query}`);
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get("location")).toMatch(/^\/\?/);

    const authorized = await app.request(`/api/auth/oauth2/authorize?${query}`, { headers: { cookie } });
    expect(authorized.status).toBe(302);
    const back = new URL(authorized.headers.get("location") ?? "");
    expect(`${back.origin}${back.pathname}`).toBe(SITE_CALLBACK);
    expect(back.searchParams.get("state")).toBe("s1");
    const code = back.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await app.request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: code ?? "", redirect_uri: SITE_CALLBACK, code_verifier: verifier, client_id: client.client_id, client_secret: client.client_secret }),
    });
    expect(token.status).toBe(200);
    const { id_token } = (await token.json()) as { id_token: string };
    const claims = JSON.parse(Buffer.from(id_token.split(".")[1] ?? "", "base64url").toString()) as Record<string, unknown>;
    expect(claims).toMatchObject({ iss: BASE, aud: client.client_id, email: "owner@example.test", nonce: "n1" });

    const outsider = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email: "outsider@example.test", password: "password-1", name: "Outsider" }),
    });
    expect(outsider.status).toBe(200);
    const refused = await app.request(`/api/auth/oauth2/authorize?${query}`, { headers: { cookie: cookieOf(outsider) } });
    expect(refused.status).toBe(403);
  });
});
