import { z } from "zod";
import type { IxKv } from "./kv.js";

export const IX_BRAND_KEY = "brand";

const httpUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), { message: "must be an http(s) URL" });
const assetUrl = z.union([
  httpUrl,
  z
    .string()
    .max(2048)
    .regex(/^\/(?!\/)[^\s\\]*$/, { message: "must be an http(s) URL or a path starting with /" }),
]);
const cssColor = z
  .string()
  .max(64)
  .regex(/^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla|oklch|oklab)\([\d\s.,%/-]+\))$/i, {
    message: "must be a hex or functional CSS color",
  });
const shortText = z.string().min(1).max(80);
const longText = z.string().min(1).max(200);

export const ixBrandSchema = z
  .object({
    name: shortText.optional(),
    logoUrl: assetUrl.optional(),
    accent: cssColor.optional(),
    appTitle: shortText.optional(),
    loginTitle: shortText.optional(),
    loginSubtitle: longText.optional(),
    supportUrl: httpUrl.optional(),
    faviconUrl: assetUrl.optional(),
    iconUrl: assetUrl.optional(),
  })
  .strict();

export type IxBrand = z.infer<typeof ixBrandSchema>;

export function readIxBrand(kv: IxKv): IxBrand {
  const raw = kv.get(IX_BRAND_KEY);
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const result = ixBrandSchema.safeParse(parsed);
  return result.success ? result.data : {};
}

export function writeIxBrand(kv: IxKv, brand: IxBrand): IxBrand {
  const compact = Object.fromEntries(Object.entries(brand).filter(([, value]) => value !== undefined)) as IxBrand;
  kv.set(IX_BRAND_KEY, JSON.stringify(compact));
  return compact;
}
