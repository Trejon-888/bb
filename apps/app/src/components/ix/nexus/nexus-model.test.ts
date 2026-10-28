import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  NEXUS_DOCS_PATH,
  NEXUS_SCHEDULED_PATH,
  NEXUS_SPACES_PATH,
  filterNexusPaletteItems,
  nexusBreadcrumbs,
  nexusChatIndicator,
  nexusChats,
  nexusFirstName,
  nexusGreeting,
  nexusInitials,
  nexusTimeAgo,
  resolveNexusNavId,
  type NexusPaletteItem,
} from "./nexus-model";

function thread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return makeThreadListEntry({
    title: "Chat",
    lastReadAt: 100,
    latestAttentionAt: 100,
    updatedAt: 1,
    ...overrides,
  });
}

describe("resolveNexusNavId", () => {
  it.each([
    ["/", "home"],
    ["/plugins", "integrations"],
    ["/plugins/github", "integrations"],
    ["/plugins/automations/automations", "scheduled"],
    [NEXUS_SCHEDULED_PATH, "scheduled"],
    ["/skills", "skills"],
    ["/skills/library/abc", "skills"],
    [NEXUS_SPACES_PATH, "spaces"],
    ["/projects/proj_1", "spaces"],
    [NEXUS_DOCS_PATH, "docs"],
    ["/projects/proj_1/threads/thr_1", null],
    ["/plugins/other/panel", null],
    ["/settings/appearance", null],
  ])("maps %s to %s", (pathname, expected) => {
    expect(resolveNexusNavId(pathname)).toBe(expected);
  });
});

describe("nexusGreeting", () => {
  it.each([
    [0, "Working late"],
    [4, "Working late"],
    [5, "Good morning"],
    [11, "Good morning"],
    [12, "Good afternoon"],
    [17, "Good afternoon"],
    [18, "Good evening"],
    [23, "Good evening"],
  ])("hour %i greets %s", (hour, expected) => {
    expect(nexusGreeting(hour)).toBe(expected);
  });
});

describe("nexusFirstName", () => {
  const user = (name: string, email: string) => ({
    kind: "user" as const,
    user: { id: "u", email, name },
    organizationId: "o",
    memberId: "m",
    role: "member" as const,
  });
  it("takes the first word of the display name", () => {
    expect(nexusFirstName(user("  Jordan Lee ", "j@x.test"))).toBe("Jordan");
  });
  it("falls back to the email local part", () => {
    expect(nexusFirstName(user("", "sam@x.test"))).toBe("sam");
  });
  it("has no name for the loopback owner", () => {
    expect(nexusFirstName({ kind: "loopback-owner" })).toBeNull();
    expect(nexusFirstName(undefined)).toBeNull();
  });
});

it("builds initials from names and emails", () => {
  expect(nexusInitials("Jordan Lee")).toBe("JL");
  expect(nexusInitials("sam@x.test")).toBe("SX");
  expect(nexusInitials("Trejon")).toBe("TR");
});

describe("nexusChats", () => {
  it("drops child, archived and deleted chats and puts pinned chats first, newest first", () => {
    const rows = nexusChats([
      thread({ id: "old", updatedAt: 1 }),
      thread({ id: "new", updatedAt: 5 }),
      thread({ id: "pinned", updatedAt: 0, pinnedAt: 3 }),
      thread({ id: "child", parentThreadId: "new" }),
      thread({ id: "archived", archivedAt: 2 }),
      thread({ id: "deleted", deletedAt: 2 }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["pinned", "new", "old"]);
  });
});

describe("nexusChatIndicator", () => {
  it("marks unread finished chats", () => {
    expect(
      nexusChatIndicator(thread({ lastReadAt: 1, latestAttentionAt: 50 })),
    ).toBe("unread");
  });
  it("marks chats waiting for input", () => {
    expect(nexusChatIndicator(thread({ hasPendingInteraction: true }))).toBe(
      "attention",
    );
  });
  it("marks running chats as working", () => {
    expect(
      nexusChatIndicator(
        thread({ status: "active", runtime: { displayStatus: "active" } }),
      ),
    ).toBe("working");
  });
  it("shows nothing for a read idle chat", () => {
    expect(nexusChatIndicator(thread({}))).toBe("none");
  });
});

describe("filterNexusPaletteItems", () => {
  const run = () => {};
  const items: NexusPaletteItem[] = [
    { id: "home", group: "Go to", label: "Home", icon: "Home", run },
    {
      id: "skills",
      group: "Go to",
      label: "Skills",
      icon: "Zap",
      keywords: "teach",
      run,
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `chat-${index}`,
      group: "Chats" as const,
      label: `Quarterly report ${index}`,
      icon: "MessageSquare",
      run,
    })),
    {
      id: "sign-out",
      group: "Actions",
      label: "Sign out",
      icon: "ArrowRight",
      run,
    },
  ];
  it("shows only recent chats when the query is empty", () => {
    const ids = filterNexusPaletteItems(items, "", 3).map((item) => item.id);
    expect(ids).toEqual([
      "home",
      "skills",
      "chat-0",
      "chat-1",
      "chat-2",
      "sign-out",
    ]);
  });
  it("matches every term against label, keywords and group", () => {
    expect(
      filterNexusPaletteItems(items, "teach").map((item) => item.id),
    ).toEqual(["skills"]);
    expect(
      filterNexusPaletteItems(items, "report 7").map((item) => item.id),
    ).toEqual(["chat-7"]);
    expect(filterNexusPaletteItems(items, "chats report").length).toBe(8);
    expect(filterNexusPaletteItems(items, "nothing here")).toEqual([]);
  });
});

describe("nexusBreadcrumbs", () => {
  const base = {
    organizationPath: "/ix/organization",
    pageTitle: null,
    threadTitle: null,
  };
  it("names the nav page", () => {
    expect(nexusBreadcrumbs({ ...base, pathname: "/skills" })).toEqual([
      { label: "Skills" },
    ]);
  });
  it("puts thread titles under Chats", () => {
    expect(
      nexusBreadcrumbs({
        ...base,
        pathname: "/projects/p/threads/t",
        threadTitle: "Launch plan",
      }),
    ).toEqual([{ label: "Chats", to: "/" }, { label: "Launch plan" }]);
  });
  it("nests the settings section under Settings", () => {
    expect(
      nexusBreadcrumbs({
        ...base,
        pathname: "/settings/appearance",
        pageTitle: { title: "Appearance" },
      }),
    ).toEqual([
      { label: "Settings", to: "/settings" },
      { label: "Appearance" },
    ]);
    expect(
      nexusBreadcrumbs({
        ...base,
        pathname: "/settings",
        pageTitle: { title: "Settings" },
      }),
    ).toEqual([{ label: "Settings" }]);
  });
  it("keeps the leaf of a plugin detail page under Integrations", () => {
    expect(
      nexusBreadcrumbs({
        ...base,
        pathname: "/plugins/github",
        pageTitle: {
          breadcrumbs: [
            { label: "Plugins", to: "/plugins" },
            { label: "GitHub" },
          ],
        },
      }),
    ).toEqual([{ label: "Integrations" }, { label: "GitHub" }]);
  });
  it("uses the page's own crumbs off the nav", () => {
    expect(
      nexusBreadcrumbs({
        ...base,
        pathname: "/plugins/x/panel",
        pageTitle: { title: "Panel" },
      }),
    ).toEqual([{ label: "Panel" }]);
    expect(nexusBreadcrumbs({ ...base, pathname: "/ix/organization" })).toEqual(
      [{ label: "Organization" }],
    );
  });
});

it("formats relative times", () => {
  const now = 10_000_000;
  expect(nexusTimeAgo(now - 10_000, now)).toBe("just now");
  expect(nexusTimeAgo(now - 5 * 60_000, now)).toBe("5m ago");
  expect(nexusTimeAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
  expect(nexusTimeAgo(now - 2 * 86_400_000, now)).toBe("2d ago");
});
