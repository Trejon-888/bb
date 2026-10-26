import { spawnSync } from "node:child_process";
import { mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const output = join(process.env.RUNNER_TEMP, "cold-install-results");
mkdirSync(output, { recursive: true });
const sequence = process.env.BENCHMARK_ORDER === "baseline-first"
  ? ["baseline", "candidate", "candidate", "baseline"]
  : ["candidate", "baseline", "baseline", "candidate"];
const results = [];
for (const [index, variant] of sequence.entries()) {
  const directory = join(process.env.RUNNER_TEMP, `cold-install-${index}`);
  const checkout = spawnSync("git", ["worktree", "add", "--detach", directory, "HEAD"], { stdio: "inherit" });
  if (checkout.status !== 0) throw new Error("Worktree creation failed");
  const store = join(process.env.RUNNER_TEMP, `cold-store-${index}`);
  const args = ["install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts", "--filter", "!@bb/mobile", "--store-dir", store,
    "--fetch-timeout=30000", "--fetch-retries=2", "--fetch-retry-mintimeout=1000", "--fetch-retry-maxtimeout=5000"];
  if (variant === "candidate") args.push("--network-concurrency=64");
  const fd = openSync(join(output, `${index}-${variant}.log`), "w");
  const started = performance.now();
  const result = spawnSync("pnpm", args, { cwd: directory, shell: true, stdio: ["ignore", fd, fd] });
  const seconds = (performance.now() - started) / 1000;
  closeSync(fd);
  results.push({ variant, seconds, status: result.status, error: result.error?.message });
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.at(-1)));
  if (result.status !== 0) throw new Error(`${variant} install failed`);
}
