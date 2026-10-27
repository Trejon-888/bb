import { describe, expect, it } from "vitest";
import { createIxKv } from "./kv.js";
import { createIxSsoReplayGuard, signIxSsoToken, verifyIxSsoToken, type IxSsoPayload } from "./sso.js";
import { createIxTestHarness, cookieOf, IX_TEST_BASE, json, jsonInit, makeIxApp } from "./test-harness.js";
import { createMigratedConnection } from "@bb/db/testing";

const harness = createIxTestHarness();
const SECRET = "0123456789abcdef0123456789abcdef-sso-secret";
const ownerEnv = {
  BB_IX_AUTH: "team",
  BB_IX_AUTH_ORG_NAME: "Acme",
  BB_IX_AUTH_BOOTSTRAP_EMAIL: "owner@example.test",
  BB_IX_AUTH_BOOTSTRAP_PASSWORD: "password-1",
};

let nonceCounter = 0;
function payload(overrides: Partial<IxSsoPayload> = {}): IxSsoPayload {
  nonceCounter += 1;
  return {
    sub: "hop@example.test",
    name: "Hop",
    role: "member",
    workspaceId: "ws-1",
    exp: Math.floor(Date.now() / 1000) + 60,
    nonce: `nonce-${nonceCounter}-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

async function setup(env = ownerEnv) {
  const ixAuth = await harness.makeService(env);
  const app = makeIxApp(ixAuth);
  const ownerCookie = await harness.signInCookie(app, "owner@example.test", "password-1");
  const set = await app.request("/api/ix/sso/secret", { ...jsonInit({ secret: SECRET }, { cookie: ownerCookie }), method: "PUT" });
  expect(set.status).toBe(200);
  return { ixAuth, app, ownerCookie };
}

function accept(app: ReturnType<typeof makeIxApp>, token: string) {
  return app.request("/api/ix/sso/accept", jsonInit({ token }));
}

describe("ix sso token", () => {
  it("round-trips through sign and verify and rejects tampering", () => {
    const body = payload();
    const token = signIxSsoToken(body, SECRET);
    expect(verifyIxSsoToken(token, SECRET)).toMatchObject({ sub: body.sub, nonce: body.nonce });
    expect(() => verifyIxSsoToken(token, "another-secret-that-is-long-enough-0000")).toThrow(/bad_signature/);
    const [payloadB64, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...body, role: "owner" })).toString("base64url");
    expect(() => verifyIxSsoToken(`${forged}.${signature}`, SECRET)).toThrow(/bad_signature/);
    expect(() => verifyIxSsoToken(`${payloadB64}`, SECRET)).toThrow(/malformed/);
    expect(() => verifyIxSsoToken(token, null)).toThrow(/no_secret/);
    expect(() => verifyIxSsoToken(token, "short")).toThrow(/no_secret/);
    expect(() => verifyIxSsoToken(signIxSsoToken(payload({ exp: Math.floor(Date.now() / 1000) - 1 }), SECRET), SECRET)).toThrow(/expired/);
    const badRole = Buffer.from(JSON.stringify({ ...body, role: "superuser" })).toString("base64url");
    const badRoleToken = signIxSsoToken(body, SECRET).replace(payloadB64 ?? "", badRole);
    expect(() => verifyIxSsoToken(badRoleToken, SECRET)).toThrow(/bad_signature|malformed/);
  });

  it("replay guard remembers nonces across instances and forgets expired ones", () => {
    const db = createMigratedConnection();
    const kv = createIxKv(db);
    const now = Date.now();
    const first = createIxSsoReplayGuard(kv);
    expect(first.consume("n1", Math.floor(now / 1000) + 60, now)).toBe(true);
    expect(first.consume("n1", Math.floor(now / 1000) + 60, now)).toBe(false);
    const second = createIxSsoReplayGuard(kv);
    expect(second.consume("n1", Math.floor(now / 1000) + 60, now)).toBe(false);
    expect(second.consume("n1", Math.floor(now / 1000) + 60, now + 61_000)).toBe(true);
  });
});

describe("ix sso accept", () => {
  it("refuses when no secret is set, when auth is off, and when the setter is not an owner", async () => {
    const noSecret = makeIxApp(await harness.makeService(ownerEnv));
    const response = await accept(noSecret, signIxSsoToken(payload(), SECRET));
    expect(response.status).toBe(401);
    expect((await json(response)).code).toBe("ix_sso_no_secret");

    const off = makeIxApp(await harness.makeService({}));
    expect((await accept(off, signIxSsoToken(payload(), SECRET))).status).toBe(409);

    const { app, ownerCookie } = await setup();
    const short = await app.request("/api/ix/sso/secret", { ...jsonInit({ secret: "too-short" }, { cookie: ownerCookie }), method: "PUT" });
    expect(short.status).toBe(400);
    const invite = await app.request("/api/ix/members/invite", jsonInit({ email: "admin@example.test", role: "admin" }, { cookie: ownerCookie }));
    const invitation = (await json(invite)).invitation as { id: string };
    const adminCookie = cookieOf(await app.request("/api/ix/invitations/accept", jsonInit({ token: invitation.id, name: "Ad", password: "password-2" })));
    const adminSet = await app.request("/api/ix/sso/secret", { ...jsonInit({ secret: SECRET }, { cookie: adminCookie }), method: "PUT" });
    expect(adminSet.status).toBe(403);
  });

  it("clears the secret with { secret: null } from the owner or loopback; SSO then refuses with no_secret", async () => {
    const { ixAuth, app, ownerCookie } = await setup();
    expect((await accept(app, signIxSsoToken(payload(), SECRET))).status).toBe(200);

    const cleared = await app.request("/api/ix/sso/secret", { ...jsonInit({ secret: null }, { cookie: ownerCookie }), method: "PUT" });
    expect(cleared.status).toBe(200);
    expect(await json(cleared)).toEqual({ ok: true, secret: false });
    const refused = await accept(app, signIxSsoToken(payload(), SECRET));
    expect(refused.status).toBe(401);
    expect(await json(refused)).toMatchObject({ code: "ix_sso_no_secret" });

    const loopback = makeIxApp(ixAuth, "127.0.0.1");
    const reset = await loopback.request("/api/ix/sso/secret", { ...jsonInit({ secret: SECRET }), method: "PUT" });
    expect(await json(reset)).toEqual({ ok: true, secret: true });
    expect((await accept(app, signIxSsoToken(payload(), SECRET))).status).toBe(200);
    const loopbackClear = await loopback.request("/api/ix/sso/secret", { ...jsonInit({ secret: null }), method: "PUT" });
    expect(loopbackClear.status).toBe(200);
    expect((await accept(app, signIxSsoToken(payload(), SECRET))).status).toBe(401);

    const missing = await app.request("/api/ix/sso/secret", { ...jsonInit({}, { cookie: ownerCookie }), method: "PUT" });
    expect(missing.status).toBe(400);
  });

  it("creates the user and membership, returns a working session cookie", async () => {
    const { app } = await setup();
    const response = await accept(app, signIxSsoToken(payload({ sub: "Hop@Example.test", role: "member" }), SECRET));
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ ok: true, role: "member" });
    const cookie = cookieOf(response);
    expect(cookie).toContain("session_token");
    const me = await app.request("/api/ix/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await json(me)).actor).toMatchObject({ kind: "user", role: "member", user: { email: "hop@example.test", name: "Hop" } });
    const write = await app.request("/api/v1/projects", { method: "POST", headers: { cookie, origin: IX_TEST_BASE } });
    expect(write.status).toBe(200);
    const out = await app.request("/api/ix/sign-out", { method: "POST", headers: { cookie } });
    expect(out.status).toBe(200);
    expect((await app.request("/api/ix/me", { headers: { cookie } })).status).toBe(401);
  });

  it("rejects bad signature, expired, and replayed tokens with distinct codes", async () => {
    const { app } = await setup();
    const bad = await accept(app, signIxSsoToken(payload(), "wrong-secret-wrong-secret-wrong-secret"));
    expect(bad.status).toBe(401);
    expect((await json(bad)).code).toBe("ix_sso_bad_signature");
    const expired = await accept(app, signIxSsoToken(payload({ exp: Math.floor(Date.now() / 1000) - 5 }), SECRET));
    expect(expired.status).toBe(401);
    expect((await json(expired)).code).toBe("ix_sso_expired");
    const token = signIxSsoToken(payload(), SECRET);
    expect((await accept(app, token)).status).toBe(200);
    const replay = await accept(app, token);
    expect(replay.status).toBe(401);
    expect((await json(replay)).code).toBe("ix_sso_replayed");
    expect(replay.headers.get("set-cookie")).toBeNull();
    const garbage = await accept(app, "not.a.token");
    expect(garbage.status).toBe(401);
    expect((await json(garbage)).code).toBe("ix_sso_malformed");
    const unsigned = await accept(app, `${token.split(".")[0]}.AAAA`);
    expect((await json(unsigned)).code).toBe("ix_sso_bad_signature");
  });

  it("maps roles up but never down: an existing owner stays owner, a viewer is raised", async () => {
    const { app, ownerCookie } = await setup();
    const demote = await accept(app, signIxSsoToken(payload({ sub: "owner@example.test", name: "Renamed", role: "viewer" }), SECRET));
    expect(demote.status).toBe(200);
    expect((await json(demote)).role).toBe("owner");
    const ownerMe = await json(await app.request("/api/ix/me", { headers: { cookie: cookieOf(demote) } }));
    expect(ownerMe.actor).toMatchObject({ role: "owner", user: { name: "owner" } });

    const asViewer = await accept(app, signIxSsoToken(payload({ sub: "ramp@example.test", role: "viewer" }), SECRET));
    expect((await json(asViewer)).role).toBe("viewer");
    const asAdmin = await accept(app, signIxSsoToken(payload({ sub: "ramp@example.test", role: "admin" }), SECRET));
    expect((await json(asAdmin)).role).toBe("admin");
    const backToMember = await accept(app, signIxSsoToken(payload({ sub: "ramp@example.test", role: "member" }), SECRET));
    expect((await json(backToMember)).role).toBe("admin");

    const members = (await json(await app.request("/api/ix/members", { headers: { cookie: ownerCookie } }))).members as Array<{ email: string; role: string }>;
    expect(members.find((row) => row.email === "ramp@example.test")?.role).toBe("admin");
    expect(members.find((row) => row.email === "owner@example.test")?.role).toBe("owner");
    expect(members).toHaveLength(2);
  });

  it("an owner token on an un-bootstrapped server creates the organization; lesser roles are refused", async () => {
    const ixAuth = await harness.makeService({ BB_IX_AUTH: "team", BB_IX_AUTH_ORG_NAME: "Fresh" });
    ixAuth.setSsoSecret(SECRET, "test");
    const app = makeIxApp(ixAuth);
    const refused = await accept(app, signIxSsoToken(payload({ role: "admin" }), SECRET));
    expect(refused.status).toBe(409);
    expect((await ixAuth.status()).bootstrapped).toBe(false);
    const owner = await accept(app, signIxSsoToken(payload({ sub: "first@example.test", role: "owner" }), SECRET));
    expect(owner.status).toBe(200);
    expect(await ixAuth.status()).toMatchObject({ bootstrapped: true, orgName: "Fresh" });
    const me = await json(await app.request("/api/ix/me", { headers: { cookie: cookieOf(owner) } }));
    expect(me.actor).toMatchObject({ role: "owner" });
  });
});
