import { useEffect, useSyncExternalStore } from "react";
import { getIxThreadSenders, readIxSession, type IxThreadSenders } from "./ix-auth";

interface SenderEntry {
  data: IxThreadSenders | null;
  loading: boolean;
  fetchedAt: number;
  asked: Set<number>;
}

const REFETCH_SPACING_MS = 1500;
const entries = new Map<string, SenderEntry>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function fetchSenders(threadId: string): void {
  const entry = entries.get(threadId) ?? { data: null, loading: false, fetchedAt: 0, asked: new Set<number>() };
  if (entry.loading) return;
  entries.set(threadId, { ...entry, loading: true });
  getIxThreadSenders(threadId)
    .then((data) => entries.set(threadId, { ...entry, data, loading: false, fetchedAt: Date.now() }))
    .catch(() => entries.set(threadId, { ...entry, loading: false, fetchedAt: Date.now() }))
    .finally(notify);
}

export function invalidateIxThreadSenders(threadId: string): void {
  if (entries.has(threadId)) fetchSenders(threadId);
}

export function resetIxThreadSendersForTests(): void {
  entries.clear();
  notify();
}

export function useIxMessageSender(threadId: string, sequence: number): { name: string; email: string } | null {
  useSyncExternalStore(subscribe, () => version, () => version);
  const signedIn = readIxSession().me?.actor?.kind === "user";
  const entry = entries.get(threadId);
  const known = entry?.data?.senders.find((sender) => sender.sequence === sequence) ?? null;
  const loaded = entry !== undefined;
  useEffect(() => {
    if (!signedIn) return;
    const current = entries.get(threadId);
    if (current === undefined) {
      fetchSenders(threadId);
      return;
    }
    if (current.data?.senders.some((sender) => sender.sequence === sequence) === true || current.asked.has(sequence)) return;
    const newest = current.data?.senders.at(-1)?.sequence ?? -1;
    if (current.data !== null && sequence < newest) return;
    current.asked.add(sequence);
    window.setTimeout(() => fetchSenders(threadId), Math.max(0, current.fetchedAt + REFETCH_SPACING_MS - Date.now()));
  }, [signedIn, threadId, sequence, loaded]);
  if (!signedIn || entry?.data?.multi !== true || known === null) return null;
  return { name: known.name, email: known.email };
}
