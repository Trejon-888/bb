import { useEffect, useState, useSyncExternalStore } from "react";
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
export interface IxBrand {
  name?: string;
  logoUrl?: string;
  accent?: string;
  appTitle?: string;
  loginTitle?: string;
  loginSubtitle?: string;
  supportUrl?: string;
  faviconUrl?: string;
}
export interface IxStatus {
  mode: "off" | "team";
  bootstrapped: boolean;
  orgName: string | null;
  brand: IxBrand;
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

export interface IxSessionState {
  status: IxStatus | null;
  statusFailed: boolean;
  me: IxMe | null;
  mePending: boolean;
  version: number;
}
const MODE_HINT_KEY = "ix.auth.mode";
let state: IxSessionState = { status: null, statusFailed: false, me: null, mePending: false, version: 0 };
const listeners = new Set<() => void>();
function publish(next: Partial<IxSessionState>): void {
  state = { ...state, ...next, version: state.version + 1 };
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function readIxSession(): IxSessionState {
  return state;
}
export function useIxSession(): IxSessionState {
  return useSyncExternalStore(subscribe, readIxSession, readIxSession);
}
export function rememberedTeamMode(): boolean {
  try {
    return window.localStorage.getItem(MODE_HINT_KEY) === "team";
  } catch {
    return false;
  }
}
function rememberMode(mode: "off" | "team"): void {
  try {
    window.localStorage.setItem(MODE_HINT_KEY, mode);
  } catch {
    return;
  }
}
export async function loadIxStatus(): Promise<void> {
  try {
    const status = await ixRequest<IxStatus>("/status");
    rememberMode(status.mode);
    publish({ status, statusFailed: false });
  } catch {
    publish({ status: null, statusFailed: true });
  }
}
export async function loadIxMe(): Promise<void> {
  publish({ mePending: true });
  try {
    const me = await ixRequest<IxMe>("/me");
    publish({ me, mePending: false });
  } catch (error) {
    publish({ me: null, mePending: false, statusFailed: !(error instanceof IxHttpError && error.status === 401) });
  }
}
export async function refreshIxSession(): Promise<void> {
  await loadIxStatus();
  if (state.status?.mode === "team") await loadIxMe();
}
let started = false;
export function useIxSessionBoot(): IxSessionState {
  const session = useIxSession();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (started) return;
    started = true;
    void refreshIxSession().then(() => setTick((value) => value + 1));
  }, []);
  return session;
}
export function resetIxSessionForTests(): void {
  started = false;
  state = { status: null, statusFailed: false, me: null, mePending: false, version: 0 };
}
const INVITE_PARAM = "ix-invite";
const SSO_PARAM = "ix-sso";

function readUrlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(name);
  return value && value.length > 0 ? value : null;
}

function clearUrlParam(name: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  window.history.replaceState(null, "", url.toString());
}

export function readInviteTokenFromUrl(): string | null {
  return readUrlParam(INVITE_PARAM);
}

export function clearInviteTokenFromUrl(): void {
  clearUrlParam(INVITE_PARAM);
}

export function readSsoTokenFromUrl(): string | null {
  return readUrlParam(SSO_PARAM);
}

export function clearSsoTokenFromUrl(): void {
  clearUrlParam(SSO_PARAM);
}

export function acceptSsoToken(token: string): Promise<{ ok: boolean; userId: string; role: IxRole }> {
  return ixRequest("/sso/accept", { method: "POST", body: { token } });
}
