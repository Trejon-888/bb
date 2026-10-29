import { matchPath } from "react-router-dom";
import {
  resolveThreadListIndicator,
  threadListIndicatorStateForThread,
} from "@bb/client-core";
import type { ThreadListEntry } from "@bb/domain";
import type { IxActor } from "../ix-auth";

export const NEXUS_SIDEBAR_WIDTH = "248px";
export const NEXUS_SITES_FALLBACK_PATH = "/ix/sites";
export const NEXUS_DOCS_PATH = "/ix/docs";
export const NEXUS_SCHEDULED_PATH = "/ix/scheduled";

export type NexusNavId =
  | "home"
  | "integrations"
  | "scheduled"
  | "skills"
  | "sites"
  | "docs"
  | "memory"
  | "browser";

export interface NexusNavItem {
  id: NexusNavId;
  label: string;
  icon: string;
  to: string;
}

export interface NexusNavTargets {
  scheduled: { label: string; to: string; icon: string };
  integrations: { label: string; to: string };
  docs: { label: string; to: string; icon: string };
  sites: string;
  memory: string | null;
  browser: string | null;
  /** ix-skills when installed, else bb's own skills page. */
  skills?: string;
}

export const NEXUS_CONNECTORS_PLUGIN_ID = "ix-connectors";
export const NEXUS_CONNECTORS_PATH = "/plugins/ix-connectors/connectors";
export const NEXUS_DEFAULT_INTEGRATIONS = { label: "Integrations", to: "/plugins" };
export const NEXUS_ASSETS_PLUGIN_ID = "ix-assets";
export const NEXUS_WORKFLOWS_PLUGIN_ID = "ix-workflows";
export const NEXUS_WORKFLOWS_PATH = "/plugins/ix-workflows/workflows";
export const NEXUS_WORKFLOWS = { label: "Workflows", to: NEXUS_WORKFLOWS_PATH, icon: "Workflow" };
export const NEXUS_SITES_PLUGIN_ID = "ix-sites";
export const NEXUS_SITES_PATH = "/plugins/ix-sites/sites";
export const NEXUS_ASSETS_PATH = "/plugins/ix-assets/assets";
export const NEXUS_MEMORY_PLUGIN_ID = "ix-memory";
export const NEXUS_MEMORY_PATH = "/plugins/ix-memory/memory";
export const NEXUS_BROWSER_PLUGIN_ID = "ix-browser";
export const NEXUS_BROWSER_PATH = "/plugins/ix-browser/ix-browser";
export const NEXUS_SKILLS_PLUGIN_ID = "ix-skills";
export const NEXUS_SKILLS_PATH = "/plugins/ix-skills/skills";
export const NEXUS_SKILLS_FALLBACK_PATH = "/skills";
export const NEXUS_DEFAULT_DOCS = { label: "Docs", to: NEXUS_DOCS_PATH, icon: "FileText" };

export function nexusNavItems(targets: NexusNavTargets): NexusNavItem[] {
  const items: NexusNavItem[] = [
    { id: "home", label: "Home", icon: "Home", to: "/" },
    {
      id: "integrations",
      label: targets.integrations.label,
      icon: "Plug02",
      to: targets.integrations.to,
    },
    {
      id: "scheduled",
      label: targets.scheduled.label,
      icon: targets.scheduled.icon,
      to: targets.scheduled.to,
    },
    { id: "skills", label: "Skills", icon: "Zap", to: targets.skills ?? NEXUS_SKILLS_FALLBACK_PATH },
    { id: "sites", label: "Sites", icon: "Layers", to: targets.sites },
    { id: "docs", label: targets.docs.label, icon: targets.docs.icon, to: targets.docs.to },
  ];
  if (targets.memory !== null)
    items.push({ id: "memory", label: "Memory", icon: "Brain", to: targets.memory });
  if (targets.browser !== null)
    items.push({ id: "browser", label: "Agent Browser", icon: "Browser", to: targets.browser });
  return items;
}

export function resolveNexusNavId(pathname: string): NexusNavId | null {
  if (pathname === "/") return "home";
  if (pathname === NEXUS_MEMORY_PATH || pathname.startsWith(`${NEXUS_MEMORY_PATH}/`))
    return "memory";
  if (pathname === NEXUS_BROWSER_PATH || pathname.startsWith(`${NEXUS_BROWSER_PATH}/`))
    return "browser";
  if (
    pathname === NEXUS_SITES_FALLBACK_PATH ||
    pathname === NEXUS_SITES_PATH ||
    pathname.startsWith(`${NEXUS_SITES_PATH}/`) ||
    matchPath("/projects/:projectId", pathname) !== null
  )
    return "sites";
  if (
    pathname === NEXUS_DOCS_PATH ||
    pathname === NEXUS_ASSETS_PATH ||
    pathname.startsWith(`${NEXUS_ASSETS_PATH}/`)
  )
    return "docs";
  if (
    pathname === NEXUS_SCHEDULED_PATH ||
    pathname.startsWith("/plugins/automations/") ||
    pathname === NEXUS_WORKFLOWS_PATH ||
    pathname.startsWith(`${NEXUS_WORKFLOWS_PATH}/`)
  )
    return "scheduled";
  if (
    pathname === "/plugins" ||
    matchPath("/plugins/:pluginId", pathname) !== null ||
    pathname === NEXUS_CONNECTORS_PATH ||
    pathname.startsWith(`${NEXUS_CONNECTORS_PATH}/`)
  )
    return "integrations";
  if (
    pathname === "/skills" ||
    pathname.startsWith("/skills/") ||
    pathname === NEXUS_SKILLS_PATH ||
    pathname.startsWith(`${NEXUS_SKILLS_PATH}/`)
  )
    return "skills";
  return null;
}

export function isNexusSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function nexusGreeting(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function nexusFirstName(actor: IxActor | undefined): string | null {
  if (actor?.kind !== "user") return null;
  const name = actor.user.name.trim();
  if (name.length > 0) return name.split(/\s+/)[0] ?? null;
  const local = actor.user.email.split("@")[0]?.trim() ?? "";
  return local.length > 0 ? local : null;
}

export function nexusInitials(label: string): string {
  const parts = label
    .trim()
    .split(/[\s@._-]+/)
    .filter((part) => part.length > 0);
  const letters =
    parts.length > 1
      ? `${parts[0]![0]}${parts[1]![0]}`
      : (parts[0]?.slice(0, 2) ?? "?");
  return letters.toUpperCase();
}

export type NexusChatIndicator = "working" | "attention" | "unread" | "none";

export function nexusChatIndicator(
  thread: ThreadListEntry,
): NexusChatIndicator {
  const kind = resolveThreadListIndicator(
    threadListIndicatorStateForThread(thread, false),
  );
  switch (kind) {
    case "unread-error":
    case "waiting-for-input":
    case "queued-failed":
      return "attention";
    case "working-draft":
    case "workflow":
    case "background-agent":
    case "background-command":
    case "plan-mode":
    case "goal":
    case "runtime":
      return "working";
    case "unread-success":
      return "unread";
    case "queued-waiting":
    case "draft":
    case "none":
      return "none";
  }
}

export function nexusChatTitle(
  thread: Pick<ThreadListEntry, "title" | "titleFallback">,
): string {
  return thread.title?.trim() || thread.titleFallback?.trim() || "New chat";
}

export function nexusChats(
  threads: readonly ThreadListEntry[],
): ThreadListEntry[] {
  return threads
    .filter(
      (thread) =>
        thread.parentThreadId === null &&
        thread.archivedAt === null &&
        thread.deletedAt === null,
    )
    .sort((left, right) => {
      const leftPinned = left.pinnedAt !== null;
      const rightPinned = right.pinnedAt !== null;
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
      return right.updatedAt - left.updatedAt;
    });
}

export interface NexusPaletteItem {
  id: string;
  group: "Go to" | "Chats" | "Actions";
  label: string;
  icon: string;
  keywords?: string;
  shortcut?: string[];
  run: () => void;
}

export function filterNexusPaletteItems(
  items: readonly NexusPaletteItem[],
  query: string,
  recentChatLimit = 6,
): NexusPaletteItem[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    let chats = 0;
    return items.filter(
      (item) => item.group !== "Chats" || chats++ < recentChatLimit,
    );
  }
  const terms = needle.split(/\s+/);
  return items.filter((item) => {
    const haystack =
      `${item.label} ${item.keywords ?? ""} ${item.group}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export interface NexusStarter {
  label: string;
  prompt: string;
}

export const NEXUS_STARTERS: readonly NexusStarter[] = [
  {
    label: "Summarize my week",
    prompt:
      "Summarize what happened across my chats this week and list anything still open.",
  },
  {
    label: "Draft a client email",
    prompt: "Draft a short, friendly client email about ",
  },
  {
    label: "Research a company",
    prompt: "Research this company and give me a one-page brief: ",
  },
  {
    label: "Plan a project",
    prompt: "Help me plan this project step by step: ",
  },
];

export interface NexusSetupStep {
  id: string;
  title: string;
  body: string;
  cta: string;
  to: string;
  adminOnly: boolean;
}

export function nexusSetupSteps(
  targets: NexusNavTargets & { organization: string },
): NexusSetupStep[] {
  return [
    {
      id: "integrations",
      title: "Connect your tools",
      body: "Connect the tools your team already uses so Nexus can work across them.",
      cta: `Open ${targets.integrations.label.toLowerCase()}`,
      to: targets.integrations.to,
      adminOnly: true,
    },
    {
      id: "skills",
      title: "Teach Nexus how you work",
      body: "Add skills that describe how your team handles recurring work.",
      cta: "Open skills",
      to: "/skills",
      adminOnly: false,
    },
    {
      id: "scheduled",
      title: "Put repeat work on a schedule",
      body: "Anything you ask twice can run on its own and report back.",
      cta: `Open ${targets.scheduled.label.toLowerCase()}`,
      to: targets.scheduled.to,
      adminOnly: false,
    },
    {
      id: "team",
      title: "Invite your team",
      body: "Add teammates and choose what each of them can see and do.",
      cta: "Open organization",
      to: targets.organization,
      adminOnly: true,
    },
  ];
}

export interface NexusCrumb {
  label: string;
  to?: string;
}

export type NexusPageTitle = {
  title?: string;
  breadcrumbs?: readonly NexusCrumb[];
} | null;

const NAV_LABELS: Record<NexusNavId, string> = {
  home: "Home",
  integrations: "Integrations",
  scheduled: "Scheduled",
  skills: "Skills",
  sites: "Sites",
  docs: "Docs",
  memory: "Memory",
  browser: "Agent Browser",
};

export function nexusBreadcrumbs(args: {
  pathname: string;
  organizationPath: string;
  pageTitle: NexusPageTitle;
  threadTitle: string | null;
  integrationsLabel?: string;
  docsLabel?: string;
  scheduledLabel?: string;
}): NexusCrumb[] {
  const { pathname, organizationPath, pageTitle, threadTitle } = args;
  if (threadTitle !== null)
    return [{ label: "Chats", to: "/" }, { label: threadTitle }];
  if (pathname === organizationPath) return [{ label: "Organization" }];
  const pageCrumbs: readonly NexusCrumb[] =
    pageTitle?.breadcrumbs ??
    (pageTitle?.title ? [{ label: pageTitle.title }] : []);
  if (isNexusSettingsPath(pathname)) {
    const leaf = pageCrumbs.at(-1);
    return leaf && leaf.label !== "Settings"
      ? [{ label: "Settings", to: "/settings" }, { label: leaf.label }]
      : [{ label: "Settings" }];
  }
  const navId = resolveNexusNavId(pathname);
  if (navId === null)
    return pageCrumbs.length > 0
      ? [...pageCrumbs]
      : [{ label: NAV_LABELS.home, to: "/" }];
  const base =
    navId === "integrations" && args.integrationsLabel
      ? args.integrationsLabel
      : navId === "docs" && args.docsLabel
        ? args.docsLabel
        : navId === "scheduled" && args.scheduledLabel
          ? args.scheduledLabel
          : NAV_LABELS[navId];
  const tail = pageCrumbs.filter(
    (crumb) => crumb.label !== base && crumb.label !== "Plugins",
  );
  return tail.length > 0
    ? [{ label: base }, ...tail.slice(-1)]
    : [{ label: base }];
}

export function nexusTimeAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
