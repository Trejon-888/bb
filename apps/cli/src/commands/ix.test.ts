import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assetContentType, registerIxCommands } from "./ix.js";

describe("bb ix command handlers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses the configured URL and headers and prints raw JSON", async () => {
    vi.stubEnv("BB_SERVER_HEADERS", JSON.stringify({ "x-access": "configured" }));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ mode: "team", bootstrapped: true, orgName: "Acme", brand: {} }), { status: 200 }),
    );
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    registerIxCommands(program, () => "https://ix.example");

    await program.parseAsync(["ix", "status", "--json"], { from: "user" });

    expect(fetchMock).toHaveBeenCalledWith("https://ix.example/api/ix/status", expect.objectContaining({ method: "GET", headers: { "x-access": "configured" } }));
    expect(output).toHaveBeenCalledWith(JSON.stringify({ mode: "team", bootstrapped: true, orgName: "Acme", brand: {} }, null, 2));
  });

  it("sends invite role and displays the returned accept URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ invitation: { id: "invite-1", email: "a@example.com", role: "viewer" }, acceptUrl: "https://ix.example/?ix-invite=invite-1" }), { status: 200 }),
    );
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    registerIxCommands(program, () => "https://ix.example");

    await program.parseAsync(["ix", "invite", "a@example.com", "--role", "viewer"], { from: "user" });

    expect(fetchMock).toHaveBeenCalledWith("https://ix.example/api/ix/members/invite", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "a@example.com", role: "viewer" }) }));
    expect(output).toHaveBeenCalledWith("Accept URL: https://ix.example/?ix-invite=invite-1");
  });

  it("reports the server error code and message and exits 1", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "ix_forbidden", message: "Owner access required" }), { status: 403 }),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
    const program = new Command();
    registerIxCommands(program, () => "http://ix.example");

    await expect(program.parseAsync(["ix", "brand", "get"], { from: "user" })).rejects.toThrow("exit:1");
    expect(error).toHaveBeenCalledWith("Error: HTTP 403: Owner access required");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("uploads a brand asset with the content type inferred from the extension", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-ix-asset-"));
    try {
      const file = join(dir, "Logo.SVG");
      await writeFile(file, "<svg/>");
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ ok: true, kind: "logo", contentType: "image/svg+xml", size: 6, etag: "abc", brand: { logoUrl: "/api/ix/brand/assets/logo?v=abc" } }), { status: 200 }),
      );
      const output = vi.spyOn(console, "log").mockImplementation(() => {});
      const program = new Command();
      registerIxCommands(program, () => "https://ix.example");

      await program.parseAsync(["ix", "brand", "asset", "set", "logo", file], { from: "user" });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://ix.example/api/ix/brand/assets/logo",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ contentType: "image/svg+xml", dataBase64: Buffer.from("<svg/>").toString("base64") }) }),
      );
      expect(output).toHaveBeenCalledWith("Uploaded logo (image/svg+xml, 6 bytes, etag abc).");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("clears a brand asset with DELETE and refuses unknown kinds and extensions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, brand: {} }), { status: 200 }));
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    registerIxCommands(program, () => "https://ix.example");

    await program.parseAsync(["ix", "brand", "asset", "clear", "favicon"], { from: "user" });
    expect(fetchMock).toHaveBeenCalledWith("https://ix.example/api/ix/brand/assets/favicon", expect.objectContaining({ method: "DELETE" }));
    expect(output).toHaveBeenCalledWith("Cleared favicon.");
    expect(() => assetContentType("logo.gif")).toThrow("Cannot infer an image type");
    expect(assetContentType("x.JPEG")).toBe("image/jpeg");
  });

  it("changes only the given sharing-policy fields and adds people to a chat by email", async () => {
    const policy = { defaultShare: "private", allowedShares: ["private", "project", "workspace", "people"], whoCanChange: "starter", participantsCanAdd: false, adminsSeeAll: false };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/ix/sharing-policy") && init?.method === "PUT") return new Response(JSON.stringify({ ok: true, policy: JSON.parse(String(init.body)) }), { status: 200 });
      if (url.endsWith("/api/ix/sharing-policy")) return new Response(JSON.stringify({ policy }), { status: 200 });
      if (url.endsWith("/api/ix/members")) return new Response(JSON.stringify({ members: [{ id: "m1", userId: "u-ben", email: "ben@example.com", name: "Ben", role: "member", createdAt: "x" }] }), { status: 200 });
      if (url.endsWith("/api/ix/threads/t1/people")) return new Response(JSON.stringify({ share: "private", owner: { id: "u-me", name: "Me", email: "me@example.com" }, people: [{ id: "u-ben", name: "Ben", email: "ben@example.com" }] }), { status: 200 });
      throw new Error(`unexpected ${url}`);
    });
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    registerIxCommands(program, () => "https://ix.example");

    await program.parseAsync(["ix", "sharing", "policy", "--allow", "private,people", "--admins-see-all", "on"], { from: "user" });
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ ...policy, allowedShares: ["private", "people"], adminsSeeAll: true });
    expect(output).toHaveBeenCalledWith("Owners and admins can read any chat: on");

    await program.parseAsync(["ix", "chat", "add", "t1", "BEN@example.com"], { from: "user" });
    const post = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/threads/t1/people"));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ userIds: ["u-ben"] });
    expect(output).toHaveBeenCalledWith("People: Ben <ben@example.com>");
  });
});
