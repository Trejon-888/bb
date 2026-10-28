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

export const IX_NOT_MEMBER_MESSAGE = "This account has no access to this workspace. Ask an admin for an invitation.";

export interface IxGateDeps {
  ixAuth: IxAuthService;
}

const PROXY_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "forwarded",
  "cf-connecting-ip",
  "cf-ray",
  "cf-access-jwt-assertion",
  "true-client-ip",
];

export function isProxiedRequest(context: Context): boolean {
  return PROXY_HEADERS.some((name) => {
    const value = context.req.header(name);
    return value !== undefined && value !== "";
  });
}

function isLoopbackWithoutOrigin(context: Context): boolean {
  const address = getTrustedRemoteAddress(context);
  const origin = context.req.header("origin");
  return (
    address !== undefined &&
    LOOPBACK_ADDRESSES.has(address) &&
    (origin === undefined || origin === "") &&
    !isProxiedRequest(context)
  );
}

export async function resolveIxActor(
  context: Context,
  deps: IxGateDeps,
): Promise<IxActor | null> {
  const { ixAuth } = deps;
  if (ixAuth.mode === "off") return { kind: "off" };
  const resolution = await ixAuth.resolveSession(context.req.raw.headers);
  if (resolution.kind === "member") return resolution.actor;
  if (ixAuth.config.loopback === "owner" && isLoopbackWithoutOrigin(context)) {
    return { kind: "loopback-owner" };
  }
  if (resolution.kind === "non-member") {
    throw new ApiError(403, "ix_not_member", IX_NOT_MEMBER_MESSAGE);
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
