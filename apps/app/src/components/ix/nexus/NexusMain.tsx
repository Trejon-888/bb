import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useAppCommandHandler,
  useAppCommandRunner,
} from "@/components/commands/AppCommandProvider";
import { usePageTitleValue } from "@/components/layout/page-title";
import { useSidebar } from "@/components/ui/sidebar.js";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  getRootComposeRoutePath,
  getSettingsRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import {
  IX_ORGANIZATION_PATH,
  roleAtLeast,
  signOutIx,
  useIxSession,
} from "../ix-auth";
import { IxOrganizationView } from "../IxOrganizationView";
import {
  NEXUS_DOCS_PATH,
  NEXUS_SCHEDULED_PATH,
  NEXUS_SITES_FALLBACK_PATH,
  nexusBreadcrumbs,
  nexusChatTitle,
  nexusChats,
  nexusNavItems,
  type NexusPaletteItem,
} from "./nexus-model";
import { NexusPalette } from "./NexusPalette";
import {
  NexusDocsPage,
  NexusScheduledPage,
  NexusSitesPage,
} from "./NexusPages";
import { useNexusNavTargets } from "./useNexusNavTargets";
import { useNexusRootAttribute } from "./nexus-root";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest(
      'textarea, input, select, [contenteditable=""], [contenteditable="true"]',
    ) !== null
  );
}

function modifierLabel(): string {
  return typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl";
}

export function nexusPageFor(pathname: string): ReactNode | null {
  if (pathname === IX_ORGANIZATION_PATH) return <IxOrganizationView />;
  if (pathname === NEXUS_SITES_FALLBACK_PATH) return <NexusSitesPage />;
  if (pathname === NEXUS_DOCS_PATH) return <NexusDocsPage />;
  if (pathname === NEXUS_SCHEDULED_PATH) return <NexusScheduledPage />;
  return null;
}

function usePaletteItems(
  newChat: () => void,
  toggleSidebar: () => void,
): NexusPaletteItem[] {
  const navigate = useNavigate();
  const runner = useAppCommandRunner();
  const nav = useSidebarNavigation();
  const targets = useNexusNavTargets();
  const session = useIxSession();
  const actor = session.me?.actor;
  const isUser = actor?.kind === "user";
  const isAdmin = !isUser || roleAtLeast(actor.role, "admin");
  const mod = modifierLabel();
  return useMemo(() => {
    const go = (to: string) => () => void navigate(to);
    const threads = nav.data
      ? nexusChats([
          ...nav.data.projects.flatMap((project) => project.threads),
          ...nav.data.personalProject.threads,
        ])
      : [];
    const items: NexusPaletteItem[] = [
      {
        id: "new-chat",
        group: "Go to",
        label: "New chat",
        icon: "Plus",
        run: newChat,
        shortcut: [mod, "↵"],
      },
      ...nexusNavItems(targets).map((item) => ({
        id: `nav-${item.id}`,
        group: "Go to" as const,
        label: item.label,
        icon: item.icon,
        run: go(item.to),
      })),
      {
        id: "settings",
        group: "Go to",
        label: "Settings",
        icon: "Settings",
        run: go(getSettingsRoutePath("general")),
      },
      ...(isAdmin
        ? [
            {
              id: "organization",
              group: "Go to" as const,
              label: "Organization",
              icon: "UserRound",
              keywords: "team members invite roles",
              run: go(IX_ORGANIZATION_PATH),
            },
          ]
        : []),
      ...threads.slice(0, 50).map((thread) => ({
        id: `chat-${thread.id}`,
        group: "Chats" as const,
        label: nexusChatTitle(thread),
        icon: "MessageSquare",
        run: go(
          getThreadRoutePath({
            projectId: thread.projectId,
            threadId: thread.id,
          }),
        ),
      })),
      {
        id: "toggle-sidebar",
        group: "Actions",
        label: "Toggle sidebar",
        icon: "PanelLeft",
        run: toggleSidebar,
        shortcut: [mod, "B"],
      },
      {
        id: "all-commands",
        group: "Actions",
        label: "All commands",
        icon: "Search",
        keywords: "palette commands",
        run: () => void runner.dispatch("palette.open", null),
      },
      {
        id: "appearance",
        group: "Actions",
        label: "Change theme",
        icon: "Palette",
        keywords: "dark light appearance",
        run: go(getSettingsRoutePath("appearance")),
      },
      ...(isUser
        ? [
            {
              id: "sign-out",
              group: "Actions" as const,
              label: "Sign out",
              icon: "ArrowRight",
              run: () =>
                void signOutIx().then(() => window.location.assign("/")),
            },
          ]
        : []),
    ];
    return items;
  }, [
    isAdmin,
    isUser,
    mod,
    nav.data,
    navigate,
    newChat,
    runner,
    targets,
    toggleSidebar,
  ]);
}

export function NexusMain({
  children,
  threadTitle,
}: {
  children: ReactNode;
  threadTitle: string | null;
}) {
  useNexusRootAttribute();
  const location = useLocation();
  const navigate = useNavigate();
  const { toggleSidebar, isCompactViewport } = useSidebar();
  const pageTitle = usePageTitleValue();
  const targets = useNexusNavTargets();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const mod = modifierLabel();

  const newChat = useCallback(() => {
    void navigate(getRootComposeRoutePath(), { state: { focusPrompt: true } });
  }, [navigate]);
  const items = usePaletteItems(newChat, toggleSidebar);

  useAppCommandHandler(
    "thread.search",
    () => {
      setPaletteOpen((open) => !open);
      return true;
    },
    200,
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) return;
      if (event.key.toLowerCase() === "b" && !event.shiftKey) {
        event.preventDefault();
        toggleSidebar();
      } else if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newChat, toggleSidebar]);

  const crumbs = nexusBreadcrumbs({
    pathname: location.pathname,
    organizationPath: IX_ORGANIZATION_PATH,
    pageTitle,
    threadTitle,
    integrationsLabel: targets.integrations.label,
    docsLabel: targets.docs.label,
    scheduledLabel: targets.scheduled.label,
  });
  const page = nexusPageFor(location.pathname);

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-sidebar font-sans md:py-2"
      data-testid="nexus-main"
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-hidden bg-background",
          !isCompactViewport && "rounded-l-2xl shadow-sm ring-1 ring-border/40",
        )}
      >
        <header
          className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card pl-3 pr-4 md:pl-4 md:pr-5"
          data-testid="nexus-topbar"
        >
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={`Toggle sidebar (${mod} B)`}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Icon name="PanelLeft" className="size-4" />
          </button>
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold"
          >
            {crumbs.map((crumb, index) => (
              <span
                key={`${index}-${crumb.label}`}
                className="flex min-w-0 items-center gap-1.5"
              >
                {index > 0 ? (
                  <span className="text-muted-foreground/70">/</span>
                ) : null}
                {crumb.to && index < crumbs.length - 1 ? (
                  <Link
                    to={crumb.to}
                    className="shrink-0 font-medium text-muted-foreground hover:text-foreground"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="truncate">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-9 min-w-56 items-center gap-2 rounded-full border border-border bg-background pl-3 pr-2 text-xs text-muted-foreground transition-colors hover:border-input sm:flex"
            data-testid="nexus-search"
          >
            <Icon name="Search" className="size-3.5" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <span className="flex gap-1">
              <kbd className="rounded border border-border px-1 font-sans text-xs">
                {mod}
              </kbd>
              <kbd className="rounded border border-border px-1 font-sans text-xs">
                K
              </kbd>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent sm:hidden"
          >
            <Icon name="Search" className="size-4" />
          </button>
          <button
            type="button"
            onClick={newChat}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            data-testid="nexus-new-chat"
          >
            <Icon name="Plus" className="size-4" />
            <span className="hidden sm:inline">New chat</span>
          </button>
        </header>
        <main
          className={cn(
            "relative flex min-h-0 flex-1 flex-col p-4 md:p-5",
            location.pathname === "/" && "contain-layout",
          )}
          data-testid="nexus-content"
        >
          {page === null ? (
            children
          ) : (
            <div className="-m-4 min-h-0 flex-1 overflow-y-auto p-4 md:-m-5 md:p-5">
              {page}
            </div>
          )}
        </main>
      </div>
      <NexusPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={items}
      />
    </div>
  );
}
