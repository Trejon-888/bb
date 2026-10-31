import type { Context } from "hono";
import type { IxRole } from "./config.js";
import { currentIxAccessScope } from "./access.js";

export const IX_ACTOR_CONTEXT_KEY = "ixActor";

export type IxActor =
  | {
      kind: "user";
      user: { id: string; email: string; name: string };
      organizationId: string;
      memberId: string;
      role: IxRole;
      via?: { kind: "agent-token"; threadId: string | null };
    }
  | { kind: "loopback-owner"; via?: "owner-token" }
  | { kind: "plugin-token"; pluginId: string }
  | { kind: "plugin-caller"; pluginId: string }
  | { kind: "plugin-public"; pluginId: string }
  | { kind: "off" };

declare module "hono" {
  interface ContextVariableMap {
    [IX_ACTOR_CONTEXT_KEY]: IxActor | undefined;
  }
}

export function setIxActor(context: Context, actor: IxActor): void {
  context.set(IX_ACTOR_CONTEXT_KEY, actor);
}

export function getIxActor(context: Context): IxActor | undefined {
  return context.get(IX_ACTOR_CONTEXT_KEY);
}

export function ixActorRole(actor: IxActor | undefined): IxRole {
  if (actor === undefined || actor.kind !== "user") return "owner";
  return actor.role;
}

export function ixCallerUser(
  actor: IxActor | undefined,
): { id: string; email: string; name: string; role: IxRole; projectIds?: string[]; projectAccess?: Record<string, "read" | "write"> } | undefined {
  if (actor === undefined || actor.kind !== "user") return undefined;
  const scope = currentIxAccessScope();
  return { ...actor.user, role: actor.role, ...(scope === null ? {} : { projectIds: Object.keys(scope.projects), projectAccess: { ...scope.projects } }) };
}

export function withIxUser<T extends { kind: string }>(
  caller: T,
  actor: IxActor | undefined,
): T {
  const user = ixCallerUser(actor);
  if (caller.kind !== "client" || user === undefined) return caller;
  return { ...caller, experimental_user: user };
}

type IxThreadUser = { id: string; email: string; name: string; role: IxRole; projectIds?: string[]; projectAccess?: Record<string, "read" | "write"> };
let threadUserResolver: ((threadId: string) => Promise<IxThreadUser | undefined>) | null = null;

export function setIxThreadUserResolver(resolver: ((threadId: string) => Promise<IxThreadUser | undefined>) | null): void {
  threadUserResolver = resolver;
}

export async function ixThreadUserField(threadId: string): Promise<{ experimental_user?: IxThreadUser }> {
  if (threadUserResolver === null) return {};
  const user = await threadUserResolver(threadId).catch(() => undefined);
  return user === undefined ? {} : { experimental_user: user };
}

export function ixBindPluginCliContext<T extends { threadId?: string; projectId?: string }>(
  actor: IxActor | undefined,
  ctx: T,
  projectOfThread: (threadId: string) => string | null,
): T & { experimental_user?: IxThreadUser } {
  const user = ixCallerUser(actor);
  const bound: T & { experimental_user?: IxThreadUser } = user === undefined ? { ...ctx } : { ...ctx, experimental_user: user };
  if (actor?.kind !== "user" || actor.via === undefined) return bound;
  delete bound.threadId;
  delete bound.projectId;
  const threadId = actor.via.threadId;
  if (threadId === null) return bound;
  const projectId = projectOfThread(threadId);
  return projectId === null ? { ...bound, threadId } : { ...bound, threadId, projectId };
}
