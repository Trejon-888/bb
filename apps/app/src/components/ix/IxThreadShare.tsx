import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import {
  addIxThreadPeople,
  getIxThreadShare,
  ixShareAllowed,
  listIxMembers,
  removeIxThreadPerson,
  setIxThreadShare,
  useIxSession,
  type IxMember,
  type IxThreadShareLevel,
  type IxThreadShareView,
} from "./ix-auth";
import { invalidateIxThreadSenders } from "./ix-thread-senders";

export type { IxThreadShareLevel } from "./ix-auth";

export const IX_THREAD_SHARE_OPTIONS: ReadonlyArray<{ share: IxThreadShareLevel; label: string; icon: string; hint: string }> = [
  { share: "private", label: "Private", icon: "Lock", hint: "Only you and the people you add" },
  { share: "project", label: "Project", icon: "Folder02", hint: "People on this project" },
  { share: "workspace", label: "Workspace", icon: "Globe", hint: "Everyone in the workspace" },
];

export function ixThreadShareLabel(view: Pick<IxThreadShareView, "share" | "people">): string {
  const option = IX_THREAD_SHARE_OPTIONS.find((candidate) => candidate.share === view.share) ?? IX_THREAD_SHARE_OPTIONS[0];
  const count = view.people.length;
  if (count === 0) return option.label;
  if (view.share === "private") return `${count + 1} people`;
  return `${option.label} + ${count}`;
}

const errorText = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);

export function IxThreadShare({ threadId }: { threadId: string }) {
  const session = useIxSession();
  const navigate = useNavigate();
  const signedIn = session.me?.actor?.kind === "user";
  const [view, setView] = useState<IxThreadShareView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<IxMember[] | null>(null);
  const load = useCallback(() => {
    getIxThreadShare(threadId)
      .then((next) => { setView(next); setError(null); })
      .catch(() => setView(null));
  }, [threadId]);
  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);
  useEffect(() => {
    if (!picking || members !== null) return;
    listIxMembers()
      .then((result) => setMembers(result.members))
      .catch((caught: unknown) => setError(errorText(caught, "Could not load people")));
  }, [picking, members]);
  const candidates = useMemo(() => {
    if (view === null || members === null) return [];
    const taken = new Set([view.owner?.id, ...view.people.map((person) => person.id)]);
    const needle = query.trim().toLowerCase();
    return members.filter((member) => !taken.has(member.userId) && (needle === "" || member.name.toLowerCase().includes(needle) || member.email.toLowerCase().includes(needle)));
  }, [view, members, query]);
  if (!signedIn || view === null) return null;
  const current = IX_THREAD_SHARE_OPTIONS.find((option) => option.share === view.share) ?? IX_THREAD_SHARE_OPTIONS[0];
  const label = ixThreadShareLabel(view);
  const apply = (action: Promise<IxThreadShareView | { ok: true; left: true }>, fallback: string) => {
    action
      .then((next) => {
        invalidateIxThreadSenders(threadId);
        if ("left" in next) {
          setView(null);
          navigate(getRootComposeRoutePath());
          return;
        }
        setView(next);
        setError(null);
      })
      .catch((caught: unknown) => setError(errorText(caught, fallback)));
  };
  const options = IX_THREAD_SHARE_OPTIONS.filter((option) => option.share === view.share || ixShareAllowed(view.allowedShares, option.share));
  const peopleAllowed = view.allowedShares.includes("people");
  return (
    <Popover onOpenChange={(open) => { if (!open) { setPicking(false); setQuery(""); } }}>
      <PopoverTrigger
        aria-label={`Who can see this chat: ${label}`}
        data-testid="ix-thread-share"
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Icon name={view.people.length > 0 && view.share === "private" ? "UserRound" : current.icon} className="size-3.5" />
        <span>{label}</span>
      </PopoverTrigger>
      <PopoverContent align="end" mobileTitle="Who can see this chat" className="w-80 p-0" data-testid="ix-thread-share-menu">
        <div className="px-3 pt-3 pb-2 text-sm font-medium">
          {view.mine || view.owner === null ? "Who can see this chat" : `Started by ${view.owner.name}`}
        </div>
        <div role="radiogroup" aria-label="Who can see this chat" className="px-1">
          {options.map((option) => {
            const selected = option.share === view.share;
            return (
              <button
                key={option.share}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!view.canChange || !ixShareAllowed(view.allowedShares, option.share)}
                onClick={() => { if (!selected) apply(setIxThreadShare(threadId, option.share), "Could not change sharing"); }}
                data-testid={`ix-thread-share-${option.share}`}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <Icon name={option.icon} className="size-4" />
                <span className="flex flex-1 flex-col">
                  <span>{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.hint}</span>
                </span>
                {selected ? <Icon name="Check" className="size-4" /> : null}
              </button>
            );
          })}
        </div>
        {!view.canChange && view.reason !== null ? (
          <p className="px-3 pb-2 text-xs text-muted-foreground" data-testid="ix-thread-share-reason">{view.reason}</p>
        ) : null}
        {peopleAllowed || view.people.length > 0 ? (
          <div className="border-t border-border px-3 py-2" data-testid="ix-thread-people">
            <div className="text-xs font-medium text-muted-foreground">People</div>
            {view.people.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">No one added yet.</p>
            ) : (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {view.people.map((person) => (
                  <li key={person.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-accent/50 py-0.5 pr-1 pl-2 text-xs" title={person.email}>
                    <span className="truncate">{person.name}</span>
                    {view.canRemove ? (
                      <button
                        type="button"
                        aria-label={`Remove ${person.name}`}
                        onClick={() => apply(removeIxThreadPerson(threadId, person.id), "Could not remove this person")}
                        className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Icon name="X" className="size-3" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {view.canAdd && !picking ? (
              <button type="button" onClick={() => setPicking(true)} className="mt-2 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-primary hover:bg-accent" data-testid="ix-thread-people-add">
                <Icon name="UserRoundPlus" className="size-4" />
                Add people…
              </button>
            ) : null}
            {!view.canAdd && peopleAllowed && view.addReason !== null ? (
              <p className="mt-1.5 text-xs text-muted-foreground" data-testid="ix-thread-people-reason">{view.addReason}</p>
            ) : null}
            {picking ? (
              <div className="mt-2" data-testid="ix-thread-people-picker">
                <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or email" aria-label="Search people" className="h-8 text-sm" />
                <ul className="mt-1 max-h-48 overflow-y-auto">
                  {members === null ? <li className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</li> : null}
                  {members !== null && candidates.length === 0 ? <li className="px-2 py-1.5 text-xs text-muted-foreground">No one else to add.</li> : null}
                  {candidates.map((member) => (
                    <li key={member.userId}>
                      <button
                        type="button"
                        onClick={() => { apply(addIxThreadPeople(threadId, [member.userId]), "Could not add this person"); setQuery(""); }}
                        className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-accent"
                      >
                        <span className="truncate text-sm">{member.name || member.email}</span>
                        <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        {view.canLeave ? (
          <div className="border-t border-border px-1 py-1">
            <button
              type="button"
              onClick={() => apply(removeIxThreadPerson(threadId, session.me?.actor?.kind === "user" ? session.me.actor.user.id : ""), "Could not leave this chat")}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-accent"
              data-testid="ix-thread-leave"
            >
              Leave chat
            </button>
          </div>
        ) : null}
        {error !== null ? <p role="alert" className="border-t border-border px-3 py-2 text-xs text-destructive">{error}</p> : null}
      </PopoverContent>
    </Popover>
  );
}
