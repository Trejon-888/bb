import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import {
  IX_ROLE_LABEL,
  IxHttpError,
  cancelIxInvitation,
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

  const reload = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([listIxMembers(), isAdmin ? listIxInvitations() : Promise.resolve({ invitations: [] })]);
      setMembers(m.members);
      setInvitations(i.invitations.filter((x) => x.status === "pending"));
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
            </div>
          );
        })}
      </div>

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
