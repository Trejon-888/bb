import { Hono } from "hono";
import { listPublicProjects, type DbConnection } from "@bb/db";
import { ixAccessModeSchema, ixProjectAccessLevelSchema } from "./access.js";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { IxAuthService } from "./auth-service.js";
import { ixBrandSchema } from "./brand.js";
import {
  IX_BRAND_ASSET_KINDS,
  IX_BRAND_ASSET_MAX_BODY_BYTES,
  IxBrandAssetError,
  ixBrandAssetInputSchema,
  parseIxBrandAssetKind,
  type IxBrandAssetKind,
} from "./brand-assets.js";
import { IX_ROLES, roleAtLeast, type IxRole } from "./config.js";
import { getIxActor, type IxActor } from "./context.js";
import { IX_NOT_MEMBER_MESSAGE, ixApiGate, type IxGateDeps } from "./middleware.js";
import { IX_SSO_SECRET_MIN_LENGTH, IxSsoError } from "./sso.js";

const bootstrapSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(80),
  orgName: z.string().min(1).max(80).optional(),
});
const signInSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const inviteSchema = z.object({ email: z.string().email(), role: z.enum(IX_ROLES).default("member") });
const acceptSchema = z.object({ token: z.string().min(1), name: z.string().min(1).max(80), password: z.string().min(8) });
const roleSchema = z.object({ role: z.enum(IX_ROLES) });
const ssoSecretSchema = z.object({ secret: z.string().min(IX_SSO_SECRET_MIN_LENGTH).max(512).nullable() });
const ssoAcceptSchema = z.object({ token: z.string().min(1).max(8192) });

function actorLabel(actor: IxActor | undefined): string {
  return actor?.kind === "user" ? actor.user.email : "loopback-owner";
}

async function parseBody<T>(context: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>): Promise<T> {
  const raw = await context.req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  return parsed.data;
}

function requireRole(actor: IxActor | undefined, min: IxRole): void {
  if (actor === undefined) throw new ApiError(401, "ix_unauthenticated", "Sign in first");
  if (actor.kind === "user" && !roleAtLeast(actor.role, min)) {
    throw new ApiError(403, "ix_forbidden", `This needs the ${min} role`);
  }
}

function assetKind(value: string): IxBrandAssetKind {
  const kind = parseIxBrandAssetKind(value);
  if (kind === null) throw new ApiError(404, "ix_asset_kind", `Asset kind must be one of: ${IX_BRAND_ASSET_KINDS.join(", ")}`);
  return kind;
}

async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  const tooLarge = () => new ApiError(413, "ix_asset_too_large", "Brand assets are limited to 2 MB");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function applyCookies(context: { header(name: string, value: string, options?: { append?: boolean }): void }, headers: Headers): void {
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === "set-cookie") context.header("set-cookie", value, { append: true });
  }
}

export function createIxRoutes(deps: IxGateDeps & { ixAuth: IxAuthService; db?: DbConnection }): Hono {
  const { ixAuth } = deps;
  const app = new Hono();

  app.get("/status", async (context) => context.json(await ixAuth.status()));

  app.get("/brand", (context) => context.json(ixAuth.brand()));

  app.get("/brand/assets/:kind", (context) => {
    const asset = ixAuth.brandAsset(assetKind(context.req.param("kind")));
    if (asset === null) throw new ApiError(404, "ix_asset_missing", "No asset of this kind is set");
    const etag = `"${asset.etag}"`;
    const headers: Record<string, string> = {
      "cache-control": "public, max-age=300",
      etag,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    };
    const ifNoneMatch = context.req.header("if-none-match");
    if (ifNoneMatch !== undefined && ifNoneMatch.split(",").some((tag) => tag.trim() === etag || tag.trim() === "*")) {
      return new Response(null, { status: 304, headers });
    }
    const bytes = Buffer.from(asset.dataBase64, "base64");
    return new Response(bytes, { status: 200, headers: { ...headers, "content-type": asset.contentType, "content-length": String(bytes.length) } });
  });

  app.post("/sign-out", async (context) => {
    const headers = await ixAuth.signOut(context.req.raw.headers);
    applyCookies(context, headers);
    return context.json({ ok: true });
  });

  app.post("/sso/accept", async (context) => {
    if (ixAuth.mode === "off") throw new ApiError(409, "ix_auth_off", "BB_IX_AUTH is off");
    const input = await parseBody(context, ssoAcceptSchema);
    let result: Awaited<ReturnType<IxAuthService["acceptSso"]>>;
    try {
      result = await ixAuth.acceptSso(input.token);
    } catch (error) {
      if (error instanceof IxSsoError) throw new ApiError(401, `ix_sso_${error.reason}`, error.message);
      throw new ApiError(409, "ix_sso", error instanceof Error ? error.message : "SSO failed");
    }
    applyCookies(context, result.headers);
    return context.json({ ok: true, userId: result.userId, role: result.role });
  });

  app.post("/bootstrap", async (context) => {
    if (ixAuth.mode === "off") throw new ApiError(409, "ix_auth_off", "BB_IX_AUTH is off");
    const status = await ixAuth.status();
    if (status.bootstrapped) throw new ApiError(409, "ix_bootstrapped", "This server already has an owner");
    const input = await parseBody(context, bootstrapSchema);
    const result = await ixAuth.bootstrap(input);
    const headers = await ixAuth.signIn({ email: input.email, password: input.password });
    applyCookies(context, headers);
    return context.json({ ok: true, ...result });
  });

  app.post("/sign-in", async (context) => {
    if (ixAuth.mode === "off") throw new ApiError(409, "ix_auth_off", "BB_IX_AUTH is off");
    const input = await parseBody(context, signInSchema);
    let headers: Headers;
    try {
      headers = await ixAuth.signIn(input);
    } catch {
      throw new ApiError(401, "ix_bad_credentials", "Email or password is wrong");
    }
    applyCookies(context, headers);
    const actor = await ixAuth.resolveActor(new Headers({ cookie: (headers.get("set-cookie") ?? "").split(";")[0] ?? "" }));
    if (actor === null) throw new ApiError(403, "ix_not_member", IX_NOT_MEMBER_MESSAGE);
    return context.json({ ok: true, actor });
  });

  app.post("/invitations/accept", async (context) => {
    if (ixAuth.mode === "off") throw new ApiError(409, "ix_auth_off", "BB_IX_AUTH is off");
    const input = await parseBody(context, acceptSchema);
    let result: Awaited<ReturnType<IxAuthService["acceptInvitation"]>>;
    try {
      result = await ixAuth.acceptInvitation(input);
    } catch (error) {
      throw new ApiError(400, "ix_invitation", error instanceof Error ? error.message : "Invitation failed");
    }
    applyCookies(context, result.headers);
    return context.json({ ok: true, userId: result.userId, role: result.role });
  });

  const authed = new Hono();
  authed.use("*", ixApiGate(deps));

  authed.get("/me", async (context) => {
    const actor = getIxActor(context);
    const status = await ixAuth.status();
    return context.json({ actor: actor ?? { kind: "off" }, mode: status.mode, orgName: status.orgName });
  });


  authed.put("/brand", async (context) => {
    const actor = getIxActor(context);
    requireRole(actor, "admin");
    const input = await parseBody(context, ixBrandSchema);
    return context.json({ ok: true, brand: ixAuth.setBrand(input, actorLabel(actor)) });
  });

  authed.put("/brand/assets/:kind", async (context) => {
    const actor = getIxActor(context);
    requireRole(actor, "admin");
    const kind = assetKind(context.req.param("kind"));
    const text = await readBoundedText(context.req.raw, IX_BRAND_ASSET_MAX_BODY_BYTES + 1024);
    const input = await parseBody({ req: { json: async () => JSON.parse(text) as unknown } }, ixBrandAssetInputSchema);
    try {
      const result = ixAuth.setBrandAsset(kind, input, actorLabel(actor));
      return context.json({
        ok: true,
        kind,
        contentType: result.asset.contentType,
        size: result.asset.size,
        etag: result.asset.etag,
        brand: result.brand,
      });
    } catch (error) {
      if (error instanceof IxBrandAssetError) {
        throw new ApiError(error.code === "too_large" ? 413 : 400, `ix_asset_${error.code}`, error.message);
      }
      throw error;
    }
  });

  authed.delete("/brand/assets/:kind", (context) => {
    const actor = getIxActor(context);
    requireRole(actor, "admin");
    const kind = assetKind(context.req.param("kind"));
    return context.json({ ok: true, brand: ixAuth.clearBrandAsset(kind, actorLabel(actor)) });
  });

  authed.put("/sso/secret", async (context) => {
    if (ixAuth.mode === "off") throw new ApiError(409, "ix_auth_off", "BB_IX_AUTH is off");
    const actor = getIxActor(context);
    requireRole(actor, "owner");
    const input = await parseBody(context, ssoSecretSchema);
    if (input.secret === null) ixAuth.clearSsoSecret(actorLabel(actor));
    else ixAuth.setSsoSecret(input.secret, actorLabel(actor));
    return context.json({ ok: true, secret: input.secret !== null });
  });

  authed.get("/members", async (context) => {
    requireRole(getIxActor(context), "viewer");
    return context.json({ members: await ixAuth.listMembers() });
  });

  authed.post("/members/invite", async (context) => {
    const actor = getIxActor(context);
    requireRole(actor, "admin");
    const input = await parseBody(context, inviteSchema);
    if (input.role === "owner" && actor?.kind === "user" && actor.role !== "owner") {
      throw new ApiError(403, "ix_forbidden", "Only an owner can invite another owner");
    }
    const inviterUserId =
      actor?.kind === "user"
        ? actor.user.id
        : (await ixAuth.listMembers()).find((member) => member.role === "owner")?.userId;
    if (inviterUserId === undefined) {
      throw new ApiError(409, "ix_no_owner", "Bootstrap an owner before inviting members");
    }
    let invitation: Awaited<ReturnType<IxAuthService["invite"]>>;
    try {
      invitation = await ixAuth.invite({ ...input, inviterUserId });
    } catch (error) {
      throw new ApiError(409, "ix_invite", error instanceof Error ? error.message : "Invite failed");
    }
    const acceptUrl = `${ixAuth.config.baseUrl}/?ix-invite=${encodeURIComponent(invitation.id)}`;
    return context.json({ invitation, acceptUrl });
  });

  authed.get("/invitations", async (context) => {
    requireRole(getIxActor(context), "admin");
    return context.json({ invitations: await ixAuth.listInvitations() });
  });

  authed.delete("/invitations/:id", async (context) => {
    requireRole(getIxActor(context), "admin");
    await ixAuth.cancelInvitation(context.req.param("id"));
    return context.json({ ok: true });
  });

  authed.post("/members/:id/role", async (context) => {
    const actor = getIxActor(context);
    requireRole(actor, "admin");
    const input = await parseBody(context, roleSchema);
    if (input.role === "owner" && actor?.kind === "user" && actor.role !== "owner") {
      throw new ApiError(403, "ix_forbidden", "Only an owner can grant owner");
    }
    try {
      await ixAuth.setRole(context.req.param("id"), input.role);
    } catch (error) {
      throw new ApiError(409, "ix_role", error instanceof Error ? error.message : "Role change failed");
    }
    return context.json({ ok: true });
  });

  authed.get("/access", async (context) => {
    requireRole(getIxActor(context), "admin");
    const members = await ixAuth.listMembers();
    const projects = deps.db === undefined ? [] : listPublicProjects(deps.db).map((project) => ({ id: project.id, name: project.name }));
    return context.json({
      mode: ixAuth.access.mode(),
      projects,
      members: members.map((member) => ({ memberId: member.id, userId: member.userId, email: member.email, name: member.name, role: member.role, projects: ixAuth.access.grantsFor(member.userId) })),
    });
  });

  authed.put("/access/mode", async (context) => {
    requireRole(getIxActor(context), "admin");
    const input = await parseBody(context, z.object({ mode: ixAccessModeSchema }).strict());
    ixAuth.access.setMode(input.mode);
    return context.json({ ok: true, mode: input.mode });
  });

  authed.put("/access/members/:memberId/projects/:projectId", async (context) => {
    requireRole(getIxActor(context), "admin");
    const input = await parseBody(context, z.object({ level: ixProjectAccessLevelSchema.nullable() }).strict());
    const member = (await ixAuth.listMembers()).find((m) => m.id === context.req.param("memberId"));
    if (member === undefined) throw new ApiError(404, "ix_member_not_found", "Member not found");
    const projectId = context.req.param("projectId");
    if (deps.db !== undefined && !listPublicProjects(deps.db).some((project) => project.id === projectId)) {
      throw new ApiError(404, "project_not_found", "Project not found");
    }
    const projects = ixAuth.access.setGrant(member.userId, projectId, input.level);
    return context.json({ ok: true, memberId: member.id, projects });
  });

  authed.delete("/members/:id", async (context) => {
    const actor = getIxActor(context);
    requireRole(actor, "admin");
    if (actor?.kind === "user" && actor.memberId === context.req.param("id")) {
      throw new ApiError(409, "ix_self", "Remove yourself through another admin");
    }
    try {
      await ixAuth.removeMember(context.req.param("id"));
    } catch (error) {
      throw new ApiError(409, "ix_member", error instanceof Error ? error.message : "Removal failed");
    }
    return context.json({ ok: true });
  });

  app.route("/", authed);
  return app;
}
