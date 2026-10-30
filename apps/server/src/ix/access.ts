import { AsyncLocalStorage } from "node:async_hooks";
import { getEnvironment, getThread, type DbConnection } from "@bb/db";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { IxActor } from "./context.js";
import { roleAtLeast } from "./config.js";
import type { IxKv } from "./kv.js";

export const ixProjectAccessLevelSchema = z.enum(["read", "write"]);
export type IxProjectAccessLevel = z.infer<typeof ixProjectAccessLevelSchema>;
export const ixAccessModeSchema = z.enum(["open", "restricted"]);
export type IxAccessMode = z.infer<typeof ixAccessModeSchema>;
export const ixThreadShareSchema = z.enum(["private", "project", "workspace"]);
export type IxThreadShare = z.infer<typeof ixThreadShareSchema>;
export const ixShareChoiceSchema = z.enum(["private", "project", "workspace", "people"]);
export type IxShareChoice = z.infer<typeof ixShareChoiceSchema>;
export const ixWhoCanChangeSchema = z.enum(["starter", "starter_and_admins", "participants"]);
export type IxWhoCanChange = z.infer<typeof ixWhoCanChangeSchema>;
const sharingPolicyShape = z
  .object({
    defaultShare: ixThreadShareSchema,
    allowedShares: z.array(ixShareChoiceSchema).min(1),
    whoCanChange: ixWhoCanChangeSchema,
    participantsCanAdd: z.boolean(),
    adminsSeeAll: z.boolean(),
  })
  .strict();
export const ixSharingPolicySchema = sharingPolicyShape.superRefine((policy, ctx) => {
  if (!ixShareAllowed(policy.allowedShares, policy.defaultShare)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["defaultShare"], message: "The default must be one of the allowed choices" });
  }
});
export type IxSharingPolicy = z.infer<typeof sharingPolicyShape>;
export interface IxThreadMember {
  userId: string;
  addedBy: string | null;
  addedAt: number;
}

export function ixShareAllowed(allowed: readonly IxShareChoice[], share: IxThreadShare): boolean {
  return allowed.includes(share) || (share === "private" && allowed.includes("people"));
}

const CONFIG_KEY = "project_access:config";
const SHARE_DEFAULT_KEY = "thread_share:default";
const SHARE_MIGRATED_KEY = "thread_share:migrated";
const SHARING_POLICY_KEY = "thread_share:policy";
const GRANT_PREFIX = "project_access:grant:";
const grantsSchema = z.record(z.string().min(1), ixProjectAccessLevelSchema);
const configSchema = z.object({ mode: ixAccessModeSchema });

export interface IxAccessStore {
  mode(): IxAccessMode;
  setMode(mode: IxAccessMode): void;
  grantsFor(userId: string): Record<string, IxProjectAccessLevel>;
  setGrant(userId: string, projectId: string, level: IxProjectAccessLevel | null): Record<string, IxProjectAccessLevel>;
  allGrants(): Array<{ userId: string; projects: Record<string, IxProjectAccessLevel> }>;
  recordThreadOwner(threadId: string, userId: string): void;
  assignThreadOwner(threadId: string, userId: string): void;
  threadOwner(threadId: string): string | null;
  threadsOwnedBy(userId: string): Set<string>;
  threadShare(threadId: string): IxThreadShare;
  setThreadShare(threadId: string, share: IxThreadShare): void;
  defaultThreadShare(): IxThreadShare;
  setDefaultThreadShare(share: IxThreadShare): void;
  hiddenThreadsFor(userId: string, visibleProject: (projectId: string) => boolean): Set<string>;
  sharedThreadsFor(userId: string, visibleProject: (projectId: string) => boolean): Set<string>;
  allThreadIds(): string[];
  recordTurnSender(threadId: string, userId: string): void;
  turnSender(threadId: string): string | null;
  sharingPolicy(): IxSharingPolicy;
  setSharingPolicy(policy: IxSharingPolicy): void;
  rootThreadId(threadId: string): string;
  threadMembers(threadId: string): IxThreadMember[];
  addThreadMember(threadId: string, userId: string, addedBy: string | null): void;
  removeThreadMember(threadId: string, userId: string): void;
  isThreadMember(threadId: string, userId: string): boolean;
  memberThreadsFor(userId: string): Map<string, string>;
  recordMessageSender(threadId: string, sequence: number, userId: string): void;
  messageSenders(threadId: string): Array<{ sequence: number; userId: string }>;
}

export function createIxAccessStore(db: DbConnection, kv: IxKv): IxAccessStore {
  const client = db.$client;
  let ready = false;
  const ensure = () => {
    if (ready) return;
    kv.ensureReady();
    client.exec(
      "CREATE TABLE IF NOT EXISTS ix_thread_owner (thread_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS ix_thread_owner_user ON ix_thread_owner (user_id)",
    );
    client.exec(
      "CREATE TABLE IF NOT EXISTS ix_thread_share (thread_id TEXT PRIMARY KEY, share TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS ix_thread_sender (thread_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    );
    client.exec(
      "CREATE TABLE IF NOT EXISTS ix_thread_member (thread_id TEXT NOT NULL, user_id TEXT NOT NULL, added_by TEXT, added_at INTEGER NOT NULL, PRIMARY KEY (thread_id, user_id)); CREATE INDEX IF NOT EXISTS ix_thread_member_user ON ix_thread_member (user_id); CREATE TABLE IF NOT EXISTS ix_turn_sender (thread_id TEXT NOT NULL, sequence INTEGER NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (thread_id, sequence))",
    );
    if (kv.get(SHARE_MIGRATED_KEY) === null) {
      const raw = kv.get(CONFIG_KEY);
      const parsed = raw === null ? null : configSchema.safeParse(JSON.parse(raw));
      const legacy: IxThreadShare = parsed?.success && parsed.data.mode === "restricted" ? "private" : "workspace";
      client.prepare("INSERT OR IGNORE INTO ix_thread_share (thread_id, share, updated_at) SELECT thread_id, ?, ? FROM ix_thread_owner").run(legacy, Date.now());
      kv.set(SHARE_MIGRATED_KEY, JSON.stringify({ at: Date.now(), legacy }));
    }
    ready = true;
  };
  const readGrants = (userId: string): Record<string, IxProjectAccessLevel> => {
    ensure();
    const raw = kv.get(GRANT_PREFIX + userId);
    if (raw === null) return {};
    const parsed = grantsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  };
  const legacyDefaultShare = (): IxThreadShare => {
    const raw = kv.get(SHARE_DEFAULT_KEY);
    const parsed = raw === null ? null : ixThreadShareSchema.safeParse(JSON.parse(raw));
    return parsed?.success ? parsed.data : "private";
  };
  const readPolicy = (): IxSharingPolicy => {
    ensure();
    const raw = kv.get(SHARING_POLICY_KEY);
    const parsed = raw === null ? null : ixSharingPolicySchema.safeParse(JSON.parse(raw));
    if (parsed?.success) return parsed.data;
    return { defaultShare: legacyDefaultShare(), allowedShares: ["private", "project", "workspace", "people"], whoCanChange: "starter", participantsCanAdd: false, adminsSeeAll: false };
  };
  const rootOf = (threadId: string): string => {
    ensure();
    const row = client.prepare<[string], { id: string }>(
      "WITH RECURSIVE chain(id, parent_id, depth) AS (SELECT id, parent_thread_id, 0 FROM threads WHERE id = ? UNION ALL SELECT t.id, t.parent_thread_id, c.depth + 1 FROM threads t JOIN chain c ON t.id = c.parent_id WHERE c.depth < 64) SELECT id FROM chain WHERE parent_id IS NULL LIMIT 1",
    ).get(threadId);
    return row?.id ?? threadId;
  };
  const memberThreads = (userId: string): Map<string, string> => {
    ensure();
    const rows = client.prepare<[string], { id: string; project_id: string }>(
      "WITH RECURSIVE tree(id, depth) AS (SELECT thread_id, 0 FROM ix_thread_member WHERE user_id = ? UNION SELECT t.id, tree.depth + 1 FROM threads t JOIN tree ON t.parent_thread_id = tree.id WHERE tree.depth < 64) SELECT t.id, t.project_id FROM tree JOIN threads t ON t.id = tree.id",
    ).all(userId);
    return new Map(rows.map((r) => [r.id, r.project_id]));
  };
  return {
    mode() {
      ensure();
      const raw = kv.get(CONFIG_KEY);
      if (raw === null) return "open";
      const parsed = configSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data.mode : "open";
    },
    setMode(mode) {
      ensure();
      kv.set(CONFIG_KEY, JSON.stringify({ mode }));
    },
    grantsFor: readGrants,
    setGrant(userId, projectId, level) {
      const next = { ...readGrants(userId) };
      if (level === null) delete next[projectId];
      else next[projectId] = level;
      if (Object.keys(next).length === 0) kv.delete(GRANT_PREFIX + userId);
      else kv.set(GRANT_PREFIX + userId, JSON.stringify(next));
      return next;
    },
    allGrants() {
      ensure();
      return kv.listPrefix(GRANT_PREFIX).map((row) => {
        const parsed = grantsSchema.safeParse(JSON.parse(row.value));
        return { userId: row.key.slice(GRANT_PREFIX.length), projects: parsed.success ? parsed.data : {} };
      });
    },
    recordThreadOwner(threadId, userId) {
      ensure();
      client.prepare("INSERT OR IGNORE INTO ix_thread_owner (thread_id, user_id, created_at) VALUES (?, ?, ?)").run(threadId, userId, Date.now());
    },
    assignThreadOwner(threadId, userId) {
      ensure();
      client.prepare("INSERT INTO ix_thread_owner (thread_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET user_id = excluded.user_id").run(threadId, userId, Date.now());
    },
    threadOwner(threadId) {
      ensure();
      const row = client.prepare<[string], { user_id: string }>("SELECT user_id FROM ix_thread_owner WHERE thread_id = ?").get(threadId);
      return row?.user_id ?? null;
    },
    threadsOwnedBy(userId) {
      ensure();
      const rows = client.prepare<[string], { thread_id: string }>("SELECT thread_id FROM ix_thread_owner WHERE user_id = ?").all(userId);
      return new Set(rows.map((r) => r.thread_id));
    },
    threadShare(threadId) {
      ensure();
      const row = client.prepare<[string], { share: string }>("SELECT share FROM ix_thread_share WHERE thread_id = ?").get(threadId);
      const parsed = ixThreadShareSchema.safeParse(row?.share);
      return parsed.success ? parsed.data : "private";
    },
    setThreadShare(threadId, share) {
      ensure();
      client.prepare("INSERT INTO ix_thread_share (thread_id, share, updated_at) VALUES (?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET share = excluded.share, updated_at = excluded.updated_at").run(threadId, share, Date.now());
    },
    defaultThreadShare() {
      return readPolicy().defaultShare;
    },
    setDefaultThreadShare(share) {
      const policy = readPolicy();
      if (!ixShareAllowed(policy.allowedShares, share)) throw new ApiError(400, "ix_share_not_allowed", "That choice is not allowed by the sharing policy");
      kv.set(SHARE_DEFAULT_KEY, JSON.stringify(share));
      kv.set(SHARING_POLICY_KEY, JSON.stringify({ ...policy, defaultShare: share }));
    },
    hiddenThreadsFor(userId, visibleProject) {
      ensure();
      const members = memberThreads(userId);
      const rows = client.prepare<[string], { thread_id: string; share: string | null; project_id: string | null }>(
        "SELECT o.thread_id, s.share, t.project_id FROM ix_thread_owner o LEFT JOIN ix_thread_share s ON s.thread_id = o.thread_id LEFT JOIN threads t ON t.id = o.thread_id WHERE o.user_id <> ?",
      ).all(userId).filter((r) => !members.has(r.thread_id));
      return new Set(rows.filter((r) => r.share !== "workspace" && r.share !== "project" ? true : r.project_id === null ? r.share === "project" : !visibleProject(r.project_id)).map((r) => r.thread_id));
    },
    sharedThreadsFor(userId, visibleProject) {
      ensure();
      const rows = client.prepare<[string], { thread_id: string; share: string; project_id: string | null }>(
        "SELECT o.thread_id, s.share, t.project_id FROM ix_thread_owner o JOIN ix_thread_share s ON s.thread_id = o.thread_id LEFT JOIN threads t ON t.id = o.thread_id WHERE o.user_id <> ? AND s.share IN ('project', 'workspace')",
      ).all(userId);
      return new Set(rows.filter((r) => (r.project_id === null ? r.share === "workspace" : visibleProject(r.project_id))).map((r) => r.thread_id));
    },
    allThreadIds() {
      ensure();
      return client.prepare<[], { id: string }>("SELECT id FROM threads").all().map((r) => r.id);
    },
    recordTurnSender(threadId, userId) {
      ensure();
      client.prepare("INSERT INTO ix_thread_sender (thread_id, user_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(thread_id) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at").run(threadId, userId, Date.now());
    },
    turnSender(threadId) {
      ensure();
      return client.prepare<[string], { user_id: string }>("SELECT user_id FROM ix_thread_sender WHERE thread_id = ?").get(threadId)?.user_id ?? null;
    },
    sharingPolicy: readPolicy,
    setSharingPolicy(policy) {
      ensure();
      const parsed = ixSharingPolicySchema.parse(policy);
      kv.set(SHARING_POLICY_KEY, JSON.stringify(parsed));
      kv.set(SHARE_DEFAULT_KEY, JSON.stringify(parsed.defaultShare));
    },
    rootThreadId: rootOf,
    threadMembers(threadId) {
      ensure();
      return client.prepare<[string], { user_id: string; added_by: string | null; added_at: number }>(
        "SELECT user_id, added_by, added_at FROM ix_thread_member WHERE thread_id = ? ORDER BY added_at, user_id",
      ).all(rootOf(threadId)).map((r) => ({ userId: r.user_id, addedBy: r.added_by, addedAt: r.added_at }));
    },
    addThreadMember(threadId, userId, addedBy) {
      ensure();
      client.prepare("INSERT OR IGNORE INTO ix_thread_member (thread_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)").run(rootOf(threadId), userId, addedBy, Date.now());
    },
    removeThreadMember(threadId, userId) {
      ensure();
      client.prepare("DELETE FROM ix_thread_member WHERE thread_id = ? AND user_id = ?").run(rootOf(threadId), userId);
    },
    isThreadMember(threadId, userId) {
      ensure();
      return client.prepare<[string, string], { hit: number }>(
        "WITH RECURSIVE chain(id, parent_id, depth) AS (SELECT id, parent_thread_id, 0 FROM threads WHERE id = ? UNION ALL SELECT t.id, t.parent_thread_id, c.depth + 1 FROM threads t JOIN chain c ON t.id = c.parent_id WHERE c.depth < 64) SELECT 1 AS hit FROM ix_thread_member m JOIN chain c ON m.thread_id = c.id WHERE m.user_id = ? LIMIT 1",
      ).get(threadId, userId) !== undefined;
    },
    memberThreadsFor: memberThreads,
    recordMessageSender(threadId, sequence, userId) {
      ensure();
      client.prepare("INSERT OR REPLACE INTO ix_turn_sender (thread_id, sequence, user_id, created_at) VALUES (?, ?, ?, ?)").run(threadId, sequence, userId, Date.now());
    },
    messageSenders(threadId) {
      ensure();
      return client.prepare<[string], { sequence: number; user_id: string }>("SELECT sequence, user_id FROM ix_turn_sender WHERE thread_id = ? ORDER BY sequence").all(threadId).map((r) => ({ sequence: r.sequence, userId: r.user_id }));
    },
  };
}

export interface IxAccessScope {
  userId: string;
  writing: boolean;
  projects: Record<string, IxProjectAccessLevel>;
  ownThreads: Set<string>;
  personalProjectId: string | null;
}
interface IxRequestAccess {
  userId: string | null;
  admin: boolean;
  store: IxAccessStore;
  scope: IxAccessScope | null;
  writing: boolean;
  done: boolean;
  grantedProjects: Set<string>;
  threadView?: IxThreadView;
}
interface IxThreadView {
  hidden: Set<string>;
  shared: Set<string>;
  members: Map<string, string>;
  oversight: Set<string>;
}

let fallbackStore: IxAccessStore | null = null;
export function setIxFallbackAccessStore(store: IxAccessStore | null): void {
  fallbackStore = store;
}

const requestStorage = new AsyncLocalStorage<IxRequestAccess>();

export function restrictedScopeFor(actor: IxActor | undefined, store: IxAccessStore, method: string, readOnlyPath = false): IxAccessScope | null {
  if (actor === undefined || actor.kind !== "user" || roleAtLeast(actor.role, "admin")) return null;
  if (store.mode() !== "restricted") return null;
  return {
    userId: actor.user.id,
    writing: !readOnlyPath && !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()),
    projects: store.grantsFor(actor.user.id),
    ownThreads: store.threadsOwnedBy(actor.user.id),
    personalProjectId: PERSONAL_PROJECT_ID,
  };
}

export async function runWithIxRequestAccess<T>(actor: IxActor | undefined, store: IxAccessStore, scope: IxAccessScope | null, fn: () => Promise<T>, writing = scope?.writing ?? false): Promise<T> {
  const access: IxRequestAccess = { userId: actor?.kind === "user" ? actor.user.id : null, admin: actor?.kind !== "user" || roleAtLeast(actor.role, "admin"), store, scope, writing, done: false, grantedProjects: new Set() };
  try {
    return await requestStorage.run(access, fn);
  } finally {
    access.done = true;
  }
}

function currentRequestAccess(): IxRequestAccess | null {
  const access = requestStorage.getStore();
  return access === undefined || access.done ? null : access;
}

export function currentIxAccessScope(): IxAccessScope | null {
  return currentRequestAccess()?.scope ?? null;
}

export function ixProjectVisible(scope: IxAccessScope, projectId: string): boolean {
  return projectId === scope.personalProjectId || scope.projects[projectId] !== undefined;
}

export function ixThreadVisible(scope: IxAccessScope, thread: { id: string; projectId: string }): boolean {
  return scope.ownThreads.has(thread.id) && ixProjectVisible(scope, thread.projectId);
}

function threadView(access: IxRequestAccess): IxThreadView | null {
  if (access.userId === null) return null;
  if (access.threadView === undefined) {
    const scope = access.scope;
    const visibleProject = (projectId: string) => scope === null || ixProjectVisible(scope, projectId);
    const hidden = access.store.hiddenThreadsFor(access.userId, visibleProject);
    const oversight = access.admin && access.store.sharingPolicy().adminsSeeAll;
    access.threadView = {
      hidden: oversight ? new Set() : hidden,
      shared: access.store.sharedThreadsFor(access.userId, visibleProject),
      members: access.store.memberThreadsFor(access.userId),
      oversight: oversight ? hidden : new Set(),
    };
  }
  return access.threadView;
}

function threadIdVisible(access: IxRequestAccess | null, threadId: string): boolean {
  if (access === null) return true;
  const view = threadView(access);
  if (view === null) return true;
  if (view.hidden.has(threadId)) return false;
  const scope = access.scope;
  return scope === null || scope.ownThreads.has(threadId) || view.shared.has(threadId) || view.members.has(threadId);
}

function threadRowVisible(access: IxRequestAccess | null, thread: { id: string; projectId: string }): boolean {
  if (!threadIdVisible(access, thread.id)) return false;
  const scope = access?.scope ?? null;
  if (scope === null || ixProjectVisible(scope, thread.projectId)) return true;
  return access !== null && (threadView(access)?.members.has(thread.id) ?? false);
}

export function ixThreadOversightOnly(threadId: string): boolean {
  const access = currentRequestAccess();
  if (access === null) return false;
  return threadView(access)?.oversight.has(threadId) ?? false;
}

function canWrite(scope: IxAccessScope, projectId: string): boolean {
  return projectId === scope.personalProjectId || scope.projects[projectId] === "write";
}

export function assertIxProjectAccess(projectId: string): void {
  const access = currentRequestAccess();
  const scope = access?.scope ?? null;
  if (scope === null || access?.grantedProjects.has(projectId) === true) return;
  if (!ixProjectVisible(scope, projectId)) throw new ApiError(404, "project_not_found", "Project not found");
  if (scope.writing && !canWrite(scope, projectId)) throw new ApiError(403, "ix_project_read_only", "You have read-only access to this project");
}

export function assertIxThreadAccess(thread: { id: string; projectId: string }): void {
  const access = currentRequestAccess();
  if (!threadRowVisible(access, thread)) throw new ApiError(404, "thread_not_found", "Thread not found");
  if (access === null) return;
  const view = threadView(access);
  if (access.writing && view?.oversight.has(thread.id) === true) throw new ApiError(403, "ix_oversight_read_only", "Admins can read this chat for oversight, but only its people can change it");
  const scope = access.scope;
  if (scope === null) return;
  if (view?.members.has(thread.id) === true && !ixProjectVisible(scope, thread.projectId)) {
    access.grantedProjects.add(thread.projectId);
    return;
  }
  if (view?.members.has(thread.id) === true) return;
  if (scope.writing && !canWrite(scope, thread.projectId)) throw new ApiError(403, "ix_project_read_only", "You have read-only access to this project");
}

export function allowIxChatProjectRead(projectId: string): void {
  const access = currentRequestAccess();
  if (access === null || access.scope === null || access.writing) return;
  if ([...(threadView(access)?.members.values() ?? [])].includes(projectId)) access.grantedProjects.add(projectId);
}

export function assertIxUnrestricted(): void {
  if (currentIxAccessScope() !== null) throw new ApiError(403, "ix_restricted", "Your access is limited to the projects you were granted");
}

export function filterIxProjects<T extends { id: string }>(rows: T[]): T[] {
  const access = currentRequestAccess();
  const scope = access?.scope ?? null;
  if (access === null || scope === null) return rows;
  const chatProjects = new Set(threadView(access)?.members.values() ?? []);
  return rows.filter((row) => ixProjectVisible(scope, row.id) || chatProjects.has(row.id));
}

export function filterIxThreads<T extends { id: string; projectId: string }>(rows: T[]): T[] {
  const access = currentRequestAccess();
  return access === null ? rows : rows.filter((row) => threadRowVisible(access, row));
}

export function noteIxThreadCreated(thread: { id: string; parentThreadId: string | null }): void {
  const access = currentRequestAccess();
  if (access === null) return;
  const ownerId = access.userId ?? (thread.parentThreadId === null ? null : access.store.threadOwner(thread.parentThreadId));
  if (ownerId === null) return;
  access.store.recordThreadOwner(thread.id, ownerId);
  access.store.setThreadShare(thread.id, thread.parentThreadId === null ? access.store.defaultThreadShare() : access.store.threadShare(thread.parentThreadId));
  access.scope?.ownThreads.add(thread.id);
}

export function noteIxTurnSender(threadId: string): void {
  const access = currentRequestAccess();
  if (access === null || access.userId === null) return;
  access.store.recordTurnSender(threadId, access.userId);
}

export function noteIxTurnRequested(threadId: string, sequence: number, initiator: string): void {
  if (initiator !== "user") return;
  const access = currentRequestAccess();
  if (access !== null) {
    if (access.userId !== null) access.store.recordMessageSender(threadId, sequence, access.userId);
    return;
  }
  const store = fallbackStore;
  if (store === null) return;
  const ownerId = store.threadOwner(threadId);
  if (ownerId === null) return;
  store.recordMessageSender(threadId, sequence, store.turnSender(threadId) ?? ownerId);
}

export function assignIxThreadOwner(threadId: string, userId: string): void {
  const access = currentRequestAccess();
  if (access === null) return;
  if (access.userId !== null && !access.admin && access.userId !== userId) {
    throw new ApiError(403, "ix_owner_forbidden", "Only admins can start a thread on someone else's behalf");
  }
  access.store.assignThreadOwner(threadId, userId);
  if (access.store.threadShare(threadId) === "private" || access.userId === null) access.store.setThreadShare(threadId, "private");
  access.scope?.ownThreads.add(threadId);
}

export function ixScopedThreadIds(requested: readonly string[] | undefined): readonly string[] | undefined {
  const access = currentRequestAccess();
  if (access === null) return requested;
  const view = threadView(access);
  if (view === null) return requested;
  const scope = access.scope;
  if (scope !== null) {
    const allowed = new Set([...scope.ownThreads, ...view.shared, ...view.members.keys()].filter((id) => !view.hidden.has(id)));
    return requested === undefined ? [...allowed] : requested.filter((id) => allowed.has(id));
  }
  if (view.hidden.size === 0) return requested;
  return (requested ?? access.store.allThreadIds()).filter((id) => !view.hidden.has(id));
}

export function filterIxThreadsById<T extends { id: string }>(rows: T[]): T[] {
  const access = currentRequestAccess();
  return access === null ? rows : rows.filter((row) => threadIdVisible(access, row.id));
}

export function filterIxSearchGroup<T extends { total: number; results: Array<{ thread: { id: string; projectId: string } }> }>(group: T): T {
  const access = currentRequestAccess();
  if (access === null) return group;
  const results = group.results.filter((result) => threadRowVisible(access, result.thread));
  return results.length === group.results.length ? group : { ...group, total: results.length, results };
}

export function filterIxByProjectId<T extends { projectId: string | null }>(rows: T[]): T[] {
  const scope = currentIxAccessScope();
  return scope === null ? rows : rows.filter((row) => row.projectId !== null && ixProjectVisible(scope, row.projectId));
}

export function filterIxByThreadId<T extends { threadId: string }>(rows: T[]): T[] {
  const access = currentRequestAccess();
  return access === null ? rows : rows.filter((row) => threadIdVisible(access, row.threadId));
}

export function ixRestricted(): boolean {
  return currentIxAccessScope() !== null;
}

export interface IxSocketAccessFilter {
  canSeeThread(threadId: string): boolean;
  canSeeProject(projectId: string): boolean;
  canSeeEnvironment(environmentId: string): boolean;
}

export function ixSocketAccessFilter(db: DbConnection, store: IxAccessStore, actor: IxActor | undefined): IxSocketAccessFilter | null {
  if (actor === undefined || actor.kind !== "user") return null;
  const userId = actor.user.id;
  const admin = roleAtLeast(actor.role, "admin");
  const restricted = () => store.mode() === "restricted" && !admin;
  const canSeeProject = (projectId: string) => !restricted() || projectId === PERSONAL_PROJECT_ID || store.grantsFor(userId)[projectId] !== undefined;
  return {
    canSeeProject,
    canSeeThread(threadId) {
      const owner = store.threadOwner(threadId);
      if (owner === null) return !restricted();
      const thread = getThread(db, threadId);
      if (thread === null) return false;
      if (admin && store.sharingPolicy().adminsSeeAll) return true;
      if (store.isThreadMember(threadId, userId)) return true;
      if (!canSeeProject(thread.projectId)) return false;
      if (owner === userId) return true;
      const share = store.threadShare(threadId);
      return share === "workspace" || share === "project";
    },
    canSeeEnvironment(environmentId) {
      const environment = getEnvironment(db, environmentId);
      return environment !== null && environment.projectId !== null && canSeeProject(environment.projectId);
    },
  };
}

export function ixTerminalSocketAllowed(store: IxAccessStore, actor: IxActor | undefined): boolean {
  return actor === undefined || actor.kind !== "user" || roleAtLeast(actor.role, "admin") || store.mode() !== "restricted";
}

export function currentIxUser(): { userId: string; admin: boolean } | null {
  const access = currentRequestAccess();
  return access === null || access.userId === null ? null : { userId: access.userId, admin: access.admin };
}
