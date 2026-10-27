import { useQuery } from "@tanstack/react-query";
import { fetchWithAppSurface } from "@/lib/app-surface";

export const PRODUCT_NAME = "bb";

const BRAND_URL = "/api/ix/brand";
const BRAND_QUERY_KEY = ["ix", "brand"] as const;

let resolvedProductName: string = PRODUCT_NAME;

export function productName(): string {
  return resolvedProductName;
}

function readBrandName(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["appTitle", "name"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export async function fetchBrandProductName(): Promise<string> {
  try {
    const response = await fetchWithAppSurface(BRAND_URL, {
      credentials: "include",
    });
    if (!response.ok) return resolvedProductName;
    resolvedProductName = readBrandName(await response.json()) ?? PRODUCT_NAME;
  } catch {
    return resolvedProductName;
  }
  return resolvedProductName;
}

export function useProductName(): string {
  const query = useQuery({
    queryKey: BRAND_QUERY_KEY,
    queryFn: fetchBrandProductName,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  return query.data ?? resolvedProductName;
}
