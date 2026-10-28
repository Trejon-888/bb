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

const CONFIG_KEY = "project_access:config";
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
  threadOwner(threadId: string): string | null;
  threadsOwnedBy(userId: string): Set<string>;
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
    ready = true;
  };
  const readGrants = (userId: string): Record<string, IxProjectAccessLevel> => {
    ensure();
    const raw = kv.get(GRANT_PREFIX + userId);
    if (raw === null) return {};
    const parsed = grantsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
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
  done: boolean;
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

export async function runWithIxRequestAccess<T>(actor: IxActor | undefined, store: IxAccessStore, scope: IxAccessScope | null, fn: () => Promise<T>): Promise<T> {
  const access: IxRequestAccess = { userId: actor?.kind === "user" ? actor.user.id : null, admin: actor?.kind !== "user" || roleAtLeast(actor.role, "admin"), store, scope, done: false };
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

function canWrite(scope: IxAccessScope, projectId: string): boolean {
  return projectId === scope.personalProjectId || scope.projects[projectId] === "write";
}

export function assertIxProjectAccess(projectId: string): void {
  const scope = currentIxAccessScope();
  if (scope === null) return;
  if (!ixProjectVisible(scope, projectId)) throw new ApiError(404, "project_not_found", "Project not found");
  if (scope.writing && !canWrite(scope, projectId)) throw new ApiError(403, "ix_project_read_only", "You have read-only access to this project");
}

export function assertIxThreadAccess(thread: { id: string; projectId: string }): void {
  const scope = currentIxAccessScope();
  if (scope === null) return;
  if (!ixThreadVisible(scope, thread)) throw new ApiError(404, "thread_not_found", "Thread not found");
  if (scope.writing && !canWrite(scope, thread.projectId)) throw new ApiError(403, "ix_project_read_only", "You have read-only access to this project");
}

export function assertIxUnrestricted(): void {
  if (currentIxAccessScope() !== null) throw new ApiError(403, "ix_restricted", "Your access is limited to the projects you were granted");
}

export function filterIxProjects<T extends { id: string }>(rows: T[]): T[] {
  const scope = currentIxAccessScope();
  return scope === null ? rows : rows.filter((row) => ixProjectVisible(scope, row.id));
}

export function filterIxThreads<T extends { id: string; projectId: string }>(rows: T[]): T[] {
  const scope = currentIxAccessScope();
  return scope === null ? rows : rows.filter((row) => ixThreadVisible(scope, row));
}

export function noteIxThreadCreated(thread: { id: string; parentThreadId: string | null }): void {
  const access = currentRequestAccess();
  if (access === null) return;
  const ownerId = access.userId ?? (thread.parentThreadId === null ? null : access.store.threadOwner(thread.parentThreadId));
  if (ownerId === null) return;
  access.store.recordThreadOwner(thread.id, ownerId);
  access.scope?.ownThreads.add(thread.id);
}

export function ixScopedThreadIds(requested: readonly string[] | undefined): readonly string[] | undefined {
  const scope = currentIxAccessScope();
  if (scope === null) return requested;
  return requested === undefined ? [...scope.ownThreads] : requested.filter((id) => scope.ownThreads.has(id));
}

export function filterIxThreadsById<T extends { id: string }>(rows: T[]): T[] {
  const scope = currentIxAccessScope();
  return scope === null ? rows : rows.filter((row) => scope.ownThreads.has(row.id));
}

export function filterIxSearchGroup<T extends { total: number; results: Array<{ thread: { id: string; projectId: string } }> }>(group: T): T {
  const scope = currentIxAccessScope();
  if (scope === null) return group;
  const results = group.results.filter((result) => ixThreadVisible(scope, result.thread));
  return { ...group, total: results.length, results };
}

export function filterIxByProjectId<T extends { projectId: string | null }>(rows: T[]): T[] {
  const scope = currentIxAccessScope();
  return scope === null ? rows : rows.filter((row) => row.projectId !== null && ixProjectVisible(scope, row.projectId));
}

export function filterIxByThreadId<T extends { threadId: string }>(rows: T[]): T[] {
  const scope = currentIxAccessScope();
  return scope === null ? rows : rows.filter((row) => scope.ownThreads.has(row.threadId));
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
  if (actor === undefined || actor.kind !== "user" || roleAtLeast(actor.role, "admin") || store.mode() !== "restricted") return null;
  const userId = actor.user.id;
  const canSeeProject = (projectId: string) => store.mode() !== "restricted" || projectId === PERSONAL_PROJECT_ID || store.grantsFor(userId)[projectId] !== undefined;
  return {
    canSeeProject,
    canSeeThread(threadId) {
      if (store.mode() !== "restricted") return true;
      if (store.threadOwner(threadId) !== userId) return false;
      const thread = getThread(db, threadId);
      return thread !== null && canSeeProject(thread.projectId);
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
