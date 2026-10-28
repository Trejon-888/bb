import { useMemo, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import {
  getRootComposeRoutePath,
  getSettingsProjectRoutePath,
} from "@/lib/route-paths";
import { nexusChats } from "./nexus-model";

export function NexusPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[900px] px-2 py-6 font-sans">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function PlaceholderCard({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-xl bg-sidebar text-sidebar-foreground">
        <Icon name={icon} className="size-5" />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

export function NexusDocsPage() {
  return (
    <NexusPage
      title="Docs"
      subtitle="Documents your team and Nexus write together."
    >
      <PlaceholderCard
        icon="FileText"
        title="Docs are coming soon"
        body="Until then, ask in a chat and Nexus will write the document there."
        action={
          <Link
            to="/"
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Start a chat
          </Link>
        }
      />
    </NexusPage>
  );
}

export function NexusScheduledPage() {
  return (
    <NexusPage
      title="Scheduled"
      subtitle="Work that runs on its own, on a schedule."
    >
      <PlaceholderCard
        icon="TimeSchedule"
        title="Scheduling is not enabled on this workspace"
        body="An admin can turn it on by enabling the Automations plugin under Integrations."
        action={
          <Link
            to="/plugins"
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Open integrations
          </Link>
        }
      />
    </NexusPage>
  );
}

export function NexusSpacesPage() {
  const nav = useSidebarNavigation();
  const navigate = useNavigate();
  const setComposeProjectId = useSetRootComposeProjectId();
  const projects = useMemo(
    () =>
      (nav.data?.projects ?? []).filter(
        (project) => project.name.trim().length > 0,
      ),
    [nav.data],
  );
  return (
    <NexusPage
      title="Spaces"
      subtitle="Each space keeps its own files, chats and settings."
    >
      {nav.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {!nav.isLoading && projects.length === 0 ? (
        <PlaceholderCard
          icon="Layers"
          title="No spaces yet"
          body="Spaces appear here once a project is added to this workspace."
        />
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {projects.map((project) => {
          const chats = nexusChats(project.threads).length;
          return (
            <div
              key={project.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
              data-testid="nexus-space"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-sidebar text-sidebar-foreground">
                  <Icon name="Layers" className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {project.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {chats === 1 ? "1 chat" : `${chats} chats`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                  onClick={() => {
                    setComposeProjectId(project.id);
                    void navigate(getRootComposeRoutePath(), {
                      state: { focusPrompt: true },
                    });
                  }}
                >
                  New chat here
                </button>
                <Link
                  to={getSettingsProjectRoutePath(project.id)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
                >
                  Settings
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </NexusPage>
  );
}
