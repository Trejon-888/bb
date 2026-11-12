import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMigratedConnection } from "@bb/db/testing";
import {
  PLUGIN_LIST_REUSE_MS,
  registerPluginRoutes,
} from "../../src/routes/plugins.js";
import { createPluginInstallJobs } from "../../src/services/plugins/plugin-install-jobs.js";
import { createPluginUpdateJobs } from "../../src/services/plugins/plugin-update-jobs.js";
import type { PluginService } from "../../src/services/plugins/plugin-service.js";

afterEach(() => vi.restoreAllMocks());

function setup(withRevision: boolean) {
  let revision = 0;
  let builds = 0;
  let status = "running";
  const service = {
    list: () => {
      builds += 1;
      return [{ id: "alpha", status, build: builds }];
    },
    ...(withRevision ? { listRevision: () => String(revision) } : {}),
  } as unknown as PluginService;
  const app = new Hono();
  registerPluginRoutes(
    app,
    { config: { serverPort: 3334 }, db: createMigratedConnection() },
    service,
    createPluginInstallJobs({ notifyChanged: () => {} }),
    createPluginUpdateJobs({ notifyChanged: () => {} }),
  );
  const get = async () => {
    const response = await app.request("/plugins");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    return (await response.json()) as {
      plugins: Array<{ id: string; status: string; build: number }>;
    };
  };
  return {
    get,
    builds: () => builds,
    change: (next: string) => {
      status = next;
      revision += 1;
    },
  };
}

describe("GET /plugins answer reuse", () => {
  it("reuses the last answer within the window while nothing changed", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const s = setup(true);
    const first = await s.get();
    expect(await s.get()).toEqual(first);
    expect(await s.get()).toEqual(first);
    expect(s.builds()).toBe(1);
    now.mockReturnValue(1_000_000 + PLUGIN_LIST_REUSE_MS - 1);
    await s.get();
    expect(s.builds()).toBe(1);
    now.mockReturnValue(1_000_000 + PLUGIN_LIST_REUSE_MS);
    expect((await s.get()).plugins[0]?.build).toBe(2);
  });

  it("rebuilds at once when the plugin set or a status changed", async () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    const s = setup(true);
    expect((await s.get()).plugins[0]?.status).toBe("running");
    s.change("error");
    expect((await s.get()).plugins[0]?.status).toBe("error");
    expect(s.builds()).toBe(2);
  });

  it("rebuilds every time for a service without a revision", async () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    const s = setup(false);
    await s.get();
    await s.get();
    expect(s.builds()).toBe(2);
  });

  it("rebuilds if the clock went backwards", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(9_000);
    const s = setup(true);
    await s.get();
    now.mockReturnValue(8_000);
    await s.get();
    expect(s.builds()).toBe(2);
  });
});
