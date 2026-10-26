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
let candidateDirectory;
const testFilters = ["--filter=bb-plugin-*", "--filter=!bb-plugin-provider-*", "--filter=!bb-plugin-tasks", "--filter=!bb-plugin-connect", "--filter=!bb-plugin-thread-list"];
for (const [index, variant] of sequence.entries()) {
  const directory = join(process.env.RUNNER_TEMP, `cold-install-${index}`);
  const checkout = spawnSync("git", ["worktree", "add", "--detach", directory, "HEAD"], { stdio: "inherit" });
  if (checkout.status !== 0) throw new Error("Worktree creation failed");
  const store = join(process.env.RUNNER_TEMP, `cold-store-${index}`);
  const started = performance.now();
  let filters = ["--filter", "!@bb/mobile"];
  if (variant === "candidate") {
    candidateDirectory = directory;
    const selected = spawnSync("pnpm", ["list", ...testFilters, "--depth", "-1", "--json"], { cwd: directory, shell: true, encoding: "utf8" });
    if (selected.status !== 0) throw new Error(selected.stderr);
    filters = ["--filter", "bb", "--filter", "@bb/app...", "--filter", "@bb/db...", ...JSON.parse(selected.stdout).flatMap((pkg) => ["--filter", `${pkg.name}...`])];
  }
  const args = ["install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts", ...filters, "--store-dir", store,
    "--fetch-timeout=30000", "--fetch-retries=2", "--fetch-retry-mintimeout=1000", "--fetch-retry-maxtimeout=5000"];
  const fd = openSync(join(output, `${index}-${variant}.log`), "w");
  const result = spawnSync("pnpm", args, { cwd: directory, shell: true, stdio: ["ignore", fd, fd] });
  const seconds = (performance.now() - started) / 1000;
  closeSync(fd);
  results.push({ variant, seconds, status: result.status, error: result.error?.message });
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.at(-1)));
  if (result.status !== 0) throw new Error(`${variant} install failed`);
}

const fd = openSync(join(output, "candidate-full-tests.log"), "w");
const validated = spawnSync("pnpm", ["exec", "turbo", "run", "test", ...testFilters, "--continue", "--output-logs=full", "--concurrency=2"], { cwd: candidateDirectory, shell: true, stdio: ["ignore", fd, fd] });
closeSync(fd);
writeFileSync(join(output, "validation.json"), JSON.stringify({status: validated.status, error: validated.error?.message}));
if (validated.status !== 0) process.exitCode = 1;
