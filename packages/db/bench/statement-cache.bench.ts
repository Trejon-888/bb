import Database from "better-sqlite3";
import { performance } from "node:perf_hooks";
import { createConnection, getStatementCacheStats } from "../src/connection.js";
import { migrate } from "../src/migrate.js";

const DISTINCT = 200;
const ROUNDS = 50;

const nativePrepare = Database.prototype.prepare;
let compiles = 0;
Database.prototype.prepare = function (
  this: Database.Database,
  source: string,
) {
  compiles += 1;
  return nativePrepare.call(this, source);
} as typeof nativePrepare;

function statements(): string[] {
  const out: string[] = [];
  for (let i = 0; i < DISTINCT; i++) {
    switch (i % 5) {
      case 0:
        out.push(
          `SELECT id, title, status FROM threads WHERE id = 'thr-${i}' LIMIT 1`,
        );
        break;
      case 1:
        out.push(
          `SELECT id, sequence, created_at FROM events WHERE thread_id = 'thr-${i}' ORDER BY sequence DESC LIMIT ${10 + i}`,
        );
        break;
      case 2:
        out.push(
          `SELECT COUNT(*) AS n FROM threads WHERE project_id = 'proj-${i}' AND archived_at IS NULL`,
        );
        break;
      case 3:
        out.push(
          `SELECT t.id, p.name FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.id = 'thr-${i}'`,
        );
        break;
      default:
        out.push(
          `SELECT id, name FROM projects WHERE id = 'proj-${i}' OR name = 'name-${i}'`,
        );
    }
  }
  return out;
}

function run(label: string, statementCacheSize: number) {
  const db = createConnection(":memory:", { statementCacheSize });
  migrate(db);
  const sqls = statements();
  for (const sql of sqls) db.$client.prepare(sql).all();
  compiles = 0;
  const started = performance.now();
  for (let round = 0; round < ROUNDS; round++)
    for (const sql of sqls) db.$client.prepare(sql).all();
  const ms = performance.now() - started;
  const stats = getStatementCacheStats(db.$client);
  console.log(
    `${label.padEnd(10)} ${DISTINCT} stmts x ${ROUNDS}: ${ms.toFixed(1)} ms total, ${(
      (ms * 1000) /
      (DISTINCT * ROUNDS)
    ).toFixed(
      1,
    )} us/exec, native compiles ${compiles}, cache hits ${stats?.hits ?? 0}`,
  );
  db.$client.close();
  return ms;
}

run("warmup", 0);
const before = run("uncached", 0);
const after = run("cached", 512);
console.log(
  `saving ${(((before - after) / before) * 100).toFixed(0)}% of prepare+execute time`,
);
