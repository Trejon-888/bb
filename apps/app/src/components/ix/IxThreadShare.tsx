import { useCallback, useEffect, useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { ixRequest, useIxSession } from "./ix-auth";

export type IxThreadShareLevel = "private" | "project" | "workspace";

interface IxThreadShareView {
  share: IxThreadShareLevel;
  owner: { id: string; name: string; email: string } | null;
  mine: boolean;
  canChange: boolean;
}

export const IX_THREAD_SHARE_OPTIONS: ReadonlyArray<{ share: IxThreadShareLevel; label: string; icon: string; hint: string }> = [
  { share: "private", label: "Private", icon: "Lock", hint: "Only you" },
  { share: "project", label: "Project", icon: "Folder02", hint: "People on this project" },
  { share: "workspace", label: "Workspace", icon: "Globe", hint: "Everyone in the workspace" },
];

export function IxThreadShare({ threadId }: { threadId: string }) {
  const session = useIxSession();
  const signedIn = session.me?.actor?.kind === "user";
  const [view, setView] = useState<IxThreadShareView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    ixRequest<IxThreadShareView>(`/threads/${encodeURIComponent(threadId)}/share`)
      .then((next) => { setView(next); setError(null); })
      .catch(() => setView(null));
  }, [threadId]);
  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);
  if (!signedIn || view === null) return null;
  const current = IX_THREAD_SHARE_OPTIONS.find((option) => option.share === view.share) ?? IX_THREAD_SHARE_OPTIONS[0];
  const change = (share: IxThreadShareLevel) => {
    ixRequest<IxThreadShareView>(`/threads/${encodeURIComponent(threadId)}/share`, { method: "PUT", body: { share } })
      .then((next) => { setView(next); setError(null); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not change sharing"));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Who can see this chat: ${current.label}`}
        data-testid="ix-thread-share"
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Icon name={current.icon} className="size-3.5" />
        <span>{current.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuLabel>
          {view.mine || view.owner === null ? "Who can see this chat" : `Shared by ${view.owner.name}`}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {IX_THREAD_SHARE_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.share}
            disabled={!view.canChange}
            onSelect={() => change(option.share)}
            data-testid={`ix-thread-share-${option.share}`}
          >
            <Icon name={option.icon} className="size-4" />
            <span className="flex flex-1 flex-col">
              <span>{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.hint}</span>
            </span>
            {option.share === view.share ? <Icon name="Check" className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
        {!view.canChange ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Only the person who started this chat can change who sees it.</DropdownMenuLabel>
          </>
        ) : null}
        {error !== null ? <DropdownMenuLabel className="text-xs font-normal text-destructive">{error}</DropdownMenuLabel> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
