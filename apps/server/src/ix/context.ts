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
    }
  | { kind: "loopback-owner" }
  | { kind: "plugin-token"; pluginId: string }
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
