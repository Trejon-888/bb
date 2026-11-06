import Database from "better-sqlite3";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { resourceUsage, threadCpuUsage } from "node:process";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { registerHostPathSqlFunctions } from "./data/host-path-sql.js";
import {
  createWalSampler,
  finishQueryDiagnostics,
  type QueryDiagnosticsLogFields,
} from "./query-diagnostics.js";
import * as schema from "./schema.js";

export interface SlowDbQueryLogFields {
  bindingArgumentCount: number;
  durationMs: number;
  cpuDurationMs: number;
  operation: SlowDbQueryOperation;
  sql: string;
  thresholdMs: number;
  diagnostics?: QueryDiagnosticsLogFields;
}

export interface SlowDbQueryLogger {
  info(fields: SlowDbQueryLogFields, message: string): void;
}

export interface CreateConnectionOptions {
  slowQueryLogger?: SlowDbQueryLogger;
  slowQueryThresholdMs?: number | (() => number);
  slowQueryDiagnosticsEnabled?: () => boolean;
  statementCacheSize?: number;
}

export interface StatementCacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  bypassed: number;
}

export type DbConnection = ReturnType<typeof createConnection>;
export type DbTransaction = Parameters<
  Parameters<DbConnection["transaction"]>[0]
>[0];
export type DbQueryConnection = DbConnection | DbTransaction;
export type SlowDbQueryOperation =
  | "all"
  | "get"
  | "run"
  | "exec"
  | "transaction";

const compiledQueries = new WeakMap<
  DbQueryConnection,
  Map<(db: DbQueryConnection) => unknown, unknown>
>();

type CommitContext = { pending: Array<() => void> | undefined };
const commitContexts = new WeakMap<DbQueryConnection, CommitContext>();

export function afterCommit(db: DbQueryConnection, callback: () => void): void {
  const pending = commitContexts.get(db)?.pending;
  if (pending) pending.push(callback);
  else callback();
}

export function prepareCachedQuery<TQuery>(
  db: DbQueryConnection,
  build: (db: DbQueryConnection) => TQuery,
): TQuery {
  let queries = compiledQueries.get(db);
  if (!queries) {
    queries = new Map();
    compiledQueries.set(db, queries);
  }
  if (queries.has(build)) return queries.get(build) as TQuery;
  const query = build(db);
  queries.set(build, query);
  return query;
}

interface SlowDbQueryConfig {
  logger: SlowDbQueryLogger;
  thresholdMs: number | (() => number);
  sampleWal: () => QueryDiagnosticsLogFields["wal"];
  diagnosticsEnabled: () => boolean;
}

interface TimedStatementOperationArgs<TValue> {
  bindingArgumentCount: number;
  config: SlowDbQueryConfig;
  operation: SlowDbQueryOperation;
  source: string;
  work: () => TValue;
}

const DEFAULT_SLOW_DB_QUERY_LOG_THRESHOLD_MS = 100;
export const SQLITE_CACHE_SIZE_KIB = 262_144;
export const SQLITE_MMAP_SIZE_BYTES = 1_073_741_824;
export const SQLITE_BUSY_TIMEOUT_MS = 5_000;
const MAX_LOGGED_SQL_LENGTH = 1_000;
const SQL_TRUNCATION_SUFFIX = "...";
const SQL_STRING_LITERAL_PATTERN = /'(?:''|[^'])*'/gu;
const SQL_WHITESPACE_PATTERN = /\s+/gu;

function roundDurationMs(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

function formatSqlForLog(source: string): string {
  const redacted = source.replace(SQL_STRING_LITERAL_PATTERN, "'?'");
  const normalized = redacted.replace(SQL_WHITESPACE_PATTERN, " ").trim();
  if (normalized.length <= MAX_LOGGED_SQL_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(
    0,
    MAX_LOGGED_SQL_LENGTH - SQL_TRUNCATION_SUFFIX.length,
  )}${SQL_TRUNCATION_SUFFIX}`;
}

function runTimedStatementOperation<TValue>(
  args: TimedStatementOperationArgs<TValue>,
): TValue {
  const startedUsage = args.config.diagnosticsEnabled()
    ? resourceUsage()
    : null;
  const startedCpu = threadCpuUsage();
  const startedAt = performance.now();
  try {
    return args.work();
  } finally {
    const durationMs = performance.now() - startedAt;
    const thresholdMs =
      typeof args.config.thresholdMs === "function"
        ? args.config.thresholdMs()
        : args.config.thresholdMs;
    if (durationMs >= thresholdMs) {
      const cpu = threadCpuUsage(startedCpu);
      const finishedUsage = startedUsage ? resourceUsage() : null;
      args.config.logger.info(
        {
          bindingArgumentCount: args.bindingArgumentCount,
          durationMs: roundDurationMs(durationMs),
          cpuDurationMs: roundDurationMs((cpu.user + cpu.system) / 1_000),
          operation: args.operation,
          sql: formatSqlForLog(args.source),
          thresholdMs,
          ...(startedUsage && finishedUsage
            ? {
                diagnostics: finishQueryDiagnostics(
                  startedUsage,
                  finishedUsage,
                  args.config.sampleWal(),
                ),
              }
            : {}),
        },
        "Slow DB query",
      );
    }
  }
}

function instrumentStatement(
  statement: Database.Statement,
  source: string,
  config: SlowDbQueryConfig,
): Database.Statement {
  const originalAll = statement.all.bind(statement);
  const originalGet = statement.get.bind(statement);
  const originalRun = statement.run.bind(statement);

  statement.all = (...params) =>
    runTimedStatementOperation({
      bindingArgumentCount: params.length,
      config,
      operation: "all",
      source,
      work: () => originalAll(...params),
    });
  statement.get = (...params) =>
    runTimedStatementOperation({
      bindingArgumentCount: params.length,
      config,
      operation: "get",
      source,
      work: () => originalGet(...params),
    });
  statement.run = (...params) =>
    runTimedStatementOperation({
      bindingArgumentCount: params.length,
      config,
      operation: "run",
      source,
      work: () => originalRun(...params),
    });

  return statement;
}

export const DEFAULT_STATEMENT_CACHE_SIZE = 512;

const UNCACHED_LEADING_KEYWORDS = new Set([
  "ALTER",
  "ANALYZE",
  "ATTACH",
  "BEGIN",
  "COMMIT",
  "CREATE",
  "DETACH",
  "DROP",
  "END",
  "PRAGMA",
  "REINDEX",
  "RELEASE",
  "ROLLBACK",
  "SAVEPOINT",
  "VACUUM",
]);
const SQL_LEADING_COMMENTS_PATTERN = /^(?:\s+|--[^\n]*\n|\/\*[\s\S]*?\*\/)*/u;
const SQL_LEADING_WORD_PATTERN = /^[A-Za-z]+/u;

export function isCacheableStatementSql(source: string): boolean {
  const body = source.replace(SQL_LEADING_COMMENTS_PATTERN, "");
  const word = SQL_LEADING_WORD_PATTERN.exec(body)?.[0];
  if (word === undefined) return false;
  return !UNCACHED_LEADING_KEYWORDS.has(word.toUpperCase());
}

const statementCacheStats = new WeakMap<
  Database.Database,
  StatementCacheStats
>();

export function getStatementCacheStats(
  sqlite: Database.Database,
): StatementCacheStats | undefined {
  return statementCacheStats.get(sqlite);
}

function installStatementCache(
  sqlite: Database.Database,
  prepare: Database.Database["prepare"],
  maxSize: number,
): { prepare: Database.Database["prepare"]; clear: () => void } {
  const stats: StatementCacheStats = {
    size: 0,
    maxSize,
    hits: 0,
    misses: 0,
    bypassed: 0,
  };
  statementCacheStats.set(sqlite, stats);
  const cache = new Map<string, Database.Statement>();
  const sync = () => {
    stats.size = cache.size;
  };
  if (maxSize <= 0) {
    return {
      prepare: (source: string) => {
        stats.bypassed += 1;
        return prepare(source);
      },
      clear: () => {},
    };
  }
  function evictOnBind(source: string, statement: Database.Statement): void {
    const originalBind = statement.bind.bind(statement);
    statement.bind = (...params) => {
      if (cache.get(source) === statement) {
        cache.delete(source);
        sync();
      }
      return originalBind(...params);
    };
  }
  function cachedPrepare(source: string): Database.Statement {
    if (!isCacheableStatementSql(source)) {
      stats.bypassed += 1;
      return prepare(source);
    }
    const hit = cache.get(source);
    if (hit !== undefined) {
      if (hit.busy) {
        stats.bypassed += 1;
        return prepare(source);
      }
      stats.hits += 1;
      cache.delete(source);
      cache.set(source, hit);
      if (hit.reader) {
        hit.raw(false);
        hit.pluck(false);
        hit.expand(false);
      }
      return hit;
    }
    stats.misses += 1;
    const statement = prepare(source);
    evictOnBind(source, statement);
    cache.set(source, statement);
    if (cache.size > maxSize) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    sync();
    return statement;
  }
  return {
    prepare: cachedPrepare as Database.Database["prepare"],
    clear: () => {
      cache.clear();
      sync();
    },
  };
}

function instrumentSqliteClient(
  sqlite: Database.Database,
  options: CreateConnectionOptions,
): { clearStatementCache: () => void } {
  const rawPrepare: Database.Database["prepare"] = sqlite.prepare.bind(sqlite);
  const statementCacheSize =
    options.statementCacheSize ?? DEFAULT_STATEMENT_CACHE_SIZE;
  function installPrepare(base: Database.Database["prepare"]) {
    const statementCache = installStatementCache(
      sqlite,
      base,
      statementCacheSize,
    );
    Object.defineProperty(sqlite, "prepare", {
      configurable: true,
      value: statementCache.prepare,
      writable: true,
    });
    return { clearStatementCache: statementCache.clear };
  }
  if (!options.slowQueryLogger) {
    return installPrepare(rawPrepare);
  }

  const config: SlowDbQueryConfig = {
    logger: options.slowQueryLogger,
    thresholdMs:
      options.slowQueryThresholdMs ?? DEFAULT_SLOW_DB_QUERY_LOG_THRESHOLD_MS,
    sampleWal: createWalSampler(
      sqlite.memory ? null : `${resolve(sqlite.name)}-wal`,
    ),
    diagnosticsEnabled: options.slowQueryDiagnosticsEnabled ?? (() => false),
  };
  const originalExec = sqlite.exec.bind(sqlite);
  sqlite.exec = (source) =>
    runTimedStatementOperation({
      bindingArgumentCount: 0,
      config,
      operation: "exec",
      source,
      work: () => originalExec(source),
    });
  const originalTransaction = sqlite.transaction.bind(sqlite);
  sqlite.transaction = (fn) => {
    const original = originalTransaction(fn);
    function wrap(mode: "default" | "deferred" | "immediate" | "exclusive") {
      return function (this: unknown, ...params: Parameters<typeof original>) {
        return runTimedStatementOperation({
          bindingArgumentCount: params.length,
          config,
          operation: "transaction",
          source: `TRANSACTION ${mode.toUpperCase()}`,
          work: () => original[mode].apply(this, params),
        });
      };
    }
    const modes = {
      default: wrap("default"),
      deferred: wrap("deferred"),
      immediate: wrap("immediate"),
      exclusive: wrap("exclusive"),
    };
    const transaction = Object.assign(modes.default, modes);
    for (const mode of Object.values(modes)) {
      Object.defineProperties(mode, {
        default: {
          value: modes.default,
          enumerable: false,
          writable: false,
          configurable: false,
        },
        deferred: {
          value: modes.deferred,
          enumerable: false,
          writable: false,
          configurable: false,
        },
        immediate: {
          value: modes.immediate,
          enumerable: false,
          writable: false,
          configurable: false,
        },
        exclusive: {
          value: modes.exclusive,
          enumerable: false,
          writable: false,
          configurable: false,
        },
        database: { value: sqlite, enumerable: true },
      });
    }
    return transaction;
  };
  return installPrepare(((source: string) =>
    instrumentStatement(
      rawPrepare(source),
      source,
      config,
    )) as Database.Database["prepare"]);
}

export function createConnection(
  source: string | Buffer = "bb.db",
  options: CreateConnectionOptions = {},
) {
  const sqlite = new Database(source);

  sqlite.pragma("auto_vacuum = INCREMENTAL");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma(`cache_size = -${SQLITE_CACHE_SIZE_KIB}`);
  sqlite.pragma(`mmap_size = ${SQLITE_MMAP_SIZE_BYTES}`);
  sqlite.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  registerHostPathSqlFunctions(sqlite);
  const { clearStatementCache } = instrumentSqliteClient(sqlite, options);

  const db = drizzle({ client: sqlite, schema });
  const queries = new Map<(db: DbQueryConnection) => unknown, unknown>();
  compiledQueries.set(db, queries);
  const originalTransaction = db.transaction.bind(db);
  const commitContext: CommitContext = { pending: undefined };
  commitContexts.set(db, commitContext);
  function prepareTransaction(tx: DbTransaction): void {
    compiledQueries.set(tx, queries);
    commitContexts.set(tx, commitContext);
    const nestedTransaction = tx.transaction.bind(tx);
    tx.transaction = (work) =>
      transactionCallbacks(() =>
        nestedTransaction((nested) => {
          prepareTransaction(nested);
          return work(nested);
        }),
      );
  }
  function transactionCallbacks<T>(work: () => T): T {
    const parent = commitContext.pending;
    const callbacks: Array<() => void> = [];
    let result: T;
    try {
      commitContext.pending = callbacks;
      result = work();
    } finally {
      commitContext.pending = parent;
    }
    if (parent) parent.push(...callbacks);
    else
      for (const callback of callbacks) {
        try {
          callback();
        } catch {}
      }
    return result;
  }
  db.transaction = (work, config) =>
    transactionCallbacks(() =>
      originalTransaction((tx) => {
        prepareTransaction(tx);
        return work(tx);
      }, config),
    );
  const originalClose = sqlite.close.bind(sqlite);
  sqlite.close = () => {
    const result = originalClose();
    queries.clear();
    clearStatementCache();
    return result;
  };

  return db;
}
