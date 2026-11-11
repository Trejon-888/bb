// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useThreadChatSuggestions } from "./thread-chat-suggestions-query";

const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { chatSuggestions: generate } },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("does not request suggestions when disabled and hides cached suggestions while drafting", async () => {
  generate.mockResolvedValue({
    sequence: 1,
    suggestions: [{ label: "Review", prompt: "Review the proposal." }],
  });
  const { wrapper } = createQueryClientTestHarness();
  const { result, rerender } = renderHook(useThreadChatSuggestions, {
    wrapper,
    initialProps: { threadId: "a", version: 1, enabled: false },
  });
  expect(generate).not.toHaveBeenCalled();
  rerender({ threadId: "a", version: 1, enabled: true });
  await waitFor(() => expect(result.current).toHaveLength(1));
  rerender({ threadId: "a", version: 1, enabled: false });
  expect(result.current).toEqual([]);
});

it("ignores late responses after switching threads or conversation versions", async () => {
  let resolveOld:
    | ((value: {
        sequence: number;
        suggestions: { label: string; prompt: string }[];
      }) => void)
    | undefined;
  generate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  generate.mockResolvedValue({
    sequence: 2,
    suggestions: [{ label: "Current", prompt: "Review current work." }],
  });
  const { wrapper } = createQueryClientTestHarness();
  const { result, rerender } = renderHook(useThreadChatSuggestions, {
    wrapper,
    initialProps: { threadId: "a", version: 1, enabled: true },
  });
  rerender({ threadId: "b", version: 1, enabled: true });
  expect(result.current).toEqual([]);
  await waitFor(() => expect(result.current[0]?.label).toBe("Current"));
  await act(async () => {
    resolveOld?.({
      sequence: 1,
      suggestions: [{ label: "Stale", prompt: "Old thread." }],
    });
  });
  expect(result.current[0]?.label).toBe("Current");
  rerender({ threadId: "b", version: 2, enabled: true });
  expect(result.current).toEqual([]);
  await waitFor(() => expect(result.current[0]?.label).toBe("Current"));
  expect(generate).toHaveBeenCalledTimes(3);
});

it("retries an unavailable empty response after the cache becomes stale", async () => {
  generate.mockResolvedValueOnce({ sequence: 1, suggestions: [] });
  generate.mockResolvedValue({
    sequence: 1,
    suggestions: [{ label: "Retry", prompt: "Review this thread." }],
  });
  const { wrapper, queryClient } = createQueryClientTestHarness();
  const { result, rerender } = renderHook(useThreadChatSuggestions, {
    wrapper,
    initialProps: { threadId: "a", version: 1, enabled: true },
  });
  await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  rerender({ threadId: "a", version: 1, enabled: false });
  await act(async () => {
    await queryClient.invalidateQueries({
      queryKey: ["thread-chat-suggestions", "a", 1],
    });
  });
  rerender({ threadId: "a", version: 1, enabled: true });
  await waitFor(() => expect(result.current[0]?.label).toBe("Retry"));
});
