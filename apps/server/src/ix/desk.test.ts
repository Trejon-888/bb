import { createMigratedConnection } from "@bb/db/testing";
import { getUiPreferenceDefault, UI_PREFERENCE_KEYS, type UiPreferenceEntries } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import { createIxAccessStore, runWithIxRequestAccess } from "./access.js";
import type { IxActor } from "./context.js";
import { createIxDeskStore, ixDeskAppearance, overlayIxDeskPreferences, resetIxDeskPreference, setIxDeskAppearance, writeIxDeskPreference } from "./desk.js";
import { createIxKv } from "./kv.js";

const person = (id: string, role: "member" | "admin" = "member"): IxActor => ({ kind: "user", user: { id, email: `${id}@example.test`, name: id }, organizationId: "org", memberId: `m-${id}`, role });
const setup = () => {
  const db = createMigratedConnection();
  const kv = createIxKv(db);
  return { access: createIxAccessStore(db, kv), desk: createIxDeskStore(db, kv) };
};
const base = (): UiPreferenceEntries => Object.fromEntries(UI_PREFERENCE_KEYS.map((key) => [key, { revision: 7, value: getUiPreferenceDefault(key) }])) as UiPreferenceEntries;
const key = UI_PREFERENCE_KEYS[0]!;
const as = <T>(actor: IxActor, s: ReturnType<typeof setup>, fn: () => T) => runWithIxRequestAccess(actor, s.access, null, async () => fn());
const status = (fn: () => unknown) => { try { fn(); return "ok"; } catch (error) { return error instanceof ApiError ? error.status : "throw"; } };

describe("ix personal desk", () => {
  it("keeps each person's layout to themselves on top of the workspace default", async () => {
    const s = setup();
    const value = base()[key].value;
    const written = await as(person("u1"), s, () => writeIxDeskPreference(s.desk, { key, value, expectedRevision: 0 }));
    expect(written).toMatchObject({ outcome: "updated", entry: { revision: 1 } });
    expect((await as(person("u1"), s, () => overlayIxDeskPreferences(s.desk, base())))[key].revision).toBe(1);
    expect((await as(person("u2"), s, () => overlayIxDeskPreferences(s.desk, base())))[key].revision).toBe(0);
    expect(overlayIxDeskPreferences(s.desk, base())[key].revision).toBe(7);
    expect(await as(person("u1"), s, () => writeIxDeskPreference(s.desk, { key, value, expectedRevision: 0 }))).toEqual({ outcome: "conflict", revision: 1 });
    await as(person("u1"), s, () => resetIxDeskPreference(s.desk, key, () => base()[key]));
    expect(s.desk.personalized("u1").layout).toBe(0);
  });

  it("writes outside a signed-in request go to the workspace", () => {
    const s = setup();
    expect(writeIxDeskPreference(s.desk, { key, value: base()[key].value, expectedRevision: 0 })).toBeNull();
    expect(setIxDeskAppearance(s.desk, { themeId: "dark", faviconColor: "blue" })).toBe(false);
  });

  it("a locked layout or theme blocks staff and sends admins to the workspace default", async () => {
    const s = setup();
    s.desk.setPolicy({ theme: false, layout: false });
    expect(await as(person("u1"), s, () => status(() => writeIxDeskPreference(s.desk, { key, value: base()[key].value, expectedRevision: 0 })))).toBe(403);
    expect(await as(person("u1"), s, () => status(() => setIxDeskAppearance(s.desk, { themeId: "dark", faviconColor: "blue" })))).toBe(403);
    expect(await as(person("a", "admin"), s, () => writeIxDeskPreference(s.desk, { key, value: base()[key].value, expectedRevision: 0 }))).toBeNull();
  });

  it("personal themes apply only to their owner and disappear when the theme is locked", async () => {
    const s = setup();
    await as(person("u1"), s, () => setIxDeskAppearance(s.desk, { themeId: "dark", faviconColor: "blue" }));
    expect(await as(person("u1"), s, () => ixDeskAppearance(s.desk))).toEqual({ themeId: "dark", faviconColor: "blue" });
    expect(await as(person("u2"), s, () => ixDeskAppearance(s.desk))).toBeNull();
    s.desk.setPolicy({ theme: false, layout: true });
    expect(await as(person("u1"), s, () => ixDeskAppearance(s.desk))).toBeNull();
    s.desk.clear("u1");
    expect(s.desk.personalized("u1")).toEqual({ theme: false, layout: 0 });
  });
});
