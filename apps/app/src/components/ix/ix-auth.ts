import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWithAppSurface } from "@/lib/app-surface";

export type IxRole = "owner" | "admin" | "member" | "viewer";
export type IxActor =
  | {
      kind: "user";
      user: { id: string; email: string; name: string };
      organizationId: string;
      memberId: string;
      role: IxRole;
    }
  | { kind: "loopback-owner" }
  | { kind: "off" };

export interface IxMe {
  actor: IxActor;
  mode: "off" | "team";
  orgName: string | null;
}
export interface IxStatus {
  mode: "off" | "team";
  bootstrapped: boolean;
  orgName: string | null;
}
export interface IxMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: IxRole;
  createdAt: string;
}
export interface IxInvitation {
  id: string;
  email: string;
  role: IxRole;
  status: string;
  expiresAt: string;
}

const BASE_URL =
  typeof window === "undefined" ? "http://localhost" : window.location.origin;
const ROLE_RANK: Record<IxRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };
const ADMIN_SETTINGS_SECTIONS = new Set([
  "providers",
  "ai-services",
  "machines",
  "environment-variables",
  "updates",
  "plugins",
  "marketplaces",
  "experiments",
]);

let currentRole: IxRole | null = null;
export function setCurrentIxRole(role: IxRole | null): void {
  currentRole = role;
}
export function currentIxRole(): IxRole | null {
  return currentRole;
}
export function roleAtLeast(role: IxRole | null, min: IxRole): boolean {
  return role === null || ROLE_RANK[role] >= ROLE_RANK[min];
}
export function settingsSectionAllowed(sectionId: string): boolean {
  if (currentRole === null) return true;
  if (ADMIN_SETTINGS_SECTIONS.has(sectionId)) return roleAtLeast(currentRole, "admin");
  return true;
}

export class IxHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function ixRequest<T>(
  path: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const response = await fetchWithAppSurface(`${BASE_URL}/api/ix${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? {} : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "include",
    signal: init?.signal,
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const body = parsed as { code?: string; message?: string } | null;
    throw new IxHttpError(response.status, body?.code ?? "http_error", body?.message ?? `HTTP ${response.status}`);
  }
  return parsed as T;
}

export const IX_ME_QUERY_KEY = ["ix", "me"] as const;
export const IX_STATUS_QUERY_KEY = ["ix", "status"] as const;

export function useIxStatus() {
  return useQuery({
    queryKey: IX_STATUS_QUERY_KEY,
    queryFn: ({ signal }) => ixRequest<IxStatus>("/status", { signal }),
    staleTime: 60_000,
    retry: false,
  });
}

export function useIxMe(enabled: boolean) {
  return useQuery({
    queryKey: IX_ME_QUERY_KEY,
    queryFn: async ({ signal }) => {
      try {
        return await ixRequest<IxMe>("/me", { signal });
      } catch (error) {
        if (error instanceof IxHttpError && error.status === 401) return null;
        throw error;
      }
    },
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useIxRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["ix"] });
}

export function readInviteTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const token = new URLSearchParams(window.location.search).get("ix-invite");
  return token && token.length > 0 ? token : null;
}

export function clearInviteTokenFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("ix-invite");
  window.history.replaceState(null, "", url.toString());
}
