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
  iconUrl?: string;
  shell?: IxShell;
  composer?: "open" | "locked";
}
export type IxShell = "full" | "simple" | "nexus";
export type IxSocialProvider = "google" | "microsoft" | "github";
export interface IxStatus {
  mode: "off" | "team";
  bootstrapped: boolean;
  orgName: string | null;
  brand: IxBrand;
  password?: boolean;
  providers?: IxSocialProvider[];
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
  notMember: string | null;
  version: number;
}
const MODE_HINT_KEY = "ix.auth.mode";
let state: IxSessionState = { status: null, statusFailed: false, me: null, mePending: false, notMember: null, version: 0 };
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
    publish({ me, mePending: false, notMember: null });
  } catch (error) {
    if (error instanceof IxHttpError && error.code === "ix_not_member") {
      publish({ me: null, mePending: false, notMember: error.message });
      return;
    }
    publish({ me: null, mePending: false, notMember: null, statusFailed: !(error instanceof IxHttpError && error.status === 401) });
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
  state = { status: null, statusFailed: false, me: null, mePending: false, notMember: null, version: 0 };
}
const INVITE_PARAM = "ix-invite";
const AUTH_ERROR_PARAM = "ix-auth-error";
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

export function readOidcContinueFromUrl(): string | null {
  if (typeof window === "undefined" || window.location.pathname !== "/") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("client_id") === null || params.get("redirect_uri") === null || params.get("response_type") === null) return null;
  return `/api/auth/oauth2/authorize${window.location.search}`;
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

export function readSocialErrorFromUrl(): string | null {
  if (readUrlParam(AUTH_ERROR_PARAM) === null) return null;
  const code = readUrlParam("error") ?? "unknown";
  return `Sign-in with the provider failed (${code.replace(/_/g, " ")}).`;
}

export function clearSocialErrorFromUrl(): void {
  clearUrlParam(AUTH_ERROR_PARAM);
  clearUrlParam("error");
}

export async function startSocialSignIn(provider: IxSocialProvider, inviteToken: string | null): Promise<void> {
  const origin = window.location.origin;
  const callbackURL = `${origin}/${inviteToken === null ? "" : `?${INVITE_PARAM}=${encodeURIComponent(inviteToken)}`}`;
  const response = await fetchWithAppSurface(`${BASE_URL}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, callbackURL, errorCallbackURL: `${origin}/?${AUTH_ERROR_PARAM}=1` }),
    credentials: "include",
  });
  const body = (await response.json().catch(() => null)) as { url?: unknown; message?: unknown } | null;
  if (!response.ok || typeof body?.url !== "string") {
    throw new Error(typeof body?.message === "string" ? body.message : `Could not start ${provider} sign-in (HTTP ${response.status})`);
  }
  window.location.assign(body.url);
}

export async function signOutIx(): Promise<void> {
  await ixRequest("/sign-out", { method: "POST" });
  publish({ me: null, notMember: null });
  await refreshIxSession();
}

export function resolveIxShell(brand: IxBrand | undefined): IxShell {
  return brand?.shell === "simple" || brand?.shell === "nexus" ? brand.shell : "full";
}
export function useIxShell(): IxShell {
  return resolveIxShell(useIxSession().status?.brand);
}
export function listIxMembers(): Promise<{ members: IxMember[] }> {
  return ixRequest<{ members: IxMember[] }>("/members");
}
export function listIxInvitations(): Promise<{ invitations: IxInvitation[] }> {
  return ixRequest<{ invitations: IxInvitation[] }>("/invitations");
}
export function inviteIxMember(input: { email: string; role: IxRole }): Promise<{ invitation: IxInvitation; acceptUrl: string }> {
  return ixRequest<{ invitation: IxInvitation; acceptUrl: string }>("/members/invite", { method: "POST", body: input });
}
export function setIxMemberRole(memberId: string, role: IxRole): Promise<{ ok: boolean }> {
  return ixRequest<{ ok: boolean }>(`/members/${encodeURIComponent(memberId)}/role`, { method: "POST", body: { role } });
}
export function removeIxMember(memberId: string): Promise<{ ok: boolean }> {
  return ixRequest<{ ok: boolean }>(`/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
}
export function cancelIxInvitation(id: string): Promise<{ ok: boolean }> {
  return ixRequest<{ ok: boolean }>(`/invitations/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export const IX_ROLE_LABEL: Record<IxRole, string> = { owner: "Owner", admin: "Admin", member: "Staff access", viewer: "View only" };
export const IX_ORGANIZATION_PATH = "/ix/organization";
export type IxProjectAccessLevel = "read" | "write";
export interface IxAccessOverview {
  mode: "open" | "restricted";
  projects: Array<{ id: string; name: string }>;
  members: Array<{ memberId: string; userId: string; email: string; name: string; role: IxRole; projects: Record<string, IxProjectAccessLevel> }>;
}
export function getIxAccess(): Promise<IxAccessOverview> {
  return ixRequest<IxAccessOverview>("/access");
}
export function setIxAccessMode(mode: "open" | "restricted"): Promise<{ ok: boolean }> {
  return ixRequest<{ ok: boolean }>("/access/mode", { method: "PUT", body: { mode } });
}
export function setIxProjectAccess(memberId: string, projectId: string, level: IxProjectAccessLevel | null): Promise<{ ok: boolean }> {
  return ixRequest<{ ok: boolean }>(`/access/members/${encodeURIComponent(memberId)}/projects/${encodeURIComponent(projectId)}`, { method: "PUT", body: { level } });
}

export function useIxStaffShell(): boolean {
  const session = useIxSession();
  const actor = session.me?.actor;
  return resolveIxShell(session.status?.brand) !== "full" && session.status?.brand.composer === "locked" && actor?.kind === "user" && !roleAtLeast(actor.role, "admin");
}

export interface IxDeskPolicy { theme: boolean; layout: boolean }
export interface IxDeskView { policy: IxDeskPolicy; personal: { theme: boolean; layout: number } | null }
export function getIxDesk(): Promise<IxDeskView> {
  return ixRequest<IxDeskView>("/desk");
}
export function setIxDeskPolicy(policy: IxDeskPolicy): Promise<{ ok: boolean }> {
  return ixRequest<{ ok: boolean }>("/desk/policy", { method: "PUT", body: policy });
}
export function resetIxDesk(): Promise<{ ok: boolean }> {
  return ixRequest<{ ok: boolean }>("/desk", { method: "DELETE" });
}

export type IxThreadShareLevel = "private" | "project" | "workspace";
export type IxShareChoice = IxThreadShareLevel | "people";
export type IxWhoCanChange = "starter" | "starter_and_admins" | "participants";
export interface IxSharingPolicy {
  defaultShare: IxThreadShareLevel;
  allowedShares: IxShareChoice[];
  whoCanChange: IxWhoCanChange;
  participantsCanAdd: boolean;
  adminsSeeAll: boolean;
}
export interface IxChatPerson { id: string; name: string; email: string }
export interface IxThreadShareView {
  share: IxThreadShareLevel;
  owner: IxChatPerson | null;
  mine: boolean;
  member: boolean;
  people: Array<IxChatPerson & { addedBy: string | null; addedAt: number }>;
  canChange: boolean;
  canAdd: boolean;
  canRemove: boolean;
  canLeave: boolean;
  allowedShares: IxShareChoice[];
  reason: string | null;
  addReason: string | null;
}
export interface IxThreadSenders {
  multi: boolean;
  senders: Array<{ sequence: number; userId: string; name: string; email: string }>;
}
export function ixShareAllowed(allowed: readonly IxShareChoice[], share: IxThreadShareLevel): boolean {
  return allowed.includes(share) || (share === "private" && allowed.includes("people"));
}
export function getIxSharingPolicy(): Promise<{ policy: IxSharingPolicy }> {
  return ixRequest<{ policy: IxSharingPolicy }>("/sharing-policy");
}
export function setIxSharingPolicy(policy: IxSharingPolicy): Promise<{ ok: boolean; policy: IxSharingPolicy }> {
  return ixRequest<{ ok: boolean; policy: IxSharingPolicy }>("/sharing-policy", { method: "PUT", body: policy });
}
const threadPath = (threadId: string) => `/threads/${encodeURIComponent(threadId)}`;
export function getIxThreadShare(threadId: string): Promise<IxThreadShareView> {
  return ixRequest<IxThreadShareView>(`${threadPath(threadId)}/share`);
}
export function setIxThreadShare(threadId: string, share: IxThreadShareLevel): Promise<IxThreadShareView> {
  return ixRequest<IxThreadShareView>(`${threadPath(threadId)}/share`, { method: "PUT", body: { share } });
}
export function addIxThreadPeople(threadId: string, userIds: string[]): Promise<IxThreadShareView> {
  return ixRequest<IxThreadShareView>(`${threadPath(threadId)}/people`, { method: "POST", body: { userIds } });
}
export function removeIxThreadPerson(threadId: string, userId: string): Promise<IxThreadShareView | { ok: true; left: true }> {
  return ixRequest<IxThreadShareView | { ok: true; left: true }>(`${threadPath(threadId)}/people/${encodeURIComponent(userId)}`, { method: "DELETE" });
}
export function getIxThreadSenders(threadId: string): Promise<IxThreadSenders> {
  return ixRequest<IxThreadSenders>(`${threadPath(threadId)}/senders`);
}
