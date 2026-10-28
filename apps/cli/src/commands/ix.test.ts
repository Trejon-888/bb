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
});
