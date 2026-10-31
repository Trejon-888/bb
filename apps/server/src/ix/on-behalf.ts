import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { roleAtLeast } from "./config.js";
import type { IxActor } from "./context.js";

export const IX_ON_BEHALF_HEADER = "x-bb-ix-on-behalf";

const current = new AsyncLocalStorage<string>();
const actors = new Map<string, IxActor>();

export async function runIxOnBehalfOf<T>(actor: IxActor | undefined, fn: () => Promise<T>): Promise<T> {
  if (actor?.kind !== "user" || roleAtLeast(actor.role, "admin")) return fn();
  const token = randomBytes(24).toString("base64url");
  actors.set(token, actor);
  try {
    return await current.run(token, fn);
  } finally {
    actors.delete(token);
  }
}

export function ixOnBehalfToken(): string | undefined {
  return current.getStore();
}

export function resolveIxOnBehalf(token: string): IxActor | undefined {
  return actors.get(token);
}

export function withIxOnBehalfHeader(headers: Headers): Headers {
  const token = current.getStore();
  if (token !== undefined) headers.set(IX_ON_BEHALF_HEADER, token);
  return headers;
}
