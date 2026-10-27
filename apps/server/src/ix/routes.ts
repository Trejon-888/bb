import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { IxAuthService } from "./auth-service.js";
import { ixBrandSchema } from "./brand.js";
import { IX_ROLES, roleAtLeast, type IxRole } from "./config.js";
import { getIxActor, type IxActor } from "./context.js";
import { ixApiGate, type IxGateDeps } from "./middleware.js";
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
const ssoSecretSchema = z.object({ secret: z.string().min(IX_SSO_SECRET_MIN_LENGTH).max(512) });
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

function applyCookies(context: { header(name: string, value: string, options?: { append?: boolean }): void }, headers: Headers): void {
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase() === "set-cookie") context.header("set-cookie", value, { append: true });
  }
}

export function createIxRoutes(deps: IxGateDeps & { ixAuth: IxAuthService }): Hono {
  const { ixAuth } = deps;
  const app = new Hono();

  app.get("/status", async (context) => context.json(await ixAuth.status()));

  app.get("/brand", (context) => context.json(ixAuth.brand()));

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
    if (actor === null) throw new ApiError(403, "ix_not_member", "This account is not a member of this server");
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

  authed.post("/sign-out", async (context) => {
    const headers = await ixAuth.signOut(context.req.raw.headers);
    applyCookies(context, headers);
    return context.json({ ok: true });
  });

  authed.put("/brand", async (context) => {
    const actor = getIxActor(context);
    requireRole(actor, "admin");
    const input = await parseBody(context, ixBrandSchema);
    return context.json({ ok: true, brand: ixAuth.setBrand(input, actorLabel(actor)) });
  });

  authed.put("/sso/secret", async (context) => {
    if (ixAuth.mode === "off") throw new ApiError(409, "ix_auth_off", "BB_IX_AUTH is off");
    const actor = getIxActor(context);
    requireRole(actor, "owner");
    const input = await parseBody(context, ssoSecretSchema);
    ixAuth.setSsoSecret(input.secret, actorLabel(actor));
    return context.json({ ok: true });
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
    const inviterUserId = actor?.kind === "user" ? actor.user.id : "loopback-owner";
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
