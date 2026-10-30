import { timingSafeEqual } from "node:crypto";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { ApiError } from "../errors.js";
import { getTrustedRemoteAddress } from "../request-context.js";
import type { IxAuthService } from "./auth-service.js";
import { roleAtLeast } from "./config.js";
import { setIxActor, type IxActor } from "./context.js";
import { restrictedScopeFor, runWithIxRequestAccess } from "./access.js";
import { ixTokenKind } from "./agent-token.js";

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
  /** The plugin's HTTP token (`bb plugin token <id>`), for remote calls to its token-auth routes. */
  pluginToken?: (pluginId: string) => Promise<string | undefined>;
}

const PLUGIN_HTTP_PATH = /^\/api\/v1\/plugins\/([^/]+)\/http(?:\/|$)/u;

/**
 * A request to a plugin's own HTTP routes that presents that plugin's token in the
 * `x-bb-plugin-token` header is the plugin route's business, not a user session's: an ix
 * control plane reaches a member server this way through its tunnel. The route's own
 * auth check still runs after the gate. The query-string form is not accepted here.
 */
async function pluginTokenActor(context: Context, deps: IxGateDeps): Promise<IxActor | null> {
  if (deps.pluginToken === undefined) return null;
  const match = PLUGIN_HTTP_PATH.exec(context.req.path);
  const presented = context.req.header("x-bb-plugin-token");
  if (match === null || presented === undefined || presented === "") return null;
  const pluginId = match[1] ?? "";
  const expected = await deps.pluginToken(pluginId);
  if (expected === undefined) return null;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b) ? { kind: "plugin-token", pluginId } : null;
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

function presentedIxToken(context: Context): string | null {
  const header = context.req.header("authorization");
  if (header === undefined) return null;
  const match = /^Bearer\s+(\S+)\s*$/iu.exec(header);
  const token = match?.[1];
  return token !== undefined && ixTokenKind(token) !== null ? token : null;
}

async function ixTokenActor(context: Context, deps: IxGateDeps, token: string): Promise<IxActor> {
  const invalid = () => new ApiError(401, "ix_invalid_token", "This server token is invalid, expired or no longer matches its chat", false);
  if (ixTokenKind(token) === "owner") {
    if (!isLoopbackWithoutOrigin(context) || !deps.ixAuth.verifyOwnerToken(token)) throw invalid();
    return { kind: "loopback-owner", via: "owner-token" };
  }
  const actor = await deps.ixAuth.resolveAgentToken(token);
  if (actor === null) throw invalid();
  return actor;
}

export async function resolveIxActor(
  context: Context,
  deps: IxGateDeps,
): Promise<IxActor | null> {
  const { ixAuth } = deps;
  if (ixAuth.mode === "off") return { kind: "off" };
  const token = presentedIxToken(context);
  if (token !== null) return ixTokenActor(context, deps, token);
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
    const tokenActor = await pluginTokenActor(context, deps);
    if (tokenActor !== null) {
      setIxActor(context, tokenActor);
      return next();
    }
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
    const apiPath = context.req.path.replace(/^\/api\/v1/, "");
    const readOnlyPath = VIEWER_WRITE_ALLOWLIST.some((pattern) => pattern.test(apiPath));
    const scope = restrictedScopeFor(actor, deps.ixAuth.access, context.req.method, readOnlyPath);
    if (actor.kind === "user" && !roleAtLeast(actor.role, "admin")) assertPluginAdminRoute(context.req.method, apiPath);
    if (scope !== null) assertRestrictedRoute(context.req.method, apiPath);
    const writing = !readOnlyPath && !["GET", "HEAD", "OPTIONS"].includes(context.req.method.toUpperCase());
    return runWithIxRequestAccess(actor, deps.ixAuth.access, scope, () => next(), writing);
  };
}

const RESTRICTED_DENY: Array<{ pattern: RegExp; methods: "all" | "write" }> = [
  { pattern: /^\/files(\/|$)/, methods: "all" },
  { pattern: /^\/file-previews(\/|$)/, methods: "all" },
  { pattern: /^\/hosts(\/|$)/, methods: "all" },
  { pattern: /^\/terminals(\/|$)/, methods: "all" },
  { pattern: /^\/projects$/, methods: "write" },
  { pattern: /^\/projects\/[^/]+(\/(sources|skills|machine-environment|order)(\/.*)?)?$/, methods: "write" },
  { pattern: /^\/environments(\/|$)/, methods: "write" },
];

export function assertRestrictedRoute(method: string, path: string): void {
  const writing = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  const hit = RESTRICTED_DENY.find((rule) => rule.pattern.test(path) && (rule.methods === "all" || writing));
  if (hit !== undefined) throw new ApiError(403, "ix_restricted", "Your access is limited to the projects you were granted");
}

const PLUGIN_ADMIN_PATHS = [/^\/plugins(\/|$)/, /^\/plugin-catalog\/install$/, /^\/marketplaces(\/|$)/];
const PLUGIN_USE_PATHS = /^\/plugins\/[^/]+\/(rpc|cli|http)(\/|$)/;

export function assertPluginAdminRoute(method: string, path: string): void {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return;
  if (PLUGIN_USE_PATHS.test(path)) return;
  if (PLUGIN_ADMIN_PATHS.some((pattern) => pattern.test(path))) {
    throw new ApiError(403, "ix_plugins_admin_only", "Only owners and admins can install, update, remove or configure plugins");
  }
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

export function assertIxEnrollAllowed(ixAuth: IxAuthService, authorization: string | undefined): void {
  if (ixAuth.mode === "off") return;
  const token = /^Bearer\s+(\S+)\s*$/iu.exec(authorization ?? "")?.[1];
  if (token === undefined || !ixAuth.verifyOwnerToken(token)) {
    throw new ApiError(403, "ix_enroll_forbidden", "Host enrollment keys on this server need the owner token (<dataDir>/ix-owner-token)");
  }
}
