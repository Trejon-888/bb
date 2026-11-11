import { useQuery } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";

export function useThreadChatSuggestions({
  threadId,
  version,
  enabled,
}: {
  threadId: string;
  version: number;
  enabled: boolean;
}) {
  const query = useQuery({
    queryKey: ["thread-chat-suggestions", threadId, version],
    queryFn: ({ signal }) => sdk.threads.chatSuggestions({ threadId, signal }),
    enabled,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return enabled ? (query.data?.suggestions ?? []) : [];
}
