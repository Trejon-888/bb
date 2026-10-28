import type { DbConnection } from "@bb/db";
import { faviconColorPreferenceSchema, parseUiPreferenceValue, type UiPreferenceEntries, type UiPreferenceEntry, type UiPreferenceKey, type UiPreferenceValue } from "@bb/domain";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { currentIxUser } from "./access.js";
import type { IxKv } from "./kv.js";

const POLICY_KEY = "desk:policy";
export const ixDeskPolicySchema = z.object({ theme: z.boolean(), layout: z.boolean() }).strict();
export type IxDeskPolicy = z.infer<typeof ixDeskPolicySchema>;
const DEFAULT_POLICY: IxDeskPolicy = { theme: true, layout: true };
const THEME_KEY = "__appearance";
const appearanceSchema = z.object({ themeId: z.string().min(1), faviconColor: faviconColorPreferenceSchema });
export type IxDeskAppearance = z.infer<typeof appearanceSchema>;

export interface IxDeskStore {
  policy(): IxDeskPolicy;
  setPolicy(policy: IxDeskPolicy): void;
  preferences(userId: string): Map<string, { valueJson: string; revision: number }>;
  writePreference(userId: string, key: string, valueJson: string, expectedRevision: number): { outcome: "updated"; revision: number } | { outcome: "conflict"; revision: number };
  resetPreference(userId: string, key: string): void;
  appearance(userId: string): IxDeskAppearance | null;
  setAppearance(userId: string, appearance: IxDeskAppearance | null): void;
  clear(userId: string): void;
  personalized(userId: string): { theme: boolean; layout: number };
}

export function createIxDeskStore(db: DbConnection, kv: IxKv): IxDeskStore {
  const client = db.$client;
  let ready = false;
  const ensure = () => {
    if (ready) return;
    kv.ensureReady();
    client.exec("CREATE TABLE IF NOT EXISTS ix_desk_pref (user_id TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, key))");
    ready = true;
  };
  const row = (userId: string, key: string) => client.prepare<[string, string], { value_json: string; revision: number }>("SELECT value_json, revision FROM ix_desk_pref WHERE user_id = ? AND key = ?").get(userId, key);
  return {
    policy() {
      ensure();
      const raw = kv.get(POLICY_KEY);
      if (raw === null) return DEFAULT_POLICY;
      const parsed = ixDeskPolicySchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : DEFAULT_POLICY;
    },
    setPolicy(policy) {
      ensure();
      kv.set(POLICY_KEY, JSON.stringify(policy));
    },
    preferences(userId) {
      ensure();
      const rows = client.prepare<[string, string], { key: string; value_json: string; revision: number }>("SELECT key, value_json, revision FROM ix_desk_pref WHERE user_id = ? AND key <> ?").all(userId, THEME_KEY);
      return new Map(rows.map((r) => [r.key, { valueJson: r.value_json, revision: r.revision }]));
    },
    writePreference(userId, key, valueJson, expectedRevision) {
      ensure();
      const current = row(userId, key)?.revision ?? 0;
      if (current !== expectedRevision) return { outcome: "conflict", revision: current };
      const revision = current + 1;
      client.prepare("INSERT INTO ix_desk_pref (user_id, key, value_json, revision, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json, revision = excluded.revision, updated_at = excluded.updated_at").run(userId, key, valueJson, revision, Date.now());
      return { outcome: "updated", revision };
    },
    resetPreference(userId, key) {
      ensure();
      client.prepare("DELETE FROM ix_desk_pref WHERE user_id = ? AND key = ?").run(userId, key);
    },
    appearance(userId) {
      ensure();
      const found = row(userId, THEME_KEY);
      if (found === undefined) return null;
      const parsed = appearanceSchema.safeParse(JSON.parse(found.value_json));
      return parsed.success ? parsed.data : null;
    },
    setAppearance(userId, appearance) {
      ensure();
      if (appearance === null) {
        client.prepare("DELETE FROM ix_desk_pref WHERE user_id = ? AND key = ?").run(userId, THEME_KEY);
        return;
      }
      client.prepare("INSERT INTO ix_desk_pref (user_id, key, value_json, revision, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json, revision = ix_desk_pref.revision + 1, updated_at = excluded.updated_at").run(userId, THEME_KEY, JSON.stringify(appearance), Date.now());
    },
    clear(userId) {
      ensure();
      client.prepare("DELETE FROM ix_desk_pref WHERE user_id = ?").run(userId);
    },
    personalized(userId) {
      ensure();
      const counts = client.prepare<[string, string, string], { theme: number; layout: number }>("SELECT COALESCE(SUM(key = ?), 0) AS theme, COALESCE(SUM(key <> ?), 0) AS layout FROM ix_desk_pref WHERE user_id = ?").get(THEME_KEY, THEME_KEY, userId);
      return { theme: (counts?.theme ?? 0) > 0, layout: counts?.layout ?? 0 };
    },
  };
}

export type IxDeskTarget = { kind: "workspace" } | { kind: "personal"; userId: string };

export function ixDeskTarget(store: IxDeskStore, area: keyof IxDeskPolicy): IxDeskTarget {
  const user = currentIxUser();
  if (user === null) return { kind: "workspace" };
  if (store.policy()[area]) return { kind: "personal", userId: user.userId };
  if (user.admin) return { kind: "workspace" };
  throw new ApiError(403, "ix_desk_locked", area === "theme" ? "Your organization has locked the theme" : "Your organization has locked the layout");
}

export function ixDeskReader(store: IxDeskStore, area: keyof IxDeskPolicy): string | null {
  const user = currentIxUser();
  return user !== null && store.policy()[area] ? user.userId : null;
}

export function overlayIxDeskPreferences(store: IxDeskStore, base: UiPreferenceEntries): UiPreferenceEntries {
  const userId = ixDeskReader(store, "layout");
  if (userId === null) return base;
  const rows = store.preferences(userId);
  const next: Record<string, UiPreferenceEntry<UiPreferenceKey>> = {};
  for (const key of Object.keys(base) as UiPreferenceKey[]) {
    next[key] = { revision: 0, value: base[key].value };
    const row = rows.get(key);
    if (row === undefined) continue;
    let raw: unknown;
    try { raw = JSON.parse(row.valueJson); } catch { continue; }
    const parsed = parseUiPreferenceValue(key, raw);
    if (parsed.success) next[key] = { revision: row.revision, value: parsed.value };
  }
  return next as UiPreferenceEntries;
}

export function writeIxDeskPreference<Key extends UiPreferenceKey>(store: IxDeskStore, args: { expectedRevision: number; key: Key; value: UiPreferenceValue<Key> }): { outcome: "updated"; entry: UiPreferenceEntry<Key> } | { outcome: "conflict"; revision: number } | null {
  const target = ixDeskTarget(store, "layout");
  if (target.kind === "workspace") return null;
  const result = store.writePreference(target.userId, args.key, JSON.stringify(args.value), args.expectedRevision);
  return result.outcome === "conflict" ? result : { outcome: "updated", entry: { revision: result.revision, value: args.value } };
}

export function resetIxDeskPreference<Key extends UiPreferenceKey>(store: IxDeskStore, key: Key, workspace: () => UiPreferenceEntry<Key>): UiPreferenceEntry<Key> | null {
  const target = ixDeskTarget(store, "layout");
  if (target.kind === "workspace") return null;
  store.resetPreference(target.userId, key);
  return { revision: 0, value: workspace().value };
}

export function ixDeskAppearance(store: IxDeskStore): IxDeskAppearance | null {
  const userId = ixDeskReader(store, "theme");
  return userId === null ? null : store.appearance(userId);
}

export function setIxDeskAppearance(store: IxDeskStore, appearance: IxDeskAppearance): boolean {
  const target = ixDeskTarget(store, "theme");
  if (target.kind === "workspace") return false;
  store.setAppearance(target.userId, appearance);
  return true;
}
