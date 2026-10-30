import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createNodeBbSdk, type BbSdk } from "@bb/sdk/node";
import { createNodeWebsocketFactory } from "@bb/sdk/node-websocket";
import type { Dispatcher } from "undici";
import { CliUsageError } from "./cli-usage-error.js";

type CliRequestInit = RequestInit & { dispatcher?: Dispatcher };

const IX_OWNER_TOKEN_FILE_NAME = "ix-owner-token";

function readTokenFile(path: string): string | null {
  try {
    const value = readFileSync(path, "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function resolveCliServerToken(env: NodeJS.ProcessEnv): string | null {
  const scoped = env.BB_IX_TOKEN?.trim();
  if (scoped !== undefined && scoped.length > 0) return scoped;
  const ownerFile = env.BB_IX_OWNER_TOKEN_FILE?.trim();
  if (ownerFile !== undefined && ownerFile.length > 0) {
    const token = readTokenFile(ownerFile);
    if (token === null) {
      throw new CliUsageError({
        code: "invalid_value",
        hint: null,
        message: `BB_IX_OWNER_TOKEN_FILE points at ${ownerFile}, which is missing, empty or unreadable.`,
      });
    }
    return token;
  }
  const dataDir = env.BB_DATA_DIR?.trim();
  if (dataDir === undefined || dataDir.length === 0) return null;
  return readTokenFile(join(dataDir, IX_OWNER_TOKEN_FILE_NAME));
}

function cliServerToken(): string | null {
  return resolveCliServerToken(process.env);
}

export function cliAuthHeaders(): Record<string, string> {
  const token = cliServerToken();
  return token === null ? {} : { authorization: `Bearer ${token}` };
}

export function cliFetch(
  input: RequestInfo | URL,
  init?: CliRequestInit,
): Promise<Response> {
  const token = cliServerToken();
  if (token === null) return fetch(input, init);
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export function createCliBbSdk(baseUrl: string): BbSdk {
  return createNodeBbSdk({
    baseUrl,
    fetch: cliFetch,
    websocket: createNodeWebsocketFactory({ headers: cliAuthHeaders() }),
  });
}
