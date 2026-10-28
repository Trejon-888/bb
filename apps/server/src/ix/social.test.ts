import { describe, expect, it } from "vitest";
import { readIxAuthConfig } from "./config.js";
import { IX_TEST_BASE, createIxTestHarness, json, jsonInit, makeIxApp, oauthSessionCookie } from "./test-harness.js";

const harness = createIxTestHarness();
const teamEnv = { BB_IX_AUTH: "team", BB_IX_AUTH_ORG_NAME: "Acme" };
const ownerEnv = { ...teamEnv, BB_IX_AUTH_BOOTSTRAP_EMAIL: "owner@example.test", BB_IX_AUTH_BOOTSTRAP_PASSWORD: "password-1" };
const NOT_MEMBER = "This account has no access to this workspace. Ask an admin for an invitation.";

async function inviteAs(app: ReturnType<typeof makeIxApp>, email: string, role: string): Promise<string> {
  const cookie = await harness.signInCookie(app, "owner@example.test", "password-1");
  const response = await app.request("/api/ix/members/invite", jsonInit({ email, role }, { cookie }));
  expect(response.status).toBe(200);
  return ((await json(response)).invitation as { id: string }).id;
}

describe("ix social sign-in: config and status", () => {
  it("enables a provider only when both id and secret are set", () => {
    const config = readIxAuthConfig(
      {
        BB_IX_AUTH_GOOGLE_CLIENT_ID: "g-id",
        BB_IX_AUTH_GOOGLE_CLIENT_SECRET: "g-secret",
        BB_IX_AUTH_MICROSOFT_CLIENT_ID: "m-id",
        BB_IX_AUTH_MICROSOFT_CLIENT_SECRET: "m-secret",
        BB_IX_AUTH_GITHUB_CLIENT_ID: "gh-id",
      },
      IX_TEST_BASE,
    );
    expect(config.social.google).toEqual({ clientId: "g-id", clientSecret: "g-secret" });
    expect(config.social.microsoft).toEqual({ clientId: "m-id", clientSecret: "m-secret", tenantId: "common" });
    expect(config.social.github).toBeNull();
    expect(
      readIxAuthConfig({ BB_IX_AUTH_MICROSOFT_CLIENT_ID: "m", BB_IX_AUTH_MICROSOFT_CLIENT_SECRET: "s", BB_IX_AUTH_MICROSOFT_TENANT_ID: "contoso" }, IX_TEST_BASE).social.microsoft?.tenantId,
    ).toBe("contoso");
  });

  it("lists configured providers and password in status", async () => {
    const app = makeIxApp(
      await harness.makeService({ ...teamEnv, BB_IX_AUTH_GITHUB_CLIENT_ID: "gh", BB_IX_AUTH_GITHUB_CLIENT_SECRET: "s", BB_IX_AUTH_GOOGLE_CLIENT_ID: "only-id" }),
    );
    expect(await json(await app.request("/api/ix/status"))).toMatchObject({ password: true, providers: ["github"] });
    const none = makeIxApp(await harness.makeService(teamEnv));
    expect((await json(await none.request("/api/ix/status"))).providers).toEqual([]);
  });

  it("starts the provider redirect through better-auth's social endpoint", async () => {
    const app = makeIxApp(await harness.makeService({ ...teamEnv, BB_IX_AUTH_GITHUB_CLIENT_ID: "gh-client", BB_IX_AUTH_GITHUB_CLIENT_SECRET: "s" }));
    const response = await app.request(
      "/api/auth/sign-in/social",
      jsonInit({ provider: "github", callbackURL: `${IX_TEST_BASE}/` }, { origin: IX_TEST_BASE }),
    );
    expect(response.status).toBe(200);
    const url = new URL(String((await json(response)).url));
    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("client_id")).toBe("gh-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`${IX_TEST_BASE}/api/auth/callback/github`);
  });
});

describe("ix social sign-in: membership", () => {
  it("(a) makes the first signed-in user the owner of an unowned server", async () => {
    const ixAuth = await harness.makeService(teamEnv);
    const app = makeIxApp(ixAuth);
    const { cookie } = await oauthSessionCookie(ixAuth, { email: "first@example.test", emailVerified: true });
    const me = await app.request("/api/ix/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await json(me)).actor).toMatchObject({ kind: "user", role: "owner", user: { email: "first@example.test" } });
    expect(await ixAuth.status()).toMatchObject({ bootstrapped: true, orgName: "Acme" });
  });

  it("(b) accepts a pending invitation for a verified email, case-insensitively", async () => {
    const ixAuth = await harness.makeService(ownerEnv);
    const app = makeIxApp(ixAuth);
    const invitationId = await inviteAs(app, "Pat@Example.test", "admin");
    const { cookie } = await oauthSessionCookie(ixAuth, { email: "PAT@example.TEST", emailVerified: true, providerId: "microsoft" });
    const me = await app.request("/api/ix/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await json(me)).actor).toMatchObject({ kind: "user", role: "admin" });
    const invitation = (await ixAuth.listInvitations()).find((row) => row.id === invitationId);
    expect(invitation?.status).toBe("accepted");
    expect((await app.request("/api/v1/projects", { method: "POST", headers: { cookie, origin: IX_TEST_BASE } })).status).toBe(200);
  });

  it("(c) leaves a user without an invitation as a non-member with 403 ix_not_member", async () => {
    const ixAuth = await harness.makeService(ownerEnv);
    const app = makeIxApp(ixAuth);
    const { cookie } = await oauthSessionCookie(ixAuth, { email: "stranger@example.test", emailVerified: true, providerId: "github" });
    for (const path of ["/api/ix/me", "/api/v1/system/config"]) {
      const response = await app.request(path, { headers: { cookie, origin: IX_TEST_BASE } });
      expect(response.status, path).toBe(403);
      expect(await json(response)).toEqual({ code: "ix_not_member", message: NOT_MEMBER });
    }
    expect((await ixAuth.listMembers()).map((member) => member.email)).toEqual(["owner@example.test"]);
    const out = await app.request("/api/ix/sign-out", { method: "POST", headers: { cookie } });
    expect(out.status).toBe(200);
    expect((await app.request("/api/ix/me", { headers: { cookie } })).status).toBe(401);
  });

  it("does not accept an invitation when the provider has not verified the email", async () => {
    const ixAuth = await harness.makeService(ownerEnv);
    const app = makeIxApp(ixAuth);
    const invitationId = await inviteAs(app, "unverified@example.test", "member");
    const { cookie } = await oauthSessionCookie(ixAuth, { email: "unverified@example.test", emailVerified: false });
    const me = await app.request("/api/ix/me", { headers: { cookie } });
    expect(me.status).toBe(403);
    expect((await json(me)).code).toBe("ix_not_member");
    expect((await ixAuth.listInvitations()).find((row) => row.id === invitationId)?.status).toBe("pending");
  });

  it("does not accept an expired or canceled invitation", async () => {
    const ixAuth = await harness.makeService(ownerEnv);
    const app = makeIxApp(ixAuth);
    const expiredId = await inviteAs(app, "late@example.test", "member");
    const ctx = await ixAuth.internalAuthContext();
    await ctx.adapter.update({ model: "invitation", where: [{ field: "id", value: expiredId }], update: { expiresAt: new Date(Date.now() - 1000) } });
    const late = await oauthSessionCookie(ixAuth, { email: "late@example.test", emailVerified: true });
    expect((await app.request("/api/ix/me", { headers: { cookie: late.cookie } })).status).toBe(403);
    expect((await ixAuth.listInvitations()).find((row) => row.id === expiredId)?.status).toBe("pending");

    const canceledId = await inviteAs(app, "gone@example.test", "member");
    await ixAuth.cancelInvitation(canceledId);
    const gone = await oauthSessionCookie(ixAuth, { email: "gone@example.test", emailVerified: true });
    expect((await app.request("/api/ix/me", { headers: { cookie: gone.cookie } })).status).toBe(403);
  });

  it("lets exactly one of several concurrent first sign-ins become the owner", async () => {
    const ixAuth = await harness.makeService(teamEnv);
    const app = makeIxApp(ixAuth);
    const users = await Promise.all(
      ["one@example.test", "two@example.test", "three@example.test"].map((email) => oauthSessionCookie(ixAuth, { email, emailVerified: true })),
    );
    const responses = await Promise.all(users.map(({ cookie }) => app.request("/api/ix/me", { headers: { cookie } })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 403, 403]);
    const members = await ixAuth.listMembers();
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("owner");
    const ctx = await ixAuth.internalAuthContext();
    expect(await ctx.adapter.findMany({ model: "organization" })).toHaveLength(1);
  });

  it("does not let an email-and-password sign-up claim an invitation for its unverified address", async () => {
    const ixAuth = await harness.makeService(ownerEnv);
    const app = makeIxApp(ixAuth);
    await inviteAs(app, "victim@example.test", "admin");
    const signUp = await app.request(
      "/api/auth/sign-up/email",
      jsonInit({ email: "victim@example.test", password: "password-9", name: "Mallory" }, { origin: IX_TEST_BASE }),
    );
    expect(signUp.status).toBe(200);
    const signIn = await app.request("/api/ix/sign-in", jsonInit({ email: "victim@example.test", password: "password-9" }));
    expect(signIn.status).toBe(403);
    expect(await json(signIn)).toEqual({ code: "ix_not_member", message: NOT_MEMBER });
  });
});
