import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerIxCommands } from "./ix.js";

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
});
