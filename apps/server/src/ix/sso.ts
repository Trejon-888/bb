import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { IX_ROLES } from "./config.js";
import type { IxKv } from "./kv.js";

export const IX_SSO_SECRET_KEY = "sso.secret";
export const IX_SSO_SECRET_MIN_LENGTH = 32;
const NONCE_KEY_PREFIX = "sso.nonce.";

export const ixSsoPayloadSchema = z
  .object({
    sub: z.string().email(),
    name: z.string().min(1).max(80),
    role: z.enum(IX_ROLES),
    workspaceId: z.string().min(1).max(200),
    exp: z.number().int().positive(),
    nonce: z.string().min(8).max(200),
  })
  .passthrough();

export type IxSsoPayload = z.infer<typeof ixSsoPayloadSchema>;

export const IX_SSO_REJECTIONS = ["no_secret", "malformed", "bad_signature", "expired", "replayed"] as const;
export type IxSsoRejection = (typeof IX_SSO_REJECTIONS)[number];

export class IxSsoError extends Error {
  readonly reason: IxSsoRejection;
  constructor(reason: IxSsoRejection) {
    super(`ix-sso: token rejected (${reason})`);
    this.reason = reason;
  }
}

function hmac(secret: string, payloadB64: string): Buffer {
  return createHmac("sha256", secret).update(payloadB64).digest();
}

export function signIxSsoToken(payload: IxSsoPayload, secret: string): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${hmac(secret, payloadB64).toString("base64url")}`;
}

export function verifyIxSsoToken(token: string, secret: string | null, now = Date.now()): IxSsoPayload {
  if (secret === null || secret.length < IX_SSO_SECRET_MIN_LENGTH) throw new IxSsoError("no_secret");
  const parts = token.split(".");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined || parts[0].length === 0) {
    throw new IxSsoError("malformed");
  }
  const [payloadB64, signatureB64] = parts;
  const expected = hmac(secret, payloadB64);
  const actual = Buffer.from(signatureB64, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new IxSsoError("bad_signature");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new IxSsoError("malformed");
  }
  const result = ixSsoPayloadSchema.safeParse(parsed);
  if (!result.success) throw new IxSsoError("malformed");
  if (result.data.exp * 1000 <= now) throw new IxSsoError("expired");
  return result.data;
}

export interface IxSsoReplayGuard {
  consume(nonce: string, expSeconds: number, now?: number): boolean;
}

export function createIxSsoReplayGuard(kv: IxKv): IxSsoReplayGuard {
  const seen = new Map<string, number>();
  let loaded = false;

  function load(): void {
    if (loaded) return;
    loaded = true;
    for (const row of kv.listPrefix(NONCE_KEY_PREFIX)) {
      const exp = Number(row.value);
      if (Number.isFinite(exp)) seen.set(row.key.slice(NONCE_KEY_PREFIX.length), exp);
    }
  }

  function prune(now: number): void {
    for (const [nonce, exp] of seen) {
      if (exp <= now) {
        seen.delete(nonce);
        kv.delete(`${NONCE_KEY_PREFIX}${nonce}`);
      }
    }
  }

  return {
    consume(nonce, expSeconds, now = Date.now()) {
      load();
      prune(now);
      if (seen.has(nonce)) return false;
      const expMs = expSeconds * 1000;
      seen.set(nonce, expMs);
      kv.set(`${NONCE_KEY_PREFIX}${nonce}`, String(expMs));
      return true;
    },
  };
}
