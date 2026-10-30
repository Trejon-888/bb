import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { NEXUS_PROVIDERS_PATH, NEXUS_CAPACITY_PATH,
  NEXUS_DOCS_PATH,
  NEXUS_SCHEDULED_PATH,
  NEXUS_WORKFLOWS,
  NEXUS_WORKFLOWS_PATH,
  NEXUS_SITES_FALLBACK_PATH,
  NEXUS_MEMORY_PATH,
  NEXUS_SKILLS_PATH,
  NEXUS_BROWSER_PATH,
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
  nexusNavItems,
  nexusAgentName,
  nexusSetupSteps,
  NEXUS_CONNECTORS_PATH,
  NEXUS_DEFAULT_INTEGRATIONS,
  NEXUS_ASSETS_PATH,
  NEXUS_DEFAULT_DOCS,
  NEXUS_SITES_PATH,
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
    [NEXUS_SITES_FALLBACK_PATH, "sites"],
    ["/projects/proj_1", "sites"],
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

describe("connectors nav item", () => {
  const connectors = { scheduled: { label: "Scheduled", to: "/s", icon: "TimeSchedule" }, integrations: { label: "Connectors", to: NEXUS_CONNECTORS_PATH }, docs: NEXUS_DEFAULT_DOCS, sites: NEXUS_SITES_FALLBACK_PATH, memory: null, browser: null };
  it("labels and routes the integrations item from its target", () => {
    const item = nexusNavItems(connectors).find((entry) => entry.id === "integrations");
    expect(item).toMatchObject({ label: "Connectors", to: NEXUS_CONNECTORS_PATH });
    expect(nexusNavItems({ scheduled: { label: "Scheduled", to: "/s", icon: "TimeSchedule" }, integrations: NEXUS_DEFAULT_INTEGRATIONS, docs: NEXUS_DEFAULT_DOCS, sites: NEXUS_SITES_FALLBACK_PATH, memory: null, browser: null }).find((entry) => entry.id === "integrations")).toMatchObject({ label: "Integrations", to: "/plugins" });
  });
  it("highlights it on connectors pages and names the breadcrumb after it", () => {
    expect(resolveNexusNavId(`${NEXUS_CONNECTORS_PATH}/notion`)).toBe("integrations");
    expect(nexusBreadcrumbs({ pathname: NEXUS_CONNECTORS_PATH, organizationPath: "/ix/organization", pageTitle: null, threadTitle: null, integrationsLabel: "Connectors" })[0]?.label).toBe("Connectors");
  });
  it("points the setup step at connectors", () => {
    const step = nexusSetupSteps({ ...connectors, organization: "/ix/organization" }).find((entry) => entry.id === "integrations");
    expect(step).toMatchObject({ cta: "Open connectors", to: NEXUS_CONNECTORS_PATH });
  });
});

describe("assets nav item", () => {
  const targets = { scheduled: { label: "Scheduled", to: "/s", icon: "TimeSchedule" }, integrations: NEXUS_DEFAULT_INTEGRATIONS, docs: { label: "Assets", to: NEXUS_ASSETS_PATH, icon: "Folder02" }, sites: NEXUS_SITES_FALLBACK_PATH, memory: null, browser: null };
  it("replaces Docs with the ix-assets page", () => {
    expect(nexusNavItems(targets).find((entry) => entry.id === "docs")).toMatchObject({ label: "Assets", to: NEXUS_ASSETS_PATH, icon: "Folder02" });
    expect(resolveNexusNavId(`${NEXUS_ASSETS_PATH}/item-1`)).toBe("docs");
    expect(nexusBreadcrumbs({ pathname: NEXUS_ASSETS_PATH, organizationPath: "/ix/organization", pageTitle: null, threadTitle: null, docsLabel: "Assets" })[0]?.label).toBe("Assets");
  });
});

describe("sites nav item", () => {
  it("opens the ix-sites Sites page when that plugin is installed", () => {
    const targets = { scheduled: { label: "Scheduled", to: "/s", icon: "TimeSchedule" }, integrations: NEXUS_DEFAULT_INTEGRATIONS, docs: NEXUS_DEFAULT_DOCS, sites: NEXUS_SITES_PATH, memory: null, browser: null };
    expect(nexusNavItems(targets).find((entry) => entry.id === "sites")).toMatchObject({ label: "Sites", to: NEXUS_SITES_PATH });
    expect(resolveNexusNavId(`${NEXUS_SITES_PATH}/test`)).toBe("sites");
  });
});

describe("memory and agent browser nav items", () => {
  const base = { scheduled: { label: "Scheduled", to: "/s", icon: "TimeSchedule" }, integrations: NEXUS_DEFAULT_INTEGRATIONS, docs: NEXUS_DEFAULT_DOCS, sites: NEXUS_SITES_FALLBACK_PATH, memory: null, browser: null };
  it("adds Providers and Capacity when ix-providers and ix-capacity are installed", () => {
    const items = nexusNavItems({ ...base, providers: NEXUS_PROVIDERS_PATH, capacity: NEXUS_CAPACITY_PATH });
    expect(items.find((entry) => entry.id === "providers")).toMatchObject({ label: "Providers", to: NEXUS_PROVIDERS_PATH });
    expect(items.find((entry) => entry.id === "capacity")).toMatchObject({ label: "Capacity", to: NEXUS_CAPACITY_PATH });
    expect(nexusNavItems(base).map((entry) => entry.id)).not.toContain("providers");
    expect(resolveNexusNavId(`${NEXUS_PROVIDERS_PATH}/x`)).toBe("providers");
  });
  it("are hidden until their plugins are installed", () => {
    const ids = nexusNavItems({ ...base, memory: null, browser: null }).map((entry) => entry.id);
    expect(ids).not.toContain("memory");
    expect(ids).not.toContain("browser");
  });
  it("opens ix-skills when installed, else bb's skills page", () => {
    expect(nexusNavItems(base).find((entry) => entry.id === "skills")).toMatchObject({ label: "Skills", to: "/skills" });
    expect(nexusNavItems({ ...base, skills: NEXUS_SKILLS_PATH }).find((entry) => entry.id === "skills")).toMatchObject({ label: "Skills", to: NEXUS_SKILLS_PATH });
    expect(resolveNexusNavId(NEXUS_SKILLS_PATH)).toBe("skills");
    expect(resolveNexusNavId(`${NEXUS_SKILLS_PATH}/abc`)).toBe("skills");
  });

  it("open the ix-memory and ix-browser panels when installed", () => {
    const items = nexusNavItems({ ...base, memory: NEXUS_MEMORY_PATH, browser: NEXUS_BROWSER_PATH });
    expect(items.find((entry) => entry.id === "memory")).toMatchObject({ label: "Memory", to: NEXUS_MEMORY_PATH });
    expect(items.find((entry) => entry.id === "browser")).toMatchObject({ label: "Agent Browser", to: NEXUS_BROWSER_PATH });
    expect(resolveNexusNavId(NEXUS_MEMORY_PATH)).toBe("memory");
    expect(resolveNexusNavId(NEXUS_BROWSER_PATH)).toBe("browser");
  });
});

describe("workflows nav item", () => {
  it("replaces Scheduled with Workflows when ix-workflows is installed", () => {
    const targets = { scheduled: NEXUS_WORKFLOWS, integrations: NEXUS_DEFAULT_INTEGRATIONS, docs: NEXUS_DEFAULT_DOCS, sites: NEXUS_SITES_FALLBACK_PATH, memory: null, browser: null };
    expect(nexusNavItems(targets).find((entry) => entry.id === "scheduled")).toMatchObject({ label: "Workflows", to: NEXUS_WORKFLOWS_PATH, icon: "Workflow" });
    expect(resolveNexusNavId(NEXUS_WORKFLOWS_PATH)).toBe("scheduled");
  });
});

describe("nexusAgentName", () => {
  it("uses the brand's app title and falls back to Nexus", () => {
    expect(nexusAgentName({ appTitle: "ix" })).toBe("ix");
    expect(nexusAgentName({ appTitle: "Nexus" })).toBe("Nexus");
    expect(nexusAgentName({ appTitle: "  " })).toBe("Nexus");
    expect(nexusAgentName({})).toBe("Nexus");
    expect(nexusAgentName(undefined)).toBe("Nexus");
  });

  it("puts the agent name into the setup steps", () => {
    const targets = { integrations: { label: "Connectors", to: "/c" }, scheduled: { label: "Workflows", to: "/w" } } as never;
    const steps = nexusSetupSteps({ ...(targets as object), organization: "/o" } as never, "ix");
    expect(steps.find((step) => step.id === "skills")?.title).toBe("Teach ix how you work");
    expect(steps.find((step) => step.id === "integrations")?.body).toContain("so ix can work");
    expect(nexusSetupSteps({ ...(targets as object), organization: "/o" } as never).find((step) => step.id === "skills")?.title).toBe("Teach Nexus how you work");
  });
});
