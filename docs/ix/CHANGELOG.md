# IX fork release notes

Changes on the `ix` branch of `Trejon-888/bb` that are not in upstream bb. Upstream's own notes stay in the root `CHANGELOG.md`.

## Unreleased (candidate for ix-v0.47.1-r-next / infinitx-platform-r-next)

Platform fixes from the ACRE cell hotspots report (2026-11-06, main-thread profile of ix-cell-dal-01).

- **Prepared-statement cache in `@bb/db`.** better-sqlite3 compiled every statement anew because drizzle calls `prepare()` per executed query (~61k ms/h of `prepare` on the cell). `createConnection` now keeps an LRU of statements per connection keyed by SQL text (`statementCacheSize`, default 512; `0` disables). Schema changes, `PRAGMA` and transaction control are never cached, a `bind()`-ed statement leaves the cache, a statement that is still iterating is not shared, and result modes (`raw`/`pluck`/`expand`) are reset on every hit. `getStatementCacheStats(db.$client)` reports hits/misses/bypasses. Bench (`packages/db/bench/statement-cache.bench.ts`, 200 distinct statements x 50 rounds): 2.9 us -> 0.4 us per prepare+execute, 10,000 -> 0 native compiles.
- **Log retention is configurable.** `BB_LOG_ROTATED_FILES` (1-200, default 5) and `BB_LOG_ROTATE_SIZE` (default `10m`) replace the hard-coded five rotated files; both are validated at startup. See `docs/ix/FORK.md`.
