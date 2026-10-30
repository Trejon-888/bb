import { useIxMessageSender } from "./ix-thread-senders";

export function ixInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

export function IxMessageSender({ row }: { row: { threadId: string; messageSeq: number; initiator: string } }) {
  if (row.initiator !== "user") return null;
  return <IxMessageSenderLabel threadId={row.threadId} sequence={row.messageSeq} />;
}

function IxMessageSenderLabel({ threadId, sequence }: { threadId: string; sequence: number }) {
  const sender = useIxMessageSender(threadId, sequence);
  if (sender === null) return null;
  return (
    <div className="mb-1 flex items-center justify-end gap-1.5 text-xs text-muted-foreground" data-testid="ix-message-sender" title={sender.email}>
      <span aria-hidden className="inline-flex size-5 items-center justify-center rounded-full bg-accent text-2xs font-semibold text-foreground">{ixInitials(sender.name)}</span>
      <span className="truncate">{sender.name}</span>
    </div>
  );
}
