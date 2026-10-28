import { createHash } from "node:crypto";
import { z } from "zod";
import type { IxKv } from "./kv.js";

export const IX_BRAND_ASSET_KINDS = ["logo", "favicon", "icon"] as const;
export type IxBrandAssetKind = (typeof IX_BRAND_ASSET_KINDS)[number];
export const IX_BRAND_ASSET_CONTENT_TYPES = ["image/png", "image/svg+xml", "image/x-icon", "image/webp", "image/jpeg"] as const;
export type IxBrandAssetContentType = (typeof IX_BRAND_ASSET_CONTENT_TYPES)[number];
export const IX_BRAND_ASSET_MAX_BYTES = 2 * 1024 * 1024;
export const IX_BRAND_ASSET_MAX_BODY_BYTES = Math.ceil((IX_BRAND_ASSET_MAX_BYTES * 4) / 3) + 4096;
const KEY_PREFIX = "brand.asset.";

export const ixBrandAssetInputSchema = z
  .object({
    contentType: z.enum(IX_BRAND_ASSET_CONTENT_TYPES),
    dataBase64: z.string().min(1).max(IX_BRAND_ASSET_MAX_BODY_BYTES),
  })
  .strict();
export type IxBrandAssetInput = z.infer<typeof ixBrandAssetInputSchema>;

const storedSchema = z.object({
  contentType: z.enum(IX_BRAND_ASSET_CONTENT_TYPES),
  dataBase64: z.string(),
  etag: z.string(),
  size: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type IxBrandAsset = z.infer<typeof storedSchema>;

export class IxBrandAssetError extends Error {
  readonly code: "too_large" | "bad_base64" | "unsafe_svg" | "empty";
  constructor(code: IxBrandAssetError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const UNSAFE_SVG_PATTERNS = [/<script/i, /\son[a-z0-9_-]*\s*=/i, /javascript\s*:/i];

export function parseIxBrandAssetKind(value: string): IxBrandAssetKind | null {
  return (IX_BRAND_ASSET_KINDS as readonly string[]).includes(value) ? (value as IxBrandAssetKind) : null;
}

export function ixBrandAssetPath(kind: IxBrandAssetKind, etag: string): string {
  return `/api/ix/brand/assets/${kind}?v=${etag}`;
}

export function decodeIxBrandAsset(input: IxBrandAssetInput): Buffer {
  const compact = input.dataBase64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) {
    throw new IxBrandAssetError("bad_base64", "dataBase64 is not valid base64");
  }
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length === 0) throw new IxBrandAssetError("empty", "The asset is empty");
  if (bytes.length > IX_BRAND_ASSET_MAX_BYTES) {
    throw new IxBrandAssetError("too_large", `The asset is ${bytes.length} bytes; the limit is ${IX_BRAND_ASSET_MAX_BYTES}`);
  }
  if (input.contentType === "image/svg+xml") {
    const text = bytes.toString("utf8");
    if (UNSAFE_SVG_PATTERNS.some((pattern) => pattern.test(text))) {
      throw new IxBrandAssetError("unsafe_svg", "SVG assets may not contain scripts, event handler attributes or javascript: URLs");
    }
  }
  return bytes;
}

export function writeIxBrandAsset(kv: IxKv, kind: IxBrandAssetKind, input: IxBrandAssetInput): IxBrandAsset {
  const bytes = decodeIxBrandAsset(input);
  const asset: IxBrandAsset = {
    contentType: input.contentType,
    dataBase64: bytes.toString("base64"),
    etag: createHash("sha256").update(input.contentType).update("\0").update(bytes).digest("hex").slice(0, 20),
    size: bytes.length,
    updatedAt: new Date().toISOString(),
  };
  kv.set(`${KEY_PREFIX}${kind}`, JSON.stringify(asset));
  return asset;
}

export function readIxBrandAsset(kv: IxKv, kind: IxBrandAssetKind): IxBrandAsset | null {
  const raw = kv.get(`${KEY_PREFIX}${kind}`);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = storedSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function clearIxBrandAsset(kv: IxKv, kind: IxBrandAssetKind): void {
  kv.delete(`${KEY_PREFIX}${kind}`);
}
