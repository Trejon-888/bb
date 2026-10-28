import { describe, expect, it } from "vitest";
import { createIxTestHarness, json, jsonInit, makeIxApp } from "./test-harness.js";

const harness = createIxTestHarness();
const ownerEnv = {
  BB_IX_AUTH: "team",
  BB_IX_AUTH_ORG_NAME: "Acme",
  BB_IX_AUTH_BOOTSTRAP_EMAIL: "owner@example.test",
  BB_IX_AUTH_BOOTSTRAP_PASSWORD: "password-1",
};

function put(body: unknown, cookie?: string): RequestInit {
  return { ...jsonInit(body, cookie === undefined ? {} : { cookie }), method: "PUT" };
}

describe("ix brand", () => {
  it("starts empty, is readable publicly, and appears in status", async () => {
    const app = makeIxApp(await harness.makeService(ownerEnv));
    expect(await json(await app.request("/api/ix/brand"))).toEqual({});
    expect((await json(await app.request("/api/ix/status"))).brand).toEqual({});
  });

  it("owner and loopback can set it; viewers cannot; anonymous cannot", async () => {
    const ixAuth = await harness.makeService(ownerEnv);
    const app = makeIxApp(ixAuth);
    const ownerCookie = await harness.signInCookie(app, "owner@example.test", "password-1");
    const anonymous = await app.request("/api/ix/brand", put({ name: "Nope" }));
    expect(anonymous.status).toBe(401);

    const set = await app.request(
      "/api/ix/brand",
      put({ name: "Acme", logoUrl: "https://cdn.example.test/logo.svg", accent: "#1AE5BE", appTitle: "Acme Console", loginTitle: "Welcome to Acme", loginSubtitle: "Sign in with your Acme account", supportUrl: "https://acme.example.test/help" }, ownerCookie),
    );
    expect(set.status).toBe(200);
    expect(await json(await app.request("/api/ix/brand"))).toEqual({
      name: "Acme",
      logoUrl: "https://cdn.example.test/logo.svg",
      accent: "#1AE5BE",
      appTitle: "Acme Console",
      loginTitle: "Welcome to Acme",
      loginSubtitle: "Sign in with your Acme account",
      supportUrl: "https://acme.example.test/help",
    });
    expect((await json(await app.request("/api/ix/status"))).brand).toMatchObject({ appTitle: "Acme Console" });

    const invite = await app.request("/api/ix/members/invite", jsonInit({ email: "v@example.test", role: "viewer" }, { cookie: ownerCookie }));
    const invitation = (await json(invite)).invitation as { id: string };
    const accept = await app.request("/api/ix/invitations/accept", jsonInit({ token: invitation.id, name: "Vee", password: "password-2" }));
    const viewerCookie = (accept.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const viewerPut = await app.request("/api/ix/brand", put({ name: "Hijacked" }, viewerCookie));
    expect(viewerPut.status).toBe(403);
    expect((await json(await app.request("/api/ix/brand"))).name).toBe("Acme");

    const loopback = makeIxApp(ixAuth, "127.0.0.1");
    const loopbackPut = await loopback.request("/api/ix/brand", put({ name: "Loopback" }));
    expect(loopbackPut.status).toBe(200);
    expect(await json(await app.request("/api/ix/brand"))).toEqual({ name: "Loopback" });
  });

  it("rejects non-http urls, bad colors and unknown fields", async () => {
    const app = makeIxApp(await harness.makeService(ownerEnv), "127.0.0.1");
    for (const body of [
      { logoUrl: "javascript:alert(1)" },
      { faviconUrl: "ftp://x.example.test/f.ico" },
      { accent: "red; background: url(x)" },
      { unknown: "field" },
      { name: "" },
    ]) {
      const response = await app.request("/api/ix/brand", put(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(await json(await app.request("/api/ix/brand"))).toEqual({});
  });

  it("survives a corrupt kv row by reporting an empty brand", async () => {
    const ixAuth = await harness.makeService(ownerEnv);
    ixAuth.kv.set("brand", "{not json");
    expect(ixAuth.brand()).toEqual({});
    ixAuth.kv.set("brand", JSON.stringify({ name: "ok", logoUrl: "not a url" }));
    expect(ixAuth.brand()).toEqual({});
  });

  it("carries the shell layout choice and rejects unknown layouts", async () => {
    const ixAuth = await harness.makeService(ownerEnv);
    const app = makeIxApp(ixAuth);
    const ownerCookie = await harness.signInCookie(app, "owner@example.test", "password-1");
    expect((await app.request("/api/ix/brand", put({ name: "ECM", shell: "simple" }, ownerCookie))).status).toBe(200);
    expect((await json(await app.request("/api/ix/status"))).brand).toEqual({ name: "ECM", shell: "simple" });
    expect((await app.request("/api/ix/brand", put({ shell: "compact" }, ownerCookie))).status).toBe(400);
    expect((await app.request("/api/ix/brand", put({ name: "Advisy", appTitle: "Nexus", shell: "nexus" }, ownerCookie))).status).toBe(200);
    expect((await json(await app.request("/api/ix/status"))).brand).toEqual({ name: "Advisy", appTitle: "Nexus", shell: "nexus" });
  });
});
