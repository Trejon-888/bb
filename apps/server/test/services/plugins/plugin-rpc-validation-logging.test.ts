import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { defineRpcContract, type PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createTestAppHarness } from "../../helpers/test-app.js";

it.each([
  { phase: "input", variant: "nested" },
  { phase: "output", variant: "nested" },
  { phase: "input", variant: "root" },
  { phase: "input", variant: "many" },
  { phase: "input", variant: "long" },
  { phase: "input", variant: "control characters" },
] as const)(
  "logs bounded RPC $phase validation paths for $variant without values or custom messages",
  async ({ phase, variant }) => {
    const harness = await createTestAppHarness();
    const rootDir = await mkdtemp(join(tmpdir(), "bb-rpc-diagnostics-"));
    const warn = vi.spyOn(harness.deps.logger, "warn");
    try {
      await writeFile(
        join(rootDir, "package.json"),
        JSON.stringify({
          name: "bb-plugin-rpc-diagnostics",
          version: "0.1.0",
          bb: {
            name: "RPC diagnostics fixture",
            description: "Validation logging fixture",
            branding: { icon: "Zap" },
            server: "./server.ts",
          },
        }),
      );
      await writeFile(
        join(rootDir, "server.ts"),
        "export default function plugin() {}",
      );
      expect((await harness.pluginService.installPath(rootDir)).status).toBe(
        "running",
      );
      const api = harness.pluginService.getApi("rpc-diagnostics");
      if (!api) throw new Error("fixture plugin did not start");
      const nestedSchema = z.object({
        entries: z.array(
          z.object({ count: z.number({ error: "private-validator-detail" }) }),
        ),
      });
      const keys =
        variant === "long"
          ? ["field".repeat(100)]
          : variant === "control characters"
            ? ["field\n\tname"]
            : ["first", "second", "third", "fourth"];
      const schema =
        variant === "nested"
          ? nestedSchema
          : variant === "root"
            ? z.number({ error: "private-validator-detail" })
            : z.object(
                Object.fromEntries(
                  keys.map((key) => [
                    key,
                    z.number({ error: "private-validator-detail" }),
                  ]),
                ),
              );
      const invalid =
        variant === "nested"
          ? { entries: [{ count: "private-payload-content" }] }
          : variant === "root"
            ? "private-payload-content"
            : Object.fromEntries(
                keys.map((key) => [key, "private-payload-content"]),
              );
      const handler = vi.fn(() => (phase === "output" ? invalid : null));
      const contract: PluginRpcContract = defineRpcContract({
        inspect: {
          input: phase === "input" ? schema : z.null(),
          output: phase === "output" ? schema : z.null(),
        },
      });
      api.rpc.register(contract, { inspect: handler });
      const response = await harness.app.request(
        "/api/v1/plugins/rpc-diagnostics/rpc/inspect",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(phase === "input" ? invalid : null),
        },
      );
      const body = await response.json();
      expect(response.status).toBe(phase === "input" ? 400 : 500);
      expect(body).toMatchObject({
        ok: false,
        error: {
          code: `invalid_${phase}`,
          message: `rpc ${phase} validation failed`,
          issues:
            variant === "nested"
              ? [
                  {
                    path: ["entries", 0, "count"],
                    message: "private-validator-detail",
                  },
                ]
              : variant === "root"
                ? [{ message: "private-validator-detail" }]
                : keys.map((key) => ({
                    path: [key],
                    message: "private-validator-detail",
                  })),
        },
      });
      expect(handler).toHaveBeenCalledTimes(phase === "input" ? 0 : 1);
      const warning = warn.mock.calls
        .map(([message]) => String(message))
        .find((message) => message.includes("rpc inspect failed:"));
      expect(warning).toBeDefined();
      expect(warning).not.toContain("private-payload-content");
      expect(warning).not.toContain("private-validator-detail");
      const prefix = `[plugin:rpc-diagnostics] rpc inspect failed: rpc ${phase} validation failed (paths: `;
      expect(warning?.startsWith(prefix)).toBe(true);
      expect(warning).not.toMatch(/[\n\r\t]/);
      if (variant === "nested") {
        expect(warning).toContain('["entries",0,"count"]');
      } else if (variant === "root") {
        expect(warning).toBe(`${prefix}[])`);
      } else if (variant === "many") {
        expect(warning).toBe(`${prefix}["first"]; ["second"]; ["third"])`);
      } else if (variant === "long") {
        const summary = warning?.slice(prefix.length, -1);
        expect(summary).toHaveLength(300);
        expect(summary?.endsWith("…")).toBe(true);
      } else {
        expect(warning).toBe(`${prefix}["field\\n\\tname"])`);
      }
    } finally {
      warn.mockRestore();
      await harness.pluginService.stop();
      await harness.cleanup();
      await rm(rootDir, { recursive: true, force: true });
    }
  },
);
