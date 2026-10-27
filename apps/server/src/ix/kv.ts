import type { DbConnection } from "@bb/db";

export interface IxKv {
  ensureReady(): void;
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
  listPrefix(prefix: string): Array<{ key: string; value: string }>;
}

export function createIxKv(db: DbConnection): IxKv {
  const client = db.$client;
  let statements: {
    get: { get(key: string): { value: string } | undefined };
    set: { run(key: string, value: string, updatedAt: number): unknown };
    delete: { run(key: string): unknown };
    listPrefix: { all(pattern: string): Array<{ key: string; value: string }> };
  } | null = null;

  function ensureReady(): void {
    if (statements !== null) return;
    client.exec(
      "CREATE TABLE IF NOT EXISTS ix_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
    );
    statements = {
      get: client.prepare<[string], { value: string }>("SELECT value FROM ix_kv WHERE key = ?"),
      set: client.prepare<[string, string, number]>(
        "INSERT INTO ix_kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ),
      delete: client.prepare<[string]>("DELETE FROM ix_kv WHERE key = ?"),
      listPrefix: client.prepare<[string], { key: string; value: string }>(
        "SELECT key, value FROM ix_kv WHERE key LIKE ? ESCAPE '\\'",
      ),
    };
  }

  function ready() {
    ensureReady();
    if (statements === null) throw new Error("ix-kv: not ready");
    return statements;
  }

  return {
    ensureReady,
    get: (key) => ready().get.get(key)?.value ?? null,
    set: (key, value) => {
      ready().set.run(key, value, Date.now());
    },
    delete: (key) => {
      ready().delete.run(key);
    },
    listPrefix: (prefix) => ready().listPrefix.all(`${prefix.replace(/[\\%_]/g, "\\$&")}%`),
  };
}
