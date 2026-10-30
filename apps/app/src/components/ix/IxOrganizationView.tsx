import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import {
  IX_ROLE_LABEL,
  IxHttpError,
  cancelIxInvitation,
  getIxAccess,
  getIxDesk,
  getIxSharingPolicy,
  ixShareAllowed,
  setIxDeskPolicy,
  setIxSharingPolicy,
  type IxShareChoice,
  type IxSharingPolicy,
  type IxThreadShareLevel,
  type IxWhoCanChange,
  type IxDeskPolicy,
  setIxAccessMode,
  setIxProjectAccess,
  type IxAccessOverview,
  type IxProjectAccessLevel,
  inviteIxMember,
  listIxInvitations,
  listIxMembers,
  removeIxMember,
  roleAtLeast,
  setIxMemberRole,
  useIxSession,
  type IxInvitation,
  type IxMember,
  type IxRole,
} from "./ix-auth";

const ROLES: IxRole[] = ["owner", "admin", "member", "viewer"];
const SHARE_CHOICES: Array<{ choice: IxShareChoice; label: string; hint: string }> = [
  { choice: "private", label: "Private", hint: "Only the person who started it" },
  { choice: "project", label: "Project", hint: "Everyone on the chat's project" },
  { choice: "workspace", label: "Workspace", hint: "Everyone in the workspace" },
  { choice: "people", label: "Specific people", hint: "Add named teammates to a chat" },
];
const SHARE_LEVELS: IxThreadShareLevel[] = ["private", "project", "workspace"];
const WHO_CAN_CHANGE: Array<{ value: IxWhoCanChange; label: string }> = [
  { value: "starter", label: "Only the person who started the chat" },
  { value: "starter_and_admins", label: "The person who started it, plus owners and admins" },
  { value: "participants", label: "Anyone who can see the chat" },
];
const errorText = (error: unknown) => (error instanceof IxHttpError ? error.message : error instanceof Error ? error.message : "Something went wrong");

export function IxOrganizationView() {
  const navigate = useNavigate();
  const session = useIxSession();
  const actor = session.me?.actor;
  const myRole: IxRole | null = actor?.kind === "user" ? actor.role : null;
  const isOwner = actor?.kind !== "user" || myRole === "owner";
  const isAdmin = actor?.kind !== "user" || roleAtLeast(myRole, "admin");
  const companyName = session.status?.brand.name ?? session.status?.orgName ?? "your organization";
  const [members, setMembers] = useState<IxMember[] | null>(null);
  const [invitations, setInvitations] = useState<IxInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<IxRole>("member");
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [access, setAccess] = useState<IxAccessOverview | null>(null);
  const [openAccess, setOpenAccess] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, IxProjectAccessLevel | "none">>({});
  const [desk, setDesk] = useState<IxDeskPolicy | null>(null);
  const [sharing, setSharing] = useState<IxSharingPolicy | null>(null);

  const reload = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([listIxMembers(), isAdmin ? listIxInvitations() : Promise.resolve({ invitations: [] })]);
      setMembers(m.members);
      setInvitations(i.invitations.filter((x) => x.status === "pending"));
      if (isAdmin) { setAccess(await getIxAccess()); setDesk((await getIxDesk()).policy); setSharing((await getIxSharingPolicy()).policy); }
    } catch (e) {
      setError(errorText(e));
    }
  }, [isAdmin]);
  useEffect(() => { void reload(); }, [reload]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); setNotice(done); await reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    void run(async () => { const r = await inviteIxMember({ email: address, role }); setLastLink(r.acceptUrl); setEmail(""); }, `Invitation created for ${address}.`);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-2 py-6">
      <button type="button" onClick={() => navigate(getRootComposeRoutePath())} className="text-sm text-primary hover:underline">← Back to chats</button>
      <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-primary">Your organization</p>
      <h1 className="mt-1 font-serif text-3xl">People and access</h1>
      <p className="mt-1 text-sm text-muted-foreground">Everyone who can sign in to {companyName}, and what they can do.</p>

      {error ? <p role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
      {notice ? <p className="mt-4 rounded-lg border border-border bg-accent px-3 py-2 text-sm">{notice}</p> : null}

      <div className="mt-6 divide-y divide-border border-y border-border">
        {members === null ? <p className="py-3 text-sm text-muted-foreground">Loading…</p> : null}
        {members?.map((m) => {
          const self = actor?.kind === "user" && actor.memberId === m.id;
          const canEdit = isAdmin && !self && (isOwner || m.role !== "owner");
          return (
            <div key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.name || m.email}{self ? <span className="ml-2 text-xs text-muted-foreground">you</span> : null}</div>
                <div className="truncate text-xs text-muted-foreground">{m.email}</div>
              </div>
              {canEdit ? (
                <select aria-label={`Role for ${m.email}`} value={m.role} disabled={busy} onChange={(e) => void run(() => setIxMemberRole(m.id, e.target.value as IxRole), `${m.email} is now ${IX_ROLE_LABEL[e.target.value as IxRole]}.`)} className="rounded-md border border-input bg-background px-2 py-1 text-sm">
                  {ROLES.filter((r) => isOwner || r !== "owner").map((r) => <option key={r} value={r}>{IX_ROLE_LABEL[r]}</option>)}
                </select>
              ) : <span className="text-sm text-muted-foreground">{IX_ROLE_LABEL[m.role]}</span>}
              {canEdit ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { if (window.confirm(`Remove ${m.email} from ${companyName}?`)) void run(() => removeIxMember(m.id), `${m.email} removed.`); }}>Remove</Button> : null}
              {isAdmin && access && (m.role === "member" || m.role === "viewer") ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => { const row = access.members.find((x) => x.memberId === m.id); setDraft(Object.fromEntries(access.projects.map((p) => [p.id, row?.projects[p.id] ?? "none"]))); setOpenAccess(openAccess === m.id ? null : m.id); }}>View access</Button>
              ) : null}
              {openAccess === m.id && access ? (
                <div className="mt-2 w-full rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-semibold">Project access for {m.name || m.email}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Choose which projects this member can use. Their chats remain private.{access.mode === "open" ? " Access limits apply once you turn on project access below." : ""}</p>
                  <div className="mt-3 divide-y divide-border border-t border-border">
                    {access.projects.length === 0 ? <p className="py-2 text-sm text-muted-foreground">No projects yet.</p> : null}
                    {access.projects.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                        <select aria-label={`Access to ${p.name}`} value={draft[p.id] ?? "none"} onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value as IxProjectAccessLevel | "none" })} className="rounded-md border border-input bg-background px-2 py-1 text-sm">
                          <option value="none">No access</option>
                          <option value="read">Read only</option>
                          <option value="write">Full access</option>
                        </select>
                        <Button type="button" size="sm" variant="outline" disabled={busy || (draft[p.id] ?? "none") === ((access.members.find((x) => x.memberId === m.id)?.projects[p.id]) ?? "none")} onClick={() => { const level = draft[p.id] ?? "none"; void run(() => setIxProjectAccess(m.id, p.id, level === "none" ? null : level), "Project access saved."); }}>Save</Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {isAdmin && access ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Project access</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{access.mode === "restricted" ? "On: staff see only the projects you grant them, and only their own chats. Owners and admins see everything." : "Off: everyone can see every project and chat."}</p>
          </div>
          <Button type="button" variant={access.mode === "restricted" ? "outline" : "default"} disabled={busy} onClick={() => void run(() => setIxAccessMode(access.mode === "restricted" ? "open" : "restricted"), access.mode === "restricted" ? "Project access is off." : "Project access is on.")}>{access.mode === "restricted" ? "Turn off" : "Turn on"}</Button>
        </div>
      ) : null}

      {isAdmin && desk ? (
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Personal desks</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Everyone starts from the company look. When allowed, each person can make their own theme and layout without changing anyone else's.</p>
          {([["theme", "Personal themes"], ["layout", "Personal layouts and pages"]] as const).map(([area, label]) => (
            <div key={area} className="mt-3 flex items-center gap-3">
              <span className="min-w-0 flex-1 text-sm">{label}: {desk[area] ? "allowed" : "locked to the company default"}</span>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => setIxDeskPolicy({ ...desk, [area]: !desk[area] }), `${label} ${desk[area] ? "locked" : "allowed"}.`)}>{desk[area] ? "Lock" : "Allow"}</Button>
            </div>
          ))}
        </div>
      ) : null}

      {isAdmin && sharing ? (
        <div className="mt-4 rounded-xl border border-border bg-card p-4" data-testid="ix-chat-sharing">
          <h2 className="text-sm font-semibold">Chat sharing</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Decide who sees new chats, what people may choose, and who may change it. Owners and admins are never limited by these choices.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 text-sm">New chats start as</span>
            <select aria-label="Default sharing for new chats" value={sharing.defaultShare} disabled={busy} onChange={(e) => { const defaultShare = e.target.value as IxThreadShareLevel; void run(() => setIxSharingPolicy({ ...sharing, defaultShare }), "Chat sharing saved."); }} className="rounded-md border border-input bg-background px-2 py-1 text-sm">
              {SHARE_LEVELS.filter((level) => level === sharing.defaultShare || ixShareAllowed(sharing.allowedShares, level)).map((level) => <option key={level} value={level}>{SHARE_CHOICES.find((c) => c.choice === level)?.label}</option>)}
            </select>
          </div>
          <fieldset className="mt-3">
            <legend className="text-sm">People may share chats with</legend>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {SHARE_CHOICES.map(({ choice, label, hint }) => {
                const checked = sharing.allowedShares.includes(choice);
                const next = checked ? sharing.allowedShares.filter((c) => c !== choice) : [...sharing.allowedShares, choice];
                const blocked = checked && (next.length === 0 || !ixShareAllowed(next, sharing.defaultShare));
                return (
                  <label key={choice} className="flex items-start gap-2 rounded-md px-1 py-1 text-sm" title={blocked ? "Pick a different default first; at least one choice must stay on" : undefined}>
                    <input type="checkbox" aria-label={`Allow ${label}`} checked={checked} disabled={busy || blocked} onChange={() => void run(() => setIxSharingPolicy({ ...sharing, allowedShares: next }), "Chat sharing saved.")} className="mt-0.5" />
                    <span className="flex flex-col"><span>{label}</span><span className="text-xs text-muted-foreground">{hint}</span></span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 text-sm">Who can change who sees a chat</span>
            <select aria-label="Who can change sharing" value={sharing.whoCanChange} disabled={busy} onChange={(e) => { const whoCanChange = e.target.value as IxWhoCanChange; void run(() => setIxSharingPolicy({ ...sharing, whoCanChange }), "Chat sharing saved."); }} className="rounded-md border border-input bg-background px-2 py-1 text-sm">
              {WHO_CAN_CHANGE.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          {([
            ["participantsCanAdd", "People added to a chat can add others", "When off, only whoever can change sharing adds people."],
            ["adminsSeeAll", "Owners and admins can open any chat", "Read-only oversight: they can read every chat but cannot write in chats they were not shared."],
          ] as const).map(([key, label, help]) => (
            <div key={key} className="mt-3 flex items-center gap-3">
              <span className="flex min-w-0 flex-1 flex-col"><span className="text-sm">{label}: {sharing[key] ? "on" : "off"}</span><span className="text-xs text-muted-foreground">{help}</span></span>
              <Button type="button" size="sm" variant="outline" disabled={busy} aria-label={`${sharing[key] ? "Turn off" : "Turn on"}: ${label}`} onClick={() => void run(() => setIxSharingPolicy({ ...sharing, [key]: !sharing[key] }), "Chat sharing saved.")}>{sharing[key] ? "Turn off" : "Turn on"}</Button>
            </div>
          ))}
        </div>
      ) : null}

      {isAdmin ? (
        <form onSubmit={invite} className="mt-8 rounded-xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold">Invite someone</h2>
          <p className="mt-1 text-sm text-muted-foreground">They get a link to join with Google, Microsoft, GitHub or a password.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input type="email" required placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-56 flex-1" aria-label="Email" />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as IxRole)} className="rounded-md border border-input bg-background px-2 py-1 text-sm">
              {ROLES.filter((r) => isOwner || r !== "owner").map((r) => <option key={r} value={r}>{IX_ROLE_LABEL[r]}</option>)}
            </select>
            <Button type="submit" disabled={busy}>Invite</Button>
          </div>
          {lastLink ? <p className="mt-3 break-all text-xs text-muted-foreground">Invite link: <span className="font-mono">{lastLink}</span></p> : null}
        </form>
      ) : null}

      {isAdmin && invitations.length > 0 ? (
        <div className="mt-6">
          <h2 className="text-sm font-semibold">Pending invitations</h2>
          <div className="mt-2 divide-y divide-border border-y border-border">
            {invitations.map((i) => (
              <div key={i.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{i.email}</span>
                <span className="text-xs text-muted-foreground">{IX_ROLE_LABEL[i.role]}</span>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => cancelIxInvitation(i.id), `Invitation for ${i.email} cancelled.`)}>Cancel</Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
