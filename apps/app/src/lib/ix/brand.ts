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
