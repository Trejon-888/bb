import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { organization } from "better-auth/plugins/organization";
import type { DbConnection } from "@bb/db";
import { readOrCreateSecretFile } from "@bb/secret-storage";
import type { ServerLogger } from "../types.js";
import {
  parseIxRole,
  type IxAuthConfig,
  type IxAuthMode,
  type IxRole,
} from "./config.js";
import type { IxActor } from "./context.js";

const AUTH_SECRET_FILE_NAME = "ix-auth-secret";
const MODEL_NAMES = {
  user: "ix_user",
  session: "ix_session",
  account: "ix_account",
  verification: "ix_verification",
  organization: "ix_organization",
  member: "ix_member",
  invitation: "ix_invitation",
} as const;

export interface IxMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: IxRole;
  createdAt: string;
}

export interface IxInvitation {
  id: string;
  email: string;
  role: IxRole;
  status: string;
  expiresAt: string;
  inviterId: string;
}

export interface IxAuthService {
  readonly mode: IxAuthMode;
  readonly config: IxAuthConfig;
  ensureReady(): Promise<void>;
  handler(request: Request): Promise<Response>;
  resolveActor(headers: Headers): Promise<IxActor | null>;
  status(): Promise<{ mode: IxAuthMode; bootstrapped: boolean; orgName: string | null }>;
  bootstrap(input: {
    email: string;
    password: string;
    name: string;
    orgName?: string;
  }): Promise<{ userId: string; organizationId: string }>;
  listMembers(): Promise<IxMember[]>;
  invite(input: {
    email: string;
    role: IxRole;
    inviterUserId: string;
  }): Promise<IxInvitation>;
  listInvitations(): Promise<IxInvitation[]>;
  cancelInvitation(id: string): Promise<void>;
  acceptInvitation(input: {
    token: string;
    name: string;
    password: string;
  }): Promise<{ userId: string; role: IxRole; headers: Headers }>;
  setRole(memberId: string, role: IxRole): Promise<void>;
  removeMember(memberId: string): Promise<void>;
  signIn(input: { email: string; password: string }): Promise<Headers>;
  signOut(headers: Headers): Promise<Headers>;
}

interface AuthLike {
  options: Parameters<typeof getMigrations>[0];
  handler(request: Request): Promise<Response>;
  api: Record<string, (args: never) => Promise<unknown>>;
  $context: Promise<{
    adapter: {
      findOne<T>(args: { model: string; where: Array<{ field: string; value: unknown; operator?: string }> }): Promise<T | null>;
      findMany<T>(args: { model: string; where?: Array<{ field: string; value: unknown; operator?: string }>; limit?: number }): Promise<T[]>;
      update<T>(args: { model: string; where: Array<{ field: string; value: unknown }>; update: Record<string, unknown> }): Promise<T | null>;
      delete(args: { model: string; where: Array<{ field: string; value: unknown }> }): Promise<void>;
      create<T>(args: { model: string; data: Record<string, unknown> }): Promise<T>;
    };
    internalAdapter: {
      createSession(userId: string, dontRememberMe?: boolean, override?: Record<string, unknown>): Promise<{ token: string; expiresAt: Date }>;
    };
  }>;
}

type ApiCall = <T>(name: string, args: Record<string, unknown>) => Promise<T>;

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") return value;
  return new Date(0).toISOString();
}

function sessionCookieHeaders(response: Response): Headers {
  const headers = new Headers();
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === "set-cookie") headers.append("set-cookie", value);
  }
  return headers;
}

export async function createIxAuthService(args: {
  db: DbConnection;
  dataDir: string;
  logger: ServerLogger;
  config: IxAuthConfig;
}): Promise<IxAuthService> {
  const { config, logger } = args;
  const secret = await readOrCreateSecretFile({
    bytes: 32,
    dataDir: args.dataDir,
    encoding: "hex",
    fileName: AUTH_SECRET_FILE_NAME,
  });
  const auth = betterAuth({
    appName: "bb",
    baseURL: config.baseUrl,
    basePath: "/api/auth",
    secret,
    database: args.db.$client,
    trustedOrigins: [config.baseUrl],
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    session: {
      modelName: MODEL_NAMES.session,
      expiresIn: config.sessionDays * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    user: { modelName: MODEL_NAMES.user },
    account: { modelName: MODEL_NAMES.account },
    verification: { modelName: MODEL_NAMES.verification },
    advanced: { database: { generateId: "uuid" } },
    plugins: [
      organization({
        allowUserToCreateOrganization: async () => (await primaryOrg()) === null,
        creatorRole: "owner",
        invitationExpiresIn: 7 * 24 * 60 * 60,
        schema: {
          organization: { modelName: MODEL_NAMES.organization },
          member: { modelName: MODEL_NAMES.member },
          invitation: { modelName: MODEL_NAMES.invitation },
        },
      }),
    ],
  }) as unknown as AuthLike;

  const api: ApiCall = async (name, callArgs) => {
    const fn = auth.api[name];
    if (fn === undefined) throw new Error(`better-auth api ${name} is missing`);
    return (await fn(callArgs as never)) as never;
  };

  type UserRow = { id: string; email: string; name: string; createdAt?: unknown };
  type OrgRow = { id: string; name: string; slug: string };
  type MemberRow = { id: string; userId: string; organizationId: string; role: string; createdAt?: unknown };
  type InvitationRow = { id: string; email: string; role: string; status: string; expiresAt: unknown; inviterId: string; organizationId: string };

  async function adapter() {
    return (await auth.$context).adapter;
  }
  async function primaryOrg(): Promise<OrgRow | null> {
    const rows = await (await adapter()).findMany<OrgRow>({ model: "organization", limit: 1 });
    return rows[0] ?? null;
  }
  async function memberOf(userId: string): Promise<MemberRow | null> {
    const org = await primaryOrg();
    if (org === null) return null;
    return (await adapter()).findOne<MemberRow>({
      model: "member",
      where: [
        { field: "userId", value: userId },
        { field: "organizationId", value: org.id },
      ],
    });
  }

  let ready: Promise<void> | null = null;
  async function ensureReady(): Promise<void> {
    if (ready === null) {
      ready = (async () => {
        const { runMigrations } = await getMigrations(auth.options);
        await runMigrations();
        if (config.bootstrap !== null && (await primaryOrg()) === null) {
          const result = await bootstrap({ ...config.bootstrap, orgName: config.orgName });
          logger.info(
            `ix-auth: bootstrapped owner ${config.bootstrap.email} in organization ${result.organizationId}`,
          );
        }
      })();
    }
    await ready;
  }

  async function bootstrap(input: { email: string; password: string; name: string; orgName?: string }) {
    if ((await primaryOrg()) !== null) {
      throw new Error("ix-auth: this server already has an owner; use an invitation");
    }
    const signUp = await api<{ user: UserRow; token: string | null }>("signUpEmail", {
      body: { email: input.email, password: input.password, name: input.name },
    });
    const ownerHeaders = await signIn({ email: input.email, password: input.password });
    const cookie = ownerHeaders.get("set-cookie") ?? "";
    const org = await api<OrgRow>("createOrganization", {
      headers: new Headers({ cookie: cookie.split(";")[0] ?? "" }),
      body: {
        name: input.orgName ?? config.orgName,
        slug: (input.orgName ?? config.orgName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace",
        userId: signUp.user.id,
      },
    });
    return { userId: signUp.user.id, organizationId: org.id };
  }

  async function signIn(input: { email: string; password: string }): Promise<Headers> {
    const response = await auth.handler(
      new Request(`${config.baseUrl}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: config.baseUrl },
        body: JSON.stringify({ email: input.email, password: input.password }),
      }),
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ix-auth: sign-in failed (${response.status}): ${text.slice(0, 200)}`);
    }
    return sessionCookieHeaders(response);
  }

  async function resolveActor(headers: Headers): Promise<IxActor | null> {
    const session = await api<{ user: UserRow; session: { id: string } } | null>("getSession", { headers });
    if (session === null || session === undefined) return null;
    const member = await memberOf(session.user.id);
    if (member === null) return null;
    const role = parseIxRole(member.role);
    if (role === null) return null;
    return {
      kind: "user",
      user: { id: session.user.id, email: session.user.email, name: session.user.name },
      organizationId: member.organizationId,
      memberId: member.id,
      role,
    };
  }

  async function listMembers(): Promise<IxMember[]> {
    const org = await primaryOrg();
    if (org === null) return [];
    const db = await adapter();
    const members = await db.findMany<MemberRow>({ model: "member", where: [{ field: "organizationId", value: org.id }] });
    const out: IxMember[] = [];
    for (const member of members) {
      const user = await db.findOne<UserRow>({ model: "user", where: [{ field: "id", value: member.userId }] });
      const role = parseIxRole(member.role);
      if (user === null || role === null) continue;
      out.push({ id: member.id, userId: user.id, email: user.email, name: user.name, role, createdAt: toIso(member.createdAt) });
    }
    return out;
  }

  async function invite(input: { email: string; role: IxRole; inviterUserId: string }): Promise<IxInvitation> {
    const org = await primaryOrg();
    if (org === null) throw new Error("ix-auth: no organization yet; bootstrap first");
    const db = await adapter();
    const existing = await db.findOne<UserRow>({ model: "user", where: [{ field: "email", value: input.email.toLowerCase() }] });
    if (existing !== null && (await memberOf(existing.id)) !== null) {
      throw new Error(`ix-auth: ${input.email} is already a member`);
    }
    const row = await db.create<InvitationRow>({
      model: "invitation",
      data: {
        organizationId: org.id,
        email: input.email.toLowerCase(),
        role: input.role,
        status: "pending",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        inviterId: input.inviterUserId,
      },
    });
    return { id: row.id, email: row.email, role: input.role, status: row.status, expiresAt: toIso(row.expiresAt), inviterId: row.inviterId };
  }

  async function listInvitations(): Promise<IxInvitation[]> {
    const org = await primaryOrg();
    if (org === null) return [];
    const rows = await (await adapter()).findMany<InvitationRow>({ model: "invitation", where: [{ field: "organizationId", value: org.id }] });
    return rows
      .map((row) => ({ id: row.id, email: row.email, role: parseIxRole(row.role) ?? "member", status: row.status, expiresAt: toIso(row.expiresAt), inviterId: row.inviterId }))
      .sort((a, b) => (a.expiresAt < b.expiresAt ? 1 : -1));
  }

  async function cancelInvitation(id: string): Promise<void> {
    await (await adapter()).update({ model: "invitation", where: [{ field: "id", value: id }], update: { status: "canceled" } });
  }

  async function acceptInvitation(input: { token: string; name: string; password: string }) {
    const db = await adapter();
    const invitation = await db.findOne<InvitationRow>({ model: "invitation", where: [{ field: "id", value: input.token }] });
    if (invitation === null || invitation.status !== "pending") throw new Error("ix-auth: invitation is not pending");
    if (new Date(toIso(invitation.expiresAt)).getTime() < Date.now()) throw new Error("ix-auth: invitation expired");
    const role = parseIxRole(invitation.role) ?? "member";
    let user = await db.findOne<UserRow>({ model: "user", where: [{ field: "email", value: invitation.email }] });
    if (user === null) {
      const signUp = await api<{ user: UserRow }>("signUpEmail", { body: { email: invitation.email, password: input.password, name: input.name } });
      user = signUp.user;
    }
    if ((await memberOf(user.id)) === null) {
      await db.create({ model: "member", data: { organizationId: invitation.organizationId, userId: user.id, role, createdAt: new Date() } });
    }
    await db.update({ model: "invitation", where: [{ field: "id", value: invitation.id }], update: { status: "accepted" } });
    const headers = await signIn({ email: invitation.email, password: input.password });
    return { userId: user.id, role, headers };
  }

  async function setRole(memberId: string, role: IxRole): Promise<void> {
    const db = await adapter();
    const member = await db.findOne<MemberRow>({ model: "member", where: [{ field: "id", value: memberId }] });
    if (member === null) throw new Error("ix-auth: member not found");
    if (parseIxRole(member.role) === "owner" && role !== "owner") {
      const owners = (await listMembers()).filter((row) => row.role === "owner");
      if (owners.length <= 1) throw new Error("ix-auth: cannot demote the last owner");
    }
    await db.update({ model: "member", where: [{ field: "id", value: memberId }], update: { role } });
  }

  async function removeMember(memberId: string): Promise<void> {
    const db = await adapter();
    const member = await db.findOne<MemberRow>({ model: "member", where: [{ field: "id", value: memberId }] });
    if (member === null) return;
    if (parseIxRole(member.role) === "owner") {
      const owners = (await listMembers()).filter((row) => row.role === "owner");
      if (owners.length <= 1) throw new Error("ix-auth: cannot remove the last owner");
    }
    await db.delete({ model: "member", where: [{ field: "id", value: memberId }] });
    await db.delete({ model: "session", where: [{ field: "userId", value: member.userId }] });
  }

  async function signOut(headers: Headers): Promise<Headers> {
    const response = await auth.handler(
      new Request(`${config.baseUrl}/api/auth/sign-out`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: config.baseUrl, cookie: headers.get("cookie") ?? "" },
        body: "{}",
      }),
    );
    return sessionCookieHeaders(response);
  }

  return {
    mode: config.mode,
    config,
    ensureReady,
    handler: (request) => auth.handler(request),
    resolveActor,
    status: async () => {
      const org = await primaryOrg();
      return { mode: config.mode, bootstrapped: org !== null, orgName: org?.name ?? null };
    },
    bootstrap,
    listMembers,
    invite,
    listInvitations,
    cancelInvitation,
    acceptInvitation,
    setRole,
    removeMember,
    signIn,
    signOut,
  };
}
