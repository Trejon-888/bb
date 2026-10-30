import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cliFetch, resolveCliServerToken } from "../client.js";
import { CliUsageError } from "../cli-usage-error.js";

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  while (dirs.length > 0) await rm(dirs.pop() ?? "", { recursive: true, force: true });
});

async function dataDirWithOwnerToken(token: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-cli-auth-"));
  dirs.push(dir);
  await writeFile(join(dir, "ix-owner-token"), `${token}\n`, { mode: 0o600 });
  return dir;
}

describe("cli server token", () => {
  it("prefers the chat's scoped token over any owner token", async () => {
    const dir = await dataDirWithOwnerToken("ixo1.0.owner");
    expect(resolveCliServerToken({ BB_IX_TOKEN: "ixt1.a.b.0.c", BB_IX_OWNER_TOKEN_FILE: join(dir, "ix-owner-token"), BB_DATA_DIR: dir })).toBe("ixt1.a.b.0.c");
  });

  it("reads the owner token from BB_IX_OWNER_TOKEN_FILE, then from BB_DATA_DIR", async () => {
    const dir = await dataDirWithOwnerToken("ixo1.0.owner");
    expect(resolveCliServerToken({ BB_IX_OWNER_TOKEN_FILE: join(dir, "ix-owner-token") })).toBe("ixo1.0.owner");
    expect(resolveCliServerToken({ BB_DATA_DIR: dir })).toBe("ixo1.0.owner");
    expect(resolveCliServerToken({ BB_DATA_DIR: join(dir, "missing") })).toBeNull();
    expect(resolveCliServerToken({})).toBeNull();
  });

  it("fails loudly when BB_IX_OWNER_TOKEN_FILE is set but unreadable", () => {
    expect(() => resolveCliServerToken({ BB_IX_OWNER_TOKEN_FILE: "/nonexistent/ix-owner-token" })).toThrow(CliUsageError);
  });

  it("sends the token as a bearer header without replacing an explicit one", async () => {
    const seen: Array<string | null> = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("authorization"));
      return new Response("{}");
    });
    vi.stubEnv("BB_IX_TOKEN", "ixt1.a.b.0.c");
    await cliFetch("http://127.0.0.1:1/api/v1/system/config", { headers: { accept: "application/json" } });
    await cliFetch("http://127.0.0.1:1/api/v1/system/config", { headers: { authorization: "Bearer other" } });
    vi.stubEnv("BB_IX_TOKEN", "");
    vi.stubEnv("BB_IX_OWNER_TOKEN_FILE", "");
    vi.stubEnv("BB_DATA_DIR", "");
    await cliFetch("http://127.0.0.1:1/api/v1/system/config");
    expect(seen).toEqual(["Bearer ixt1.a.b.0.c", "Bearer other", null]);
  });
});
