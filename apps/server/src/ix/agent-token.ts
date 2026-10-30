import { createHmac, timingSafeEqual } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HostDaemonContributedEnvEntry } from "@bb/host-daemon-contract";
import { currentIxUser } from "./access.js";

export const IX_AGENT_TOKEN_ENV = "BB_IX_TOKEN";
export const IX_OWNER_TOKEN_FILE_ENV = "BB_IX_OWNER_TOKEN_FILE";
export const IX_OWNER_TOKEN_FILE_NAME = "ix-owner-token";
export const IX_AGENT_TOKEN_KEY_FILE_NAME = "ix-agent-token-key";
export const IX_AGENT_TOKEN_EPOCH_KEY = "agent_token:epoch";
export const IX_RESERVED_AGENT_ENV = new Set([IX_AGENT_TOKEN_ENV, IX_OWNER_TOKEN_FILE_ENV]);

const AGENT_PREFIX = "ixt1";
const OWNER_PREFIX = "ixo1";
const NO_THREAD = "-";
const ACTING_PERSON = "-";

export type IxAgentTokenClaims =
  | { threadId: string; userId: string | null; epoch: number }
  | { threadId: null; userId: string; epoch: number };

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  return encode(decoded) === value ? decoded : null;
}

function mac(key: string, message: string): string {
  return createHmac("sha256", key).update(message).digest("base64url");
}

function macMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function mintIxAgentToken(key: string, claims: IxAgentTokenClaims): string {
  const thread = claims.threadId === null ? NO_THREAD : encode(claims.threadId);
  const user = claims.userId === null ? ACTING_PERSON : encode(claims.userId);
  const body = `${AGENT_PREFIX}.${thread}.${user}.${claims.epoch}`;
  return `${body}.${mac(key, body)}`;
}

export function verifyIxAgentToken(key: string, raw: string): IxAgentTokenClaims | null {
  const parts = raw.split(".");
  if (parts.length !== 5 || parts[0] !== AGENT_PREFIX) return null;
  const [, thread = "", user = "", epochText = "", presented = ""] = parts;
  if (!/^\d{1,15}$/u.test(epochText)) return null;
  if (!macMatches(presented, mac(key, `${AGENT_PREFIX}.${thread}.${user}.${epochText}`))) return null;
  const epoch = Number(epochText);
  if (thread === NO_THREAD) {
    const userId = user === ACTING_PERSON ? null : decode(user);
    return userId === null || userId.length === 0 ? null : { threadId: null, userId, epoch };
  }
  const threadId = decode(thread);
  if (threadId === null || threadId.length === 0) return null;
  if (user === ACTING_PERSON) return { threadId, userId: null, epoch };
  const userId = decode(user);
  return userId === null || userId.length === 0 ? null : { threadId, userId, epoch };
}

export function mintIxOwnerToken(key: string, epoch: number): string {
  const body = `${OWNER_PREFIX}.${epoch}`;
  return `${body}.${mac(key, body)}`;
}

export function verifyIxOwnerToken(key: string, epoch: number, raw: string): boolean {
  return macMatches(raw, mintIxOwnerToken(key, epoch));
}

export function ixTokenKind(raw: string): "agent" | "owner" | null {
  if (raw.startsWith(`${AGENT_PREFIX}.`)) return "agent";
  if (raw.startsWith(`${OWNER_PREFIX}.`)) return "owner";
  return null;
}

export function ixOwnerTokenPath(dataDir: string): string {
  return join(dataDir, IX_OWNER_TOKEN_FILE_NAME);
}

export async function writeIxOwnerTokenFile(dataDir: string, token: string): Promise<string> {
  const path = ixOwnerTokenPath(dataDir);
  await writeFile(path, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

export function withoutReservedIxEnv(entries: readonly HostDaemonContributedEnvEntry[]): HostDaemonContributedEnvEntry[] {
  return entries.filter((entry) => !IX_RESERVED_AGENT_ENV.has(entry.name));
}

type IxAgentTokenIssuer = (target: { threadId: string } | { userId: string }) => Promise<string | null>;
let issuer: IxAgentTokenIssuer | null = null;

export function setIxAgentTokenIssuer(next: IxAgentTokenIssuer | null): void {
  issuer = next;
}

export async function ixAgentTokenEnv(target: { threadId: string } | { userId: string }): Promise<HostDaemonContributedEnvEntry[]> {
  if (issuer === null) return [];
  const token = await issuer(target);
  if (token === null) return [];
  return [{ name: IX_AGENT_TOKEN_ENV, value: token, source: { core: "machine-environment" }, reason: "ix: server token scoped to this chat; it acts as the chat's current acting person" }];
}

export async function ixTerminalTokenEnv(entries: readonly HostDaemonContributedEnvEntry[]): Promise<HostDaemonContributedEnvEntry[]> {
  const opener = currentIxUser();
  return [...withoutReservedIxEnv(entries), ...(opener === null ? [] : await ixAgentTokenEnv({ userId: opener.userId }))];
}
