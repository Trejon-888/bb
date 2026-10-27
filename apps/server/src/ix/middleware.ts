import type { Context, Hono, MiddlewareHandler } from "hono";
import { ApiError } from "../errors.js";
import { getTrustedRemoteAddress } from "../request-context.js";
import type { IxAuthService } from "./auth-service.js";
import { roleAtLeast } from "./config.js";
import { setIxActor, type IxActor } from "./context.js";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const VIEWER_WRITE_ALLOWLIST = [
  /^\/threads\/[^/]+\/read$/,
  /^\/threads\/[^/]+\/unread$/,
  /^\/system\/ui-preferences/,
  /^\/plugins\/[^/]+\/rpc\//,
];

export interface IxGateDeps {
  ixAuth: IxAuthService;
}

function isLoopbackWithoutOrigin(context: Context): boolean {
  const address = getTrustedRemoteAddress(context);
  const origin = context.req.header("origin");
  return (
    address !== undefined &&
    LOOPBACK_ADDRESSES.has(address) &&
    (origin === undefined || origin === "")
  );
}

export async function resolveIxActor(
  context: Context,
  deps: IxGateDeps,
): Promise<IxActor | null> {
  const { ixAuth } = deps;
  if (ixAuth.mode === "off") return { kind: "off" };
  const actor = await ixAuth.resolveActor(context.req.raw.headers);
  if (actor !== null) return actor;
  if (ixAuth.config.loopback === "owner" && isLoopbackWithoutOrigin(context)) {
    return { kind: "loopback-owner" };
  }
  return null;
}

export function ixApiGate(deps: IxGateDeps): MiddlewareHandler {
  return async (context, next) => {
    const actor = await resolveIxActor(context, deps);
    if (actor === null) {
      throw new ApiError(401, "ix_unauthenticated", "Sign in to use this server");
    }
    setIxActor(context, actor);
    if (actor.kind === "user" && !roleAtLeast(actor.role, "member")) {
      const method = context.req.method.toUpperCase();
      const path = context.req.path.replace(/^\/api\/v1/, "");
      const allowed =
        method === "GET" ||
        method === "HEAD" ||
        method === "OPTIONS" ||
        VIEWER_WRITE_ALLOWLIST.some((pattern) => pattern.test(path));
      if (!allowed) {
        throw new ApiError(403, "ix_forbidden", "Viewers cannot change this server");
      }
    }
    return next();
  };
}

export async function assertIxWebSocketAllowed(
  context: Context,
  deps: IxGateDeps,
): Promise<void> {
  const actor = await resolveIxActor(context, deps);
  if (actor === null) {
    throw new ApiError(401, "ix_unauthenticated", "Sign in to use this server", false);
  }
  setIxActor(context, actor);
}

export function mountIxAuthHandler(app: Hono, deps: IxGateDeps): void {
  if (deps.ixAuth.mode === "off") return;
  app.on(["GET", "POST"], "/api/auth/*", (context) =>
    deps.ixAuth.handler(context.req.raw),
  );
}
