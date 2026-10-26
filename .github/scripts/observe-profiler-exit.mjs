import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const require = createRequire(join(process.cwd(), "packages/process-utils/package.json"));
const directory = join(dirname(require.resolve("vitest/package.json")), "dist/chunks");
const file = readdirSync(directory).find((name) => name.startsWith("cli-api.") && name.endsWith(".js"));
const path = join(directory, file);
const original = readFileSync(path, "utf8");
const target = "emitUnexpectedExit = () => {";
if (!original.includes(target)) throw new Error("Vitest unexpected-exit handler not found");
writeFileSync(path, original.replace(target, 'emitUnexpectedExit = (code, signal) => { console.error("WORKER_EXIT_OBSERVATION", JSON.stringify({code, signal, pid: this.worker?.pid, time: new Date().toISOString()}));'));
