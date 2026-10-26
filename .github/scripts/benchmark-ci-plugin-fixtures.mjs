import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const output = join(process.env.RUNNER_TEMP, "plugin-fixture-results");
mkdirSync(output, { recursive: true });
const files = ["plugins/environment-git-worktree/host.test.ts", "plugins/github-pr-status/host.test.ts", "plugins/git/host/workspace-status-cache.test.ts"];
const candidate = files.map((file) => readFileSync(file));
const fetched = spawnSync("git", ["fetch", "--depth=1", "origin", '60fd1b12473af97a8ae5139dff00cb64d5e7b513'], { stdio: "inherit" });
if (fetched.status !== 0) throw new Error("Baseline fetch failed");
const baseline = files.map((file) => {
  const result = spawnSync("git", ["show", `FETCH_HEAD:${file}`], { maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Baseline read failed: ${file}`);
  return result.stdout;
});
const sequence = process.env.BENCHMARK_ORDER === "baseline-first"
  ? ["baseline", "candidate", "candidate", "baseline"]
  : ["candidate", "baseline", "baseline", "candidate"];
const results = [];
for (const [index, variant] of sequence.entries()) {
  files.forEach((file, i) => writeFileSync(file, (variant === "baseline" ? baseline : candidate)[i]));
  const fd = openSync(join(output, `${index}-${variant}.log`), "w");
  const args = ["exec", "turbo", "run", "test", "--filter=bb-plugin-*", "--filter=!bb-plugin-provider-*", "--filter=!bb-plugin-tasks", "--filter=!bb-plugin-connect", "--filter=!bb-plugin-thread-list", "--only", "--force", "--env-mode=loose", "--continue", "--output-logs=full", "--concurrency=2"];
  const started = performance.now();
  const result = spawnSync("pnpm", args, { shell: true, stdio: ["ignore", fd, fd] });
  const seconds = (performance.now() - started) / 1000;
  closeSync(fd);
  results.push({ variant, seconds, status: result.status, error: result.error?.message });
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.at(-1)));
}
files.forEach((file, i) => writeFileSync(file, candidate[i]));
if (results.some((result) => result.status !== 0)) process.exitCode = 1;
