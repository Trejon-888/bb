import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMigratedConnection } from "@bb/db/testing";
import { Hono } from "hono";
import { afterEach } from "vitest";
import { ApiError } from "../errors.js";
import { TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY } from "../request-context.js";
import { createIxAuthService, type IxAuthService } from "./auth-service.js";
import { readIxAuthConfig } from "./config.js";
import { ixApiGate } from "./middleware.js";
import { createIxRoutes } from "./routes.js";

export const IX_TEST_BASE = "http://localhost";
const noopLogger = { debug() {}, error() {}, info() {}, warn() {} };

export function makeIxApp(ixAuth: IxAuthService, remoteAddress = "203.0.113.9"): Hono {
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.set(TRUSTED_REMOTE_ADDRESS_CONTEXT_KEY, remoteAddress);
    await next();
  });
  app.onError((error, context) => {
    if (error instanceof ApiError) return context.json(error.body, error.status);
    throw error;
  });
  app.on(["GET", "POST"], "/api/auth/*", (context) => ixAuth.handler(context.req.raw));
  app.route("/api/ix", createIxRoutes({ ixAuth }));
  const publicApi = new Hono();
  publicApi.use("*", ixApiGate({ ixAuth }));
  publicApi.get("/system/config", (context) => context.json({ ok: true }));
  publicApi.post("/projects", (context) => context.json({ created: true }));
  publicApi.post("/threads/t1/read", (context) => context.json({ read: true }));
  publicApi.post("/plugins/p1/rpc/m", (context) => context.json({ rpc: true }));
  app.route("/api/v1", publicApi);
  return app;
}

export function cookieOf(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  return raw
    .split(/,(?=[^;]+=)/)
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join("; ");
}

export async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

export function jsonInit(body: unknown, extra: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) };
}

export function createIxTestHarness(): {
  makeService(env: NodeJS.ProcessEnv): Promise<IxAuthService>;
  signInCookie(app: Hono, email: string, password: string): Promise<string>;
} {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });
  return {
    async makeService(env) {
      const dataDir = await mkdtemp(join(tmpdir(), "bb-ix-auth-test-"));
      cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
      const service = await createIxAuthService({
        db: createMigratedConnection(),
        dataDir,
        logger: noopLogger,
        config: readIxAuthConfig(env, IX_TEST_BASE),
      });
      await service.ensureReady();
      return service;
    },
    async signInCookie(app, email, password) {
      const response = await app.request("/api/ix/sign-in", jsonInit({ email, password }));
      if (response.status !== 200) throw new Error(`sign-in failed: ${response.status} ${await response.text()}`);
      return cookieOf(response);
    },
  };
}
