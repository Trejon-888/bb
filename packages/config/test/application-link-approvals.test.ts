import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { createFileApplicationLinkApprovals } from "../src/application-link-approvals.js";

it("serializes independent writers so a pending grant cannot undo a revocation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bb-link-approvals-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const desktop = createFileApplicationLinkApprovals(directory);
  const cli = createFileApplicationLinkApprovals(directory);
  await desktop.allow("linear", desktop.revision());
  expect(cli.list()).toEqual(["linear"]);
  const revision = desktop.revision();
  await Promise.all([cli.revoke(null), desktop.allow("reflect", revision)]);
  expect(createFileApplicationLinkApprovals(directory).list()).toEqual([]);
  writeFileSync(join(directory, "application-link-approvals.json"), "corrupt");
  expect(desktop.list()).toEqual([]);
  await desktop.allow("reflect", desktop.revision());
  expect(cli.list()).toEqual(["reflect"]);
});
