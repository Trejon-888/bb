import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { createApplicationLinkApprovals } from "@bb/domain/application-link-approvals";

export function createFileApplicationLinkApprovals(directory: string) {
  const file = join(directory, "application-link-approvals.json");
  const approvals = createApplicationLinkApprovals({
    read() {
      try {
        return readFileSync(file, "utf8");
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw error;
      }
    },
    write(value) {
      mkdirSync(directory, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, value, { mode: 0o600 });
        renameSync(temporary, file);
      } finally {
        rmSync(temporary, { force: true });
      }
    },
  });
  const mutate = async (work: () => void) => {
    mkdirSync(directory, { recursive: true });
    const release = await lockfile.lock(file, {
      realpath: false,
      retries: { retries: 10, minTimeout: 20, maxTimeout: 100 },
    });
    try {
      work();
    } finally {
      await release();
    }
  };
  return {
    list: approvals.list,
    revision: approvals.revision,
    allow: (scheme: string, revision: number) =>
      mutate(() => approvals.allow(scheme, revision)),
    revoke: (scheme: string | null) => mutate(() => approvals.revoke(scheme)),
  };
}
