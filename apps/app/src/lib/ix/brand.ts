import { useSyncExternalStore } from "react";

export const PRODUCT_NAME = "bb";
let resolvedProductName: string = PRODUCT_NAME;
const listeners = new Set<() => void>();

export function productName(): string {
  return resolvedProductName;
}

export function setBrandProductName(name: string | null): void {
  const next = name !== null && name.trim().length > 0 ? name.trim() : PRODUCT_NAME;
  if (next === resolvedProductName) return;
  resolvedProductName = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useProductName(): string {
  return useSyncExternalStore(subscribe, productName, productName);
}

const BRAND_ICON_ID = "ix-brand-icon";
const BRAND_TOUCH_ICON_ID = "ix-brand-apple-touch-icon";
const DISABLED_REL_ATTRIBUTE = "data-ix-original-rel";

function swapLinkRel(rel: string, ownId: string, href: string | null): void {
  const own = document.getElementById(ownId);
  const upstream = Array.from(document.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"], link[${DISABLED_REL_ATTRIBUTE}="${rel}"]`)).filter(
    (link) => link.id !== ownId,
  );
  if (href === null) {
    own?.remove();
    for (const link of upstream) {
      const original = link.getAttribute(DISABLED_REL_ATTRIBUTE);
      if (original === null) continue;
      link.rel = original;
      link.removeAttribute(DISABLED_REL_ATTRIBUTE);
    }
    return;
  }
  for (const link of upstream) {
    if (link.getAttribute(DISABLED_REL_ATTRIBUTE) !== null) continue;
    link.setAttribute(DISABLED_REL_ATTRIBUTE, rel);
    link.rel = `ix-disabled-${rel}`;
  }
  const link = own instanceof HTMLLinkElement ? own : document.createElement("link");
  link.id = ownId;
  link.rel = rel;
  if (link.getAttribute("href") !== href) link.href = href;
  if (link.parentNode === null) document.head.appendChild(link);
}

export function applyBrandIcons(brand: { faviconUrl?: string; iconUrl?: string }): void {
  if (typeof document === "undefined") return;
  swapLinkRel("icon", BRAND_ICON_ID, brand.faviconUrl ?? null);
  swapLinkRel("apple-touch-icon", BRAND_TOUCH_ICON_ID, brand.iconUrl ?? brand.faviconUrl ?? null);
}
