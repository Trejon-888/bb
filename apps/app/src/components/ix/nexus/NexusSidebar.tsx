import { useMemo, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import type { ThreadListEntry } from "@bb/domain";
import { Sidebar, useSidebar } from "@/components/ui/sidebar.js";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useProductName } from "@/lib/ix/brand";
import {
  getRootComposeRoutePath,
  getSettingsRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import type { RouteSidebar } from "@/components/layout/routeSidebar";
import {
  PLUGIN_PAGES,
  SKILL_PAGES,
  resolveToolsActivePage,
} from "@/components/tools/tools-navigation";
import {
  IX_ORGANIZATION_PATH,
  IX_ROLE_LABEL,
  resetIxDesk,
  roleAtLeast,
  signOutIx,
  useIxSession,
} from "../ix-auth";
import {
  NEXUS_DEFAULT_INTEGRATIONS,
  nexusChatIndicator,
  nexusChatTitle,
  nexusChats,
  nexusInitials,
  nexusNavItems,
  resolveNexusNavId,
  type NexusNavItem,
} from "./nexus-model";
import { useNexusNavTargets } from "./useNexusNavTargets";

const ROW_CLASS =
  "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring";
const ACTIVE_ROW_CLASS =
  "bg-sidebar-accent text-sidebar-accent-foreground font-semibold before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-sm before:bg-(--nexus-signal)";
const ICON_BUTTON_CLASS =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

export function NexusBrandTile({
  iconUrl,
  label,
  className,
}: {
  iconUrl: string | undefined;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center overflow-hidden rounded-[9px] bg-(--nexus-tile) text-sm font-bold text-primary ring-1 ring-border/60",
        className,
      )}
    >
      {iconUrl ? (
        <img
          src={iconUrl}
          alt=""
          draggable={false}
          className="size-full object-contain p-1"
        />
      ) : (
        label.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

function NavRow({
  item,
  active,
  onNavigate,
}: {
  item: NexusNavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      className={cn(ROW_CLASS, active && ACTIVE_ROW_CLASS)}
      aria-current={active ? "page" : undefined}
      data-testid={`nexus-nav-${item.id}`}
    >
      <Icon name={item.icon} className="size-4 shrink-0 opacity-85" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SubRows({
  pages,
  activeId,
  onNavigate,
}: {
  pages: readonly { id: string; label: string; to: string }[];
  activeId: string;
  onNavigate: () => void;
}) {
  return (
    <div className="mb-1 ml-6 flex flex-col gap-px border-l border-sidebar-border pl-2">
      {pages.map((page) => (
        <Link
          key={page.id}
          to={page.to}
          onClick={onNavigate}
          className={cn(
            "truncate rounded-md px-2 py-1 text-xs text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            activeId === page.id &&
              "bg-sidebar-accent/70 font-semibold text-sidebar-foreground",
          )}
        >
          {page.label}
        </Link>
      ))}
    </div>
  );
}

function ChatIndicator({ thread }: { thread: ThreadListEntry }) {
  const indicator = nexusChatIndicator(thread);
  if (indicator === "working")
    return (
      <Icon
        name="Spinner"
        className="size-3.5 shrink-0 animate-spin text-(--nexus-signal)"
        aria-label="Working"
      />
    );
  if (indicator === "attention")
    return (
      <span
        className="size-2 shrink-0 rounded-full bg-attention"
        title="Needs attention"
      />
    );
  if (indicator === "unread")
    return (
      <span
        className="size-2 shrink-0 rounded-full bg-(--nexus-signal)"
        title="Unread"
      />
    );
  return null;
}

function ChatRow({
  thread,
  active,
  onNavigate,
}: {
  thread: ThreadListEntry;
  active: boolean;
  onNavigate: () => void;
}) {
  const navigate = useNavigate();
  const actions = useThreadActions();
  const title = nexusChatTitle(thread);
  const open = () => {
    onNavigate();
    void navigate(
      getThreadRoutePath({ projectId: thread.projectId, threadId: thread.id }),
    );
  };
  return (
    <div
      className={cn(
        "group/chat relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent/60",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
      data-testid="nexus-chat-row"
    >
      <button
        type="button"
        onClick={open}
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline"
        title={title}
        aria-current={active ? "page" : undefined}
      >
        <Icon
          name={thread.pinnedAt === null ? "MessageSquare" : "Pin"}
          className="size-3.5 shrink-0 opacity-70"
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      <span className="flex shrink-0 items-center group-focus-within/chat:hidden group-hover/chat:hidden">
        <ChatIndicator thread={thread} />
      </span>
      <span className="hidden shrink-0 items-center gap-0.5 group-focus-within/chat:flex group-hover/chat:flex">
        <button
          type="button"
          className={ICON_BUTTON_CLASS}
          aria-label="Archive chat"
          onClick={() => actions.requestArchive(thread)}
        >
          <Icon name="Archive" className="size-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={ICON_BUTTON_CLASS}
              aria-label="More chat actions"
            >
              <Icon name="MoreHorizontal" className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" className="min-w-40">
            <DropdownMenuItem onSelect={() => actions.requestRename(thread)}>
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.togglePin(thread)}>
              {thread.pinnedAt === null ? "Pin" : "Unpin"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.toggleRead(thread)}>
              Toggle read
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.requestArchive(thread)}>
              Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}

function UserRow({ onNavigate }: { onNavigate: () => void }) {
  const navigate = useNavigate();
  const session = useIxSession();
  const actor = session.me?.actor;
  const isUser = actor?.kind === "user";
  const role = isUser ? actor.role : null;
  const isAdmin = !isUser || roleAtLeast(role, "admin");
  const name = isUser ? actor.user.name || actor.user.email : "This server";
  const go = (to: string) => {
    onNavigate();
    void navigate(to);
  };
  return (
    <div className="mt-1.5 flex items-center gap-1 border-t border-sidebar-border px-1 pt-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left text-sidebar-foreground outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            data-testid="nexus-user-menu"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {nexusInitials(name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {name}
              </span>
              <span className="block truncate text-xs text-sidebar-foreground/65">
                {role ? IX_ROLE_LABEL[role] : "Owner"}
              </span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-64">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-semibold">{name}</span>
            {isUser ? (
              <span className="block truncate text-xs text-muted-foreground">
                {actor.user.email}
              </span>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => go(getSettingsRoutePath("general"))}
          >
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => go(getSettingsRoutePath("appearance"))}
          >
            Appearance
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => go(getSettingsRoutePath("archived"))}
          >
            Archived chats
          </DropdownMenuItem>
          {isAdmin ? (
            <DropdownMenuItem onSelect={() => go(IX_ORGANIZATION_PATH)}>
              Organization
            </DropdownMenuItem>
          ) : null}
          {isUser ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  if (
                    window.confirm(
                      "Reset your theme and layout to the company default?",
                    )
                  )
                    void resetIxDesk().then(() => window.location.reload());
                }}
              >
                Reset my desk
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  void signOutIx().then(() => window.location.assign("/"))
                }
              >
                Sign out
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        className={cn(ICON_BUTTON_CLASS, "size-8")}
        aria-label="Settings"
        onClick={() => go(getSettingsRoutePath("general"))}
      >
        <Icon name="Settings" className="size-4" />
      </button>
    </div>
  );
}

function usesRouteSidebarBody(
  routeSidebar: RouteSidebar | null,
): routeSidebar is RouteSidebar {
  return (
    routeSidebar !== null &&
    (routeSidebar.id === "settings" || routeSidebar.id.startsWith("plugin/"))
  );
}

export function NexusSidebar({
  routeSidebar,
  backToAppRoutePath,
}: {
  routeSidebar: RouteSidebar | null;
  backToAppRoutePath: string | null;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useIxSession();
  const productName = useProductName();
  const nav = useSidebarNavigation();
  const { isCompactViewport, closeMobileSidebar } = useSidebar();
  const targets = useNexusNavTargets();
  const brand = session.status?.brand ?? {};
  const appTitle = brand.appTitle ?? productName;
  const companyName = brand.name ?? session.status?.orgName ?? "Workspace";
  const activeNav = resolveNexusNavId(location.pathname);
  const activePage = resolveToolsActivePage(location.pathname, location.search);
  const activeThreadId =
    /\/threads\/([^/?#]+)/.exec(location.pathname)?.[1] ?? null;
  const onNavigate = () => {
    if (isCompactViewport) closeMobileSidebar();
  };
  const chats = useMemo(() => {
    const data = nav.data;
    if (!data) return [];
    return nexusChats([
      ...data.projects.flatMap((project) => project.threads),
      ...data.personalProject.threads,
    ]);
  }, [nav.data]);
  const newChat = () => {
    onNavigate();
    void navigate(getRootComposeRoutePath(), { state: { focusPrompt: true } });
  };

  let body: ReactNode;
  if (usesRouteSidebarBody(routeSidebar)) {
    body = (
      <div className="-mx-2.5 flex min-h-0 flex-1 flex-col">
        {routeSidebar.render({
          backTo: backToAppRoutePath ?? "/",
          isResizing: false,
          onResizeMouseDown: () => {},
        })}
      </div>
    );
  } else {
    body = (
      <>
        <nav className="flex flex-col gap-px" aria-label="Main">
          {nexusNavItems(targets).map((item) => (
            <div key={item.id}>
              <NavRow
                item={item}
                active={activeNav === item.id}
                onNavigate={onNavigate}
              />
              {activeNav === "integrations" && item.id === "integrations" && targets.integrations.to === NEXUS_DEFAULT_INTEGRATIONS.to ? (
                <SubRows
                  pages={PLUGIN_PAGES}
                  activeId={activePage}
                  onNavigate={onNavigate}
                />
              ) : null}
              {activeNav === "skills" && item.id === "skills" && !targets.skills ? (
                <SubRows
                  pages={SKILL_PAGES}
                  activeId={activePage}
                  onNavigate={onNavigate}
                />
              ) : null}
            </div>
          ))}
        </nav>
        <div className="flex items-center justify-between px-2.5 pb-1.5 pt-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60">
            Chats
          </span>
          <button
            type="button"
            className={ICON_BUTTON_CLASS}
            aria-label="New chat"
            onClick={newChat}
          >
            <Icon name="Plus" className="size-4" />
          </button>
        </div>
        <div
          className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
          data-testid="nexus-chat-list"
        >
          {nav.isLoading ? (
            <p className="px-2.5 py-2 text-xs text-sidebar-foreground/60">
              Loading…
            </p>
          ) : null}
          {!nav.isLoading && chats.length === 0 ? (
            <div className="px-3 py-5 text-center text-xs text-sidebar-foreground/70">
              <span className="mb-0.5 block text-sm font-semibold text-sidebar-foreground">
                No chats yet
              </span>
              Chats with {appTitle} show up here.
            </div>
          ) : null}
          {chats.map((thread) => (
            <ChatRow
              key={thread.id}
              thread={thread}
              active={thread.id === activeThreadId}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <Sidebar data-ix-shell="nexus" className="border-r-0">
      <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-2.5 pt-[max(env(safe-area-inset-top),0.75rem)] font-sans">
        <Link
          to="/"
          onClick={onNavigate}
          className="mb-3 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sidebar-foreground hover:bg-sidebar-accent/60"
          data-testid="nexus-brand"
        >
          <NexusBrandTile iconUrl={brand.iconUrl} label={appTitle} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-bold tracking-tight">
              {appTitle}
            </span>
            <span className="block truncate text-xs font-medium text-sidebar-foreground/70">
              {companyName}
            </span>
          </span>
        </Link>
        {body}
        <UserRow onNavigate={onNavigate} />
      </div>
    </Sidebar>
  );
}
