import { createMigratedConnection } from "@bb/db/testing";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import {
  assertIxProjectAccess,
  assertIxThreadAccess,
  createIxAccessStore,
  filterIxProjects,
  filterIxSearchGroup,
  filterIxThreads,
  ixScopedThreadIds,
  noteIxThreadCreated,
  restrictedScopeFor,
  runWithIxRequestAccess,
} from "./access.js";
import { withIxUser, type IxActor } from "./context.js";
import { createIxKv } from "./kv.js";
import { assertRestrictedRoute } from "./middleware.js";

const member = (id: string, role: "member" | "viewer" | "admin" = "member"): IxActor => ({ kind: "user", user: { id, email: `${id}@example.test`, name: id }, organizationId: "org", memberId: `m-${id}`, role });
const store = () => { const db = createMigratedConnection(); return createIxAccessStore(db, createIxKv(db)); };
const code = (fn: () => void) => { try { fn(); return "ok"; } catch (error) { return error instanceof ApiError ? `${error.status}` : "throw"; } };

describe("ix project access", () => {
  it("is off until the workspace is restricted, and never applies to admins", () => {
    const s = store();
    expect(restrictedScopeFor(member("u1"), s, "GET")).toBeNull();
    s.setMode("restricted");
    expect(restrictedScopeFor(member("u1"), s, "GET")).not.toBeNull();
    expect(restrictedScopeFor(member("a", "admin"), s, "GET")).toBeNull();
    expect(restrictedScopeFor({ kind: "loopback-owner" }, s, "GET")).toBeNull();
  });

  it("members see granted projects and only their own chats; read-only blocks writes; personal chats stay theirs", async () => {
    const s = store(); s.setMode("restricted");
    s.setGrant("u1", "p-read", "read"); s.setGrant("u1", "p-write", "write");
    s.recordThreadOwner("t-mine", "u1"); s.recordThreadOwner("t-theirs", "u2"); s.recordThreadOwner("t-personal", "u1");
    const read = restrictedScopeFor(member("u1"), s, "GET");
    await runWithIxRequestAccess(member("u1"), s, read, async () => {
      expect(code(() => assertIxProjectAccess("p-read"))).toBe("ok");
      expect(code(() => assertIxProjectAccess("p-hidden"))).toBe("404");
      expect(code(() => assertIxThreadAccess({ id: "t-mine", projectId: "p-write" }))).toBe("ok");
      expect(code(() => assertIxThreadAccess({ id: "t-theirs", projectId: "p-write" }))).toBe("404");
      expect(filterIxProjects([{ id: "p-read" }, { id: "p-hidden" }, { id: PERSONAL_PROJECT_ID }]).map((p) => p.id)).toEqual(["p-read", PERSONAL_PROJECT_ID]);
      expect(filterIxThreads([{ id: "t-mine", projectId: "p-write" }, { id: "t-theirs", projectId: "p-write" }, { id: "t-personal", projectId: PERSONAL_PROJECT_ID }]).map((t) => t.id)).toEqual(["t-mine", "t-personal"]);
      expect([...(ixScopedThreadIds(["t-mine", "t-theirs"]) ?? [])]).toEqual(["t-mine"]);
      expect(filterIxSearchGroup({ total: 9, results: [{ thread: { id: "t-theirs", projectId: "p-write" } }, { thread: { id: "t-mine", projectId: "p-write" } }] }).total).toBe(1);
    });
    const write = restrictedScopeFor(member("u1"), s, "POST");
    await runWithIxRequestAccess(member("u1"), s, write, async () => {
      expect(code(() => assertIxProjectAccess("p-write"))).toBe("ok");
      expect(code(() => assertIxProjectAccess("p-read"))).toBe("403");
      expect(code(() => assertIxThreadAccess({ id: "t-personal", projectId: PERSONAL_PROJECT_ID }))).toBe("ok");
    });
  });

  it("records the creator of a new chat inside the request, and a child chat inherits its parent's owner", async () => {
    const s = store(); s.setMode("restricted"); s.setGrant("u1", "p", "write");
    const scope = restrictedScopeFor(member("u1"), s, "POST");
    await runWithIxRequestAccess(member("u1"), s, scope, async () => {
      noteIxThreadCreated({ id: "t-new", parentThreadId: null });
      expect(code(() => assertIxThreadAccess({ id: "t-new", projectId: "p" }))).toBe("ok");
    });
    expect(s.threadOwner("t-new")).toBe("u1");
    await runWithIxRequestAccess({ kind: "loopback-owner" }, s, null, async () => { noteIxThreadCreated({ id: "t-child", parentThreadId: "t-new" }); });
    expect(s.threadOwner("t-child")).toBe("u1");
  });

  it("does not enforce after the request finished", async () => {
    const s = store(); s.setMode("restricted");
    let later: (() => string) | null = null;
    await runWithIxRequestAccess(member("u1"), s, restrictedScopeFor(member("u1"), s, "GET"), async () => { later = () => code(() => assertIxProjectAccess("p-hidden")); });
    expect(later!()).toBe("ok");
  });

  it("restricted members cannot reach host files, terminals or project settings", () => {
    expect(code(() => assertRestrictedRoute("POST", "/files/read"))).toBe("403");
    expect(code(() => assertRestrictedRoute("GET", "/hosts/h1/directory"))).toBe("403");
    expect(code(() => assertRestrictedRoute("POST", "/terminals"))).toBe("403");
    expect(code(() => assertRestrictedRoute("PATCH", "/projects/p1"))).toBe("403");
    expect(code(() => assertRestrictedRoute("POST", "/projects/p1/sources"))).toBe("403");
    expect(code(() => assertRestrictedRoute("GET", "/projects/p1"))).toBe("ok");
    expect(code(() => assertRestrictedRoute("POST", "/projects/p1/attachments"))).toBe("ok");
    expect(code(() => assertRestrictedRoute("POST", "/threads/t1/send"))).toBe("ok");
  });
});

describe("plugin caller user carries the person's granted projects", () => {
  it("adds projectIds only while the workspace restricts that person", async () => {
    const s = store();
    const ana = member("ana");
    const open = await runWithIxRequestAccess(ana, s, restrictedScopeFor(ana, s, "GET"), async () => withIxUser({ kind: "client" as const }, ana));
    expect(open).toMatchObject({ experimental_user: { id: "ana" } });
    expect((open as { experimental_user?: { projectIds?: string[] } }).experimental_user?.projectIds).toBeUndefined();
    s.setMode("restricted");
    s.setGrant("ana", "proj_a", "read");
    const restricted = await runWithIxRequestAccess(ana, s, restrictedScopeFor(ana, s, "GET"), async () => withIxUser({ kind: "client" as const }, ana));
    expect(restricted).toMatchObject({ experimental_user: { id: "ana", projectIds: ["proj_a"] } });
    const admin = member("ben", "admin");
    const unrestricted = await runWithIxRequestAccess(admin, s, restrictedScopeFor(admin, s, "GET"), async () => withIxUser({ kind: "client" as const }, admin));
    expect((unrestricted as { experimental_user?: { projectIds?: string[] } }).experimental_user?.projectIds).toBeUndefined();
  });
});
