import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "@/components/ui/sidebar.js";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { getRootComposeRoutePath, getSettingsRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import { useRootComposeProjectId, useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { IX_ORGANIZATION_PATH, IX_ROLE_LABEL, listIxMembers, resetIxDesk, roleAtLeast, signOutIx, useIxSession, type IxMember, type IxRole } from "./ix-auth";

type ThreadLike = { id: string; projectId: string; title?: string | null; titleFallback?: string | null; parentThreadId?: string | null; archivedAt?: number | null; updatedAt?: number | null };
type ProjectLike = { id: string; name: string; threads?: ThreadLike[] };

const threadTitle = (t: ThreadLike) => (t.title?.trim() || t.titleFallback?.trim() || "New chat");

function Section({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-1.5 px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground" aria-expanded={open}>
        <span aria-hidden className="inline-block w-2.5">{open ? "▾" : "▸"}</span>
        {title}
      </button>
      {open ? <div className="mt-0.5">{children}</div> : null}
    </div>
  );
}

function Row({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} className={`block w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm ${active ? "bg-accent text-accent-foreground font-medium" : "text-foreground hover:bg-accent/60"}`}>
      {children}
    </button>
  );
}

export function SimpleSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useIxSession();
  const nav = useSidebarNavigation();
  const [composeProjectId] = useRootComposeProjectId();
  const setComposeProjectId = useSetRootComposeProjectId();
  const [query, setQuery] = useState("");
  const [openProjects, setOpenProjects] = useState(true);
  const [openTeam, setOpenTeam] = useState(false);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [members, setMembers] = useState<IxMember[] | null>(null);

  const brand = session.status?.brand ?? {};
  const actor = session.me?.actor;
  const role: IxRole | null = actor?.kind === "user" ? actor.role : null;
  const isAdmin = actor?.kind !== "user" || roleAtLeast(role, "admin");
  const companyName = brand.name ?? session.status?.orgName ?? "Workspace";

  useEffect(() => {
    if (!openTeam || members !== null) return;
    let live = true;
    listIxMembers().then((r) => { if (live) setMembers(r.members); }).catch(() => { if (live) setMembers([]); });
    return () => { live = false; };
  }, [openTeam, members]);

  const projects: ProjectLike[] = useMemo(() => ((nav.data?.projects ?? []) as ProjectLike[]).filter((p) => p.name), [nav.data]);
  const threads: ThreadLike[] = useMemo(() => {
    const d = nav.data as { projects?: ProjectLike[]; personalProject?: ProjectLike } | undefined;
    const all = [...(d?.projects ?? []).flatMap((p) => p.threads ?? []), ...(d?.personalProject?.threads ?? [])];
    return all.filter((t) => !t.parentThreadId && !t.archivedAt).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [nav.data]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((t) => (!projectFilter || t.projectId === projectFilter) && (!q || threadTitle(t).toLowerCase().includes(q)));
  }, [threads, query, projectFilter]);

  const activeThreadId = /\/threads\/([^/?#]+)/.exec(location.pathname)?.[1] ?? null;
  const onOrganization = location.pathname === IX_ORGANIZATION_PATH;
  const newChat = (projectId: string | null) => {
    if (projectId) setComposeProjectId(projectId);
    navigate(getRootComposeRoutePath(), { state: { focusPrompt: true } });
  };

  return (
    <Sidebar data-ix-shell="simple">
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)]">
        <div className="flex items-center gap-2.5 px-1 py-1">
          {brand.iconUrl ? (
            <img src={brand.iconUrl} alt={companyName} draggable={false} className="h-9 w-9 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">{companyName.slice(0, 1)}</div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{companyName}</div>
            <div className="truncate text-xs text-muted-foreground">Company workspace</div>
          </div>
        </div>

        <label className="mt-4 block px-1 text-xs font-semibold text-muted-foreground" htmlFor="ix-shell-search">Search loaded chat titles</label>
        <input id="ix-shell-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search loaded chats" className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />

        <button type="button" onClick={() => newChat(projectFilter ?? composeProjectId ?? null)} className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">New chat</button>

        <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
          <Section title="Projects" open={openProjects} onToggle={() => setOpenProjects(!openProjects)}>
            {projects.length === 0 ? <p className="px-2.5 py-1 text-xs text-muted-foreground">No projects yet.</p> : null}
            {projects.map((p) => (
              <Row key={p.id} active={projectFilter === p.id} onClick={() => { const next = projectFilter === p.id ? null : p.id; setProjectFilter(next); if (next) setComposeProjectId(next); }} title={p.name}>{p.name}</Row>
            ))}
          </Section>

          <Section title="Team" open={openTeam} onToggle={() => setOpenTeam(!openTeam)}>
            {members === null ? <p className="px-2.5 py-1 text-xs text-muted-foreground">Loading…</p> : null}
            {members?.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-2.5 py-1 text-sm">
                <span className="truncate">{m.name || m.email}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">{IX_ROLE_LABEL[m.role]}</span>
              </div>
            ))}
          </Section>

          {isAdmin ? <div className="mt-3"><Row active={onOrganization} onClick={() => navigate(IX_ORGANIZATION_PATH)}>Organization</Row></div> : null}

          <div className="mt-4 px-2 text-xs font-semibold text-muted-foreground">Chats{projectFilter ? ` · ${projects.find((p) => p.id === projectFilter)?.name ?? ""}` : ""}</div>
          <div className="mt-1">
            {nav.isLoading ? <p className="px-2.5 py-1 text-xs text-muted-foreground">Loading…</p> : null}
            {!nav.isLoading && visible.length === 0 ? <p className="px-2.5 py-1 text-xs text-muted-foreground">No chats available yet.</p> : null}
            {visible.map((t) => (
              <Row key={t.id} active={activeThreadId === t.id} onClick={() => navigate(getThreadRoutePath({ projectId: t.projectId, threadId: t.id }))} title={threadTitle(t)}>{threadTitle(t)}</Row>
            ))}
          </div>
        </div>

        <div className="mt-3 border-t border-border px-2 pt-3">
          <div className="truncate text-sm">{actor?.kind === "user" ? (actor.user.name || actor.user.email) : "This server"}</div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{role ? IX_ROLE_LABEL[role] : "Owner"}</span>
            {actor?.kind === "user" ? <button type="button" onClick={() => { void signOutIx().then(() => window.location.assign("/")); }} className="text-xs text-muted-foreground underline-offset-2 hover:underline">Sign out</button> : null}
          </div>
          {actor?.kind === "user" ? (
            <div className="mt-1 flex items-center justify-between">
              <button type="button" onClick={() => navigate(getSettingsRoutePath("appearance"))} className="text-xs text-muted-foreground underline-offset-2 hover:underline">My theme</button>
              <button type="button" onClick={() => { if (window.confirm("Reset your theme and layout to the company default?")) void resetIxDesk().then(() => window.location.reload()); }} className="text-xs text-muted-foreground underline-offset-2 hover:underline">Reset my desk</button>
            </div>
          ) : null}
        </div>
      </div>
    </Sidebar>
  );
}
