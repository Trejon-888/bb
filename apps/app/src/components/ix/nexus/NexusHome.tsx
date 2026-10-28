import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useProductName } from "@/lib/ix/brand";
import { getRootComposeRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import {
  IX_ORGANIZATION_PATH,
  roleAtLeast,
  useIxSession,
  useIxShell,
} from "../ix-auth";
import {
  NEXUS_STARTERS,
  nexusChatIndicator,
  nexusChatTitle,
  nexusChats,
  nexusFirstName,
  nexusGreeting,
  nexusSetupSteps,
  nexusTimeAgo,
  type NexusSetupStep,
} from "./nexus-model";
import { NexusBrandTile } from "./NexusSidebar";
import { useNexusNavTargets } from "./useNexusNavTargets";

const CHECKLIST_HIDDEN_KEY = "ix.nexus.checklist.hidden";

function readChecklistHidden(): boolean {
  try {
    return window.localStorage.getItem(CHECKLIST_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeChecklistHidden(): void {
  try {
    window.localStorage.setItem(CHECKLIST_HIDDEN_KEY, "1");
  } catch {
    return;
  }
}

export function NexusAvatar({
  iconUrl,
  label,
}: {
  iconUrl: string | undefined;
  label: string;
}) {
  return (
    <span className="relative inline-grid size-14 place-items-center rounded-2xl bg-sidebar shadow-md">
      <NexusBrandTile
        iconUrl={iconUrl}
        label={label}
        className="size-9 rounded-xl"
      />
      <span
        className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-background bg-(--nexus-online)"
        aria-label="Online"
      />
    </span>
  );
}

function useHomeIdentity() {
  const session = useIxSession();
  const productName = useProductName();
  const brand = session.status?.brand ?? {};
  return {
    appTitle: brand.appTitle ?? productName,
    iconUrl: brand.iconUrl,
    firstName: nexusFirstName(session.me?.actor),
  };
}

export function NexusHomeHero() {
  const shell = useIxShell();
  const { appTitle, iconUrl, firstName } = useHomeIdentity();
  if (shell !== "nexus") return null;
  const greeting = nexusGreeting(new Date().getHours());
  return (
    <section
      className="mb-5 flex flex-col items-center gap-2 pt-4 text-center font-sans"
      data-testid="nexus-home-hero"
    >
      <NexusAvatar iconUrl={iconUrl} label={appTitle} />
      <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
        {firstName ? `${greeting}, ${firstName}` : greeting}
      </h1>
      <p className="text-base text-muted-foreground">What should we work on?</p>
    </section>
  );
}

function StarterChips() {
  const navigate = useNavigate();
  return (
    <div
      className="mt-4 flex flex-wrap justify-center gap-2"
      data-testid="nexus-starters"
    >
      {NEXUS_STARTERS.map((starter) => (
        <button
          key={starter.label}
          type="button"
          className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-input hover:bg-accent"
          onClick={() =>
            void navigate(getRootComposeRoutePath(), {
              replace: true,
              state: {
                initialPrompt: starter.prompt,
                replaceInitialPrompt: true,
              },
            })
          }
        >
          {starter.label}
        </button>
      ))}
    </div>
  );
}

function RecentChats() {
  const nav = useSidebarNavigation();
  const [now] = useState(Date.now);
  const recent = useMemo(() => {
    const data = nav.data;
    if (!data) return [];
    return nexusChats([
      ...data.projects.flatMap((project) => project.threads),
      ...data.personalProject.threads,
    ]).slice(0, 4);
  }, [nav.data]);
  if (recent.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Pick up where you left off
      </h2>
      <div className="rounded-2xl border border-border bg-card p-1.5">
        {recent.map((thread) => (
          <Link
            key={thread.id}
            to={getThreadRoutePath({
              projectId: thread.projectId,
              threadId: thread.id,
            })}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground hover:bg-accent"
            data-testid="nexus-recent-chat"
          >
            <Icon
              name="MessageSquare"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate">
              {nexusChatTitle(thread)}
            </span>
            {nexusChatIndicator(thread) === "working" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-primary">
                <Icon name="Spinner" className="size-3 animate-spin" />
                Working
              </span>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">
                {nexusTimeAgo(thread.updatedAt, now)}
              </span>
            )}
            <Icon
              name="ChevronRight"
              className="size-4 shrink-0 text-muted-foreground"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}

export function NexusSetupChecklist({
  steps,
  companyName,
  onHide,
}: {
  steps: readonly NexusSetupStep[];
  companyName: string;
  onHide: () => void;
}) {
  const navigate = useNavigate();
  return (
    <section
      className="mt-8 rounded-2xl border border-border bg-card px-5 pb-2 pt-5"
      data-testid="nexus-checklist"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">
            Get Nexus up to speed
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A few setup steps so Nexus is ready for {companyName}.
          </p>
        </div>
        <button
          type="button"
          onClick={onHide}
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Hide
        </button>
      </div>
      <div className="mt-3">
        {steps.map((step) => (
          <div
            key={step.id}
            className="flex items-center gap-4 border-t border-border py-4 first:border-t-0"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sidebar text-(--nexus-signal)">
              <Icon
                name={
                  step.id === "integrations"
                    ? "Plug02"
                    : step.id === "skills"
                      ? "Zap"
                      : step.id === "scheduled"
                        ? "TimeSchedule"
                        : "UserRound"
                }
                className="size-4"
              />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">{step.title}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {step.body}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void navigate(step.to)}
              className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
            >
              {step.cta}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function NexusHomeSections() {
  const shell = useIxShell();
  const session = useIxSession();
  const targets = useNexusNavTargets();
  const [hidden, setHidden] = useState(readChecklistHidden);
  if (shell !== "nexus") return null;
  const actor = session.me?.actor;
  const isAdmin = actor?.kind !== "user" || roleAtLeast(actor.role, "admin");
  const steps = nexusSetupSteps({
    ...targets,
    organization: IX_ORGANIZATION_PATH,
  }).filter((step) => isAdmin || !step.adminOnly);
  const companyName =
    session.status?.brand.name ?? session.status?.orgName ?? "your workspace";
  return (
    <div className="pb-8 font-sans" data-testid="nexus-home-sections">
      <StarterChips />
      <RecentChats />
      {hidden ? null : (
        <NexusSetupChecklist
          steps={steps}
          companyName={companyName}
          onHide={() => {
            writeChecklistHidden();
            setHidden(true);
          }}
        />
      )}
    </div>
  );
}
