import { describe, expect, it } from "vitest";
import { IX_BRAND_ASSET_MAX_BYTES } from "./brand-assets.js";
import { createIxTestHarness, json, jsonInit, makeIxApp } from "./test-harness.js";

const harness = createIxTestHarness();
const ownerEnv = {
  BB_IX_AUTH: "team",
  BB_IX_AUTH_ORG_NAME: "Acme",
  BB_IX_AUTH_BOOTSTRAP_EMAIL: "owner@example.test",
  BB_IX_AUTH_BOOTSTRAP_PASSWORD: "password-1",
};
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");

function put(body: unknown, cookie?: string): RequestInit {
  return { ...jsonInit(body, cookie === undefined ? {} : { cookie }), method: "PUT" };
}

function png(): { contentType: string; dataBase64: string } {
  return { contentType: "image/png", dataBase64: PNG.toString("base64") };
}

function svg(text: string): { contentType: string; dataBase64: string } {
  return { contentType: "image/svg+xml", dataBase64: Buffer.from(text).toString("base64") };
}

describe("ix brand assets", () => {
  it("stores an upload, serves it with caching headers, and points the brand at it", async () => {
    const ixAuth = await harness.makeService(ownerEnv);
    const app = makeIxApp(ixAuth);
    const cookie = await harness.signInCookie(app, "owner@example.test", "password-1");
    const upload = await app.request("/api/ix/brand/assets/logo", put(png(), cookie));
    expect(upload.status).toBe(200);
    const body = await json(upload);
    const etag = String(body.etag);
    expect(body).toMatchObject({ ok: true, kind: "logo", contentType: "image/png", size: PNG.length });
    expect((await json(await app.request("/api/ix/brand"))).logoUrl).toBe(`/api/ix/brand/assets/logo?v=${etag}`);

    const served = await app.request(`/api/ix/brand/assets/logo?v=${etag}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toBe("public, max-age=300");
    expect(served.headers.get("etag")).toBe(`"${etag}"`);
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true);
    const cached = await app.request("/api/ix/brand/assets/logo", { headers: { "if-none-match": `"${etag}"` } });
    expect(cached.status).toBe(304);

    const favicon = await app.request("/api/ix/brand/assets/favicon", put({ contentType: "image/x-icon", dataBase64: PNG.toString("base64") }, cookie));
    expect(favicon.status).toBe(200);
    const brand = await json(await app.request("/api/ix/brand"));
    expect(brand.faviconUrl).toBe(`/api/ix/brand/assets/favicon?v=${String((await json(favicon)).etag)}`);
    expect(brand.logoUrl).toBe(`/api/ix/brand/assets/logo?v=${etag}`);
  });

  it("deletes an asset and clears the brand field it set", async () => {
    const ixAuth = await harness.makeService(ownerEnv);
    const app = makeIxApp(ixAuth, "127.0.0.1");
    expect((await app.request("/api/ix/brand", put({ name: "Acme" }))).status).toBe(200);
    expect((await app.request("/api/ix/brand/assets/icon", put(png()))).status).toBe(200);
    expect((await json(await app.request("/api/ix/brand"))).iconUrl).toMatch(/^\/api\/ix\/brand\/assets\/icon\?v=/);
    const removed = await app.request("/api/ix/brand/assets/icon", { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect((await json(removed)).brand).toEqual({ name: "Acme" });
    expect(await json(await app.request("/api/ix/brand"))).toEqual({ name: "Acme" });
    expect((await app.request("/api/ix/brand/assets/icon")).status).toBe(404);
  });

  it("keeps an external URL the admin set when an unrelated asset is cleared", async () => {
    const app = makeIxApp(await harness.makeService(ownerEnv), "127.0.0.1");
    await app.request("/api/ix/brand", put({ logoUrl: "https://cdn.example.test/logo.png" }));
    await app.request("/api/ix/brand/assets/logo", { method: "DELETE" });
    expect((await json(await app.request("/api/ix/brand"))).logoUrl).toBe("https://cdn.example.test/logo.png");
  });

  it("requires admin or the loopback owner to write", async () => {
    const ixAuth = await harness.makeService(ownerEnv);
    const app = makeIxApp(ixAuth);
    expect((await app.request("/api/ix/brand/assets/logo", put(png()))).status).toBe(401);
    expect((await app.request("/api/ix/brand/assets/logo", { method: "DELETE" })).status).toBe(401);
    const ownerCookie = await harness.signInCookie(app, "owner@example.test", "password-1");
    const invite = await app.request("/api/ix/members/invite", jsonInit({ email: "m@example.test", role: "member" }, { cookie: ownerCookie }));
    const invitation = (await json(invite)).invitation as { id: string };
    const accept = await app.request("/api/ix/invitations/accept", jsonInit({ token: invitation.id, name: "Em", password: "password-2" }));
    const memberCookie = (accept.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect((await app.request("/api/ix/brand/assets/logo", put(png(), memberCookie))).status).toBe(403);
    expect((await app.request("/api/ix/brand/assets/logo", { method: "DELETE", headers: { cookie: memberCookie } })).status).toBe(403);
    expect((await app.request("/api/ix/brand/assets/logo")).status).toBe(404);
    expect((await makeIxApp(ixAuth, "127.0.0.1").request("/api/ix/brand/assets/logo", put(png()))).status).toBe(200);
  });

  it("refuses assets over 2 MB", async () => {
    const app = makeIxApp(await harness.makeService(ownerEnv), "127.0.0.1");
    const atLimit = Buffer.alloc(IX_BRAND_ASSET_MAX_BYTES, 1);
    expect((await app.request("/api/ix/brand/assets/logo", put({ contentType: "image/png", dataBase64: atLimit.toString("base64") }))).status).toBe(200);
    const over = Buffer.alloc(IX_BRAND_ASSET_MAX_BYTES + 1, 1);
    const response = await app.request("/api/ix/brand/assets/logo", put({ contentType: "image/png", dataBase64: over.toString("base64") }));
    expect(response.status).toBe(413);
    const huge = await app.request("/api/ix/brand/assets/logo", put({ contentType: "image/png", dataBase64: "A".repeat(4 * 1024 * 1024) }));
    expect(huge.status).toBe(413);
  });

  it("rejects SVGs with scripts or event handlers, and malformed input", async () => {
    const app = makeIxApp(await harness.makeService(ownerEnv), "127.0.0.1");
    for (const text of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT href="x"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onClick = "x"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
    ]) {
      const response = await app.request("/api/ix/brand/assets/logo", put(svg(text)));
      expect(response.status, text).toBe(400);
      expect((await json(response)).code).toBe("ix_asset_unsafe_svg");
    }
    const clean = await app.request("/api/ix/brand/assets/logo", put(svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#1ae5be"/></svg>')));
    expect(clean.status).toBe(200);
    const served = await app.request("/api/ix/brand/assets/logo");
    expect(served.headers.get("content-type")).toBe("image/svg+xml");
    expect(served.headers.get("content-security-policy")).toContain("sandbox");

    for (const body of [
      { contentType: "text/html", dataBase64: PNG.toString("base64") },
      { contentType: "image/png", dataBase64: "not base64!!" },
      { contentType: "image/png", dataBase64: "" },
      { contentType: "image/png", dataBase64: PNG.toString("base64"), extra: true },
    ]) {
      expect((await app.request("/api/ix/brand/assets/logo", put(body))).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect((await app.request("/api/ix/brand/assets/banner", put(png()))).status).toBe(404);
    expect((await app.request("/api/ix/brand/assets/banner")).status).toBe(404);
  });

  it("accepts relative asset paths for logo and favicon in the brand record but not protocol-relative ones", async () => {
    const app = makeIxApp(await harness.makeService(ownerEnv), "127.0.0.1");
    expect((await app.request("/api/ix/brand", put({ logoUrl: "/api/ix/brand/assets/logo?v=abc", faviconUrl: "/favicon.png" }))).status).toBe(200);
    for (const value of ["//evil.example.test/x.png", "/a b", "javascript:alert(1)", "relative/path.png"]) {
      expect((await app.request("/api/ix/brand", put({ logoUrl: value }))).status, value).toBe(400);
    }
    expect((await app.request("/api/ix/brand", put({ supportUrl: "/help" }))).status).toBe(400);
  });
});
