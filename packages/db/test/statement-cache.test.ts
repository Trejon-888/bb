import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createConnection,
  DEFAULT_STATEMENT_CACHE_SIZE,
  getStatementCacheStats,
  isCacheableStatementSql,
} from "../src/connection.js";
import { createMigratedConnection } from "../src/testing.js";
import { hosts } from "../src/schema.js";

function spyOnNativePrepare() {
  return vi.spyOn(Database.prototype, "prepare");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("prepared-statement cache", () => {
  it("compiles repeated SQL once and returns the same rows as a fresh statement", () => {
    const prepare = spyOnNativePrepare();
    const db = createMigratedConnection();
    try {
      db.$client.exec("CREATE TABLE t (a INTEGER, b TEXT)");
      db.$client.prepare("INSERT INTO t VALUES (?, ?)").run(1, "x");
      prepare.mockClear();
      const expected = db.select().from(hosts).where(eq(hosts.id, "h")).all();
      expect(prepare).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 100; i++) {
        expect(db.select().from(hosts).where(eq(hosts.id, "h")).all()).toEqual(
          expected,
        );
      }
      expect(prepare).toHaveBeenCalledTimes(1);
      const fresh = new Database(":memory:");
      fresh.exec("CREATE TABLE t (a INTEGER, b TEXT)");
      fresh.prepare("INSERT INTO t VALUES (?, ?)").run(1, "x");
      for (let i = 0; i < 100; i++) {
        expect(
          db.$client.prepare("SELECT a, b FROM t WHERE a = ?").all(1),
        ).toEqual(fresh.prepare("SELECT a, b FROM t WHERE a = ?").all(1));
      }
      fresh.close();
      expect(prepare.mock.calls.length).toBe(1 + 1 + 1 + 100);
      prepare.mockClear();
      const stats = getStatementCacheStats(db.$client)!;
      expect(stats.hits).toBeGreaterThanOrEqual(199);
      expect(stats.maxSize).toBe(DEFAULT_STATEMENT_CACHE_SIZE);
    } finally {
      db.$client.close();
    }
  });

  it("keeps result modes independent between callers of the same SQL", () => {
    const db = createMigratedConnection();
    try {
      db.$client.exec("CREATE TABLE t (a INTEGER, b TEXT)");
      db.$client.prepare("INSERT INTO t VALUES (?, ?)").run(1, "x");
      const sql = "SELECT a, b FROM t";
      expect(db.$client.prepare(sql).raw().get()).toEqual([1, "x"]);
      expect(db.$client.prepare(sql).get()).toEqual({ a: 1, b: "x" });
      expect(db.$client.prepare(sql).pluck().get()).toBe(1);
      expect(db.$client.prepare(sql).all()).toEqual([{ a: 1, b: "x" }]);
    } finally {
      db.$client.close();
    }
  });

  it("hands out a fresh statement while the cached one is iterating", () => {
    const db = createMigratedConnection();
    try {
      db.$client.exec("CREATE TABLE t (a INTEGER)");
      for (let i = 0; i < 5; i++)
        db.$client.prepare("INSERT INTO t VALUES (?)").run(i);
      const sql = "SELECT a FROM t ORDER BY a";
      const outer = db.$client.prepare(sql);
      const seen: number[] = [];
      for (const row of outer.iterate() as Iterable<{ a: number }>) {
        seen.push(row.a);
        expect(db.$client.prepare(sql).all()).toHaveLength(5);
      }
      expect(seen).toEqual([0, 1, 2, 3, 4]);
      expect(
        getStatementCacheStats(db.$client)!.bypassed,
      ).toBeGreaterThanOrEqual(5);
    } finally {
      db.$client.close();
    }
  });

  it("drops a statement from the cache once bind() pins its parameters", () => {
    const db = createMigratedConnection();
    try {
      db.$client.exec("CREATE TABLE t (a INTEGER)");
      db.$client.prepare("INSERT INTO t VALUES (?)").run(7);
      const sql = "SELECT a FROM t WHERE a = ?";
      const bound = db.$client.prepare(sql).bind(7);
      expect(bound.get()).toEqual({ a: 7 });
      expect(db.$client.prepare(sql).get(7)).toEqual({ a: 7 });
      expect(db.$client.prepare(sql).get(8)).toBeUndefined();
    } finally {
      db.$client.close();
    }
  });

  it("never caches schema changes, pragmas or transaction control", () => {
    expect(isCacheableStatementSql("SELECT 1")).toBe(true);
    expect(
      isCacheableStatementSql("  -- note\n  insert into t values (1)"),
    ).toBe(true);
    expect(isCacheableStatementSql("/* c */ UPDATE t SET a = 1")).toBe(true);
    expect(
      isCacheableStatementSql("WITH x AS (SELECT 1) SELECT * FROM x"),
    ).toBe(true);
    for (const sql of [
      "CREATE TABLE t (a)",
      "create index i on t (a)",
      "ALTER TABLE t ADD COLUMN b",
      "DROP TABLE t",
      "PRAGMA journal_mode",
      "BEGIN",
      "COMMIT",
      "SAVEPOINT s",
      "RELEASE s",
      "ROLLBACK TO s",
      "VACUUM",
      "ANALYZE",
      "",
    ]) {
      expect(isCacheableStatementSql(sql), sql).toBe(false);
    }
    const prepare = spyOnNativePrepare();
    const db = createConnection(":memory:");
    try {
      prepare.mockClear();
      db.$client.prepare("CREATE TABLE t (a)").run();
      db.$client.prepare("ALTER TABLE t ADD COLUMN b").run();
      db.$client.prepare("PRAGMA user_version").get();
      db.$client.prepare("PRAGMA user_version").get();
      expect(prepare).toHaveBeenCalledTimes(4);
      expect(getStatementCacheStats(db.$client)!.size).toBe(0);
    } finally {
      db.$client.close();
    }
  });

  it("survives schema changes underneath a cached statement", () => {
    const db = createConnection(":memory:");
    try {
      db.$client.exec("CREATE TABLE t (a INTEGER)");
      db.$client.prepare("INSERT INTO t (a) VALUES (?)").run(1);
      expect(db.$client.prepare("SELECT * FROM t").all()).toEqual([{ a: 1 }]);
      db.$client.exec("ALTER TABLE t ADD COLUMN b TEXT DEFAULT 'd'");
      expect(db.$client.prepare("SELECT * FROM t").all()).toEqual([
        { a: 1, b: "d" },
      ]);
      db.$client.exec("DROP TABLE t");
      expect(() => db.$client.prepare("SELECT * FROM t").all()).toThrow(
        /no such table/u,
      );
    } finally {
      db.$client.close();
    }
  });

  it("is bounded and evicts the least recently used statement", () => {
    const prepare = spyOnNativePrepare();
    const db = createConnection(":memory:", { statementCacheSize: 3 });
    try {
      const sql = (n: number) => `SELECT ${n} AS n`;
      prepare.mockClear();
      db.$client.prepare(sql(1)).get();
      db.$client.prepare(sql(2)).get();
      db.$client.prepare(sql(3)).get();
      db.$client.prepare(sql(1)).get();
      db.$client.prepare(sql(4)).get();
      expect(getStatementCacheStats(db.$client)!.size).toBe(3);
      const before = prepare.mock.calls.length;
      db.$client.prepare(sql(1)).get();
      db.$client.prepare(sql(3)).get();
      db.$client.prepare(sql(4)).get();
      expect(prepare.mock.calls.length).toBe(before);
      db.$client.prepare(sql(2)).get();
      expect(prepare.mock.calls.length).toBe(before + 1);
    } finally {
      db.$client.close();
    }
  });

  it("keeps one cache per connection and clears it on close", () => {
    const a = createConnection(":memory:");
    const b = createConnection(":memory:");
    try {
      a.$client.exec("CREATE TABLE t (a INTEGER)");
      b.$client.exec("CREATE TABLE t (a INTEGER)");
      a.$client.prepare("INSERT INTO t VALUES (1)").run();
      const sql = "SELECT a FROM t";
      expect(a.$client.prepare(sql).all()).toEqual([{ a: 1 }]);
      expect(b.$client.prepare(sql).all()).toEqual([]);
      expect(a.$client.prepare(sql).database).toBe(a.$client);
      expect(b.$client.prepare(sql).database).toBe(b.$client);
      expect(getStatementCacheStats(a.$client)!.size).toBe(2);
      expect(getStatementCacheStats(b.$client)!.size).toBe(1);
      a.$client.close();
      expect(getStatementCacheStats(a.$client)!.size).toBe(0);
      expect(getStatementCacheStats(b.$client)!.size).toBe(1);
      expect(b.$client.prepare(sql).all()).toEqual([]);
    } finally {
      if (b.$client.open) b.$client.close();
    }
  });

  it("can be disabled", () => {
    const prepare = spyOnNativePrepare();
    const db = createConnection(":memory:", { statementCacheSize: 0 });
    try {
      prepare.mockClear();
      db.$client.prepare("SELECT 1").get();
      db.$client.prepare("SELECT 1").get();
      expect(prepare).toHaveBeenCalledTimes(2);
    } finally {
      db.$client.close();
    }
  });
});
