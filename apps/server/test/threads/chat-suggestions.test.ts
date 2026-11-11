import {
  createIxAccessStore,
  restrictedScopeFor,
  runWithIxRequestAccess,
} from "../../src/ix/access.js";
import { createIxKv } from "../../src/ix/kv.js";
import { requirePublicThread } from "../../src/services/lib/entity-lookup.js";
import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID, turnScope } from "@bb/domain";
import { setAiServiceSelection } from "@bb/db";
import {
  createChatSuggestionGenerator,
  parseChatSuggestions,
} from "../../src/services/threads/chat-suggestions.js";
import { withTestHarness } from "../helpers/test-app.js";
import { registerFakeAiService } from "../helpers/ai-services.js";
import { seedThread, seedEvent } from "../helpers/seed.js";

const reply = [
  {
    label: "Test rollback",
    prompt: "Can you test the rollback path before release?",
  },
];

describe("conversation suggestions", () => {
  it("rejects malformed, oversized, extra-field and excessive responses", () => {
    for (const raw of [
      "bad",
      "x".repeat(4097),
      JSON.stringify([...reply, ...reply, ...reply, ...reply]),
      JSON.stringify([{ ...reply[0], execute: true }]),
    ])
      expect(parseChatSuggestions(raw)).toBeNull();
    expect(parseChatSuggestions(JSON.stringify([...reply, ...reply]))).toEqual(
      reply,
    );
  });
  it("uses bounded conversation, caches exact version, and respects off", async () => {
    await withTestHarness({}, async (harness) => {
      const thread = seedThread(harness.deps, {
        projectId: PERSONAL_PROJECT_ID,
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        providerThreadId: "provider-test",
        sequence: 1,
        scope: turnScope("turn-test"),
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "message-test",
            text: "Release rollback is untested.",
          },
        },
      });
      const service = registerFakeAiService(harness.deps.aiServices, {
        complete: async () => JSON.stringify(reply),
      });
      const generate = createChatSuggestionGenerator(harness.deps);
      const signal = new AbortController().signal;
      expect(await generate(thread.id, signal)).toEqual({
        sequence: 1,
        suggestions: reply,
      });
      expect(await generate(thread.id, signal)).toEqual({
        sequence: 1,
        suggestions: reply,
      });
      expect(service.completeCalls).toHaveLength(1);
      expect(service.completeCalls[0]?.prompt).toContain(
        "Release rollback is untested.",
      );
      setAiServiceSelection(harness.deps.db, "chat-suggestions", {
        mode: "off",
      });
      expect((await generate(thread.id, signal)).suggestions).toEqual([]);
      expect(service.completeCalls).toHaveLength(1);
    });
  });
  it("rejects missing thread endpoint requests", async () => {
    await withTestHarness({}, async (harness) => {
      const service = registerFakeAiService(harness.deps.aiServices);
      const response = await harness.app.request(
        "/api/v1/threads/does-not-exist/chat-suggestions",
        { method: "POST" },
      );
      expect(response.status).toBe(404);
      expect(service.completeCalls).toHaveLength(0);
    });
  });
  it("discards a response generated for a superseded conversation", async () => {
    await withTestHarness({}, async (harness) => {
      const thread = seedThread(harness.deps, {
        projectId: PERSONAL_PROJECT_ID,
      });
      const append = (sequence: number) =>
        seedEvent(harness.deps, {
          threadId: thread.id,
          providerThreadId: "provider-test",
          sequence,
          scope: turnScope("turn-test"),
          type: "item/completed",
          data: {
            item: {
              type: "agentMessage",
              id: `message-${sequence}`,
              text: "Discuss release rollback.",
            },
          },
        });
      append(1);
      let release: (text: string) => void = () => {
        throw new Error("Not started");
      };
      let started: () => void = () => {};
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      registerFakeAiService(harness.deps.aiServices, {
        complete: async () =>
          new Promise<string>((resolve) => {
            release = resolve;
            started();
          }),
      });
      const generate = createChatSuggestionGenerator(harness.deps);
      const result = generate(thread.id, new AbortController().signal);
      await ready;
      append(2);
      release(JSON.stringify(reply));
      expect((await result).suggestions).toEqual([]);
    });
  });
  it("does not read another user's private conversation or call a provider", async () => {
    await withTestHarness({}, async (harness) => {
      const thread = seedThread(harness.deps, {
        projectId: PERSONAL_PROJECT_ID,
      });
      const store = createIxAccessStore(
        harness.deps.db,
        createIxKv(harness.deps.db),
      );
      store.setMode("restricted");
      store.recordThreadOwner(thread.id, "owner-a");
      const actor = {
        kind: "user" as const,
        user: { id: "user-b", email: "b@example.test", name: "B" },
        organizationId: "org",
        memberId: "member-b",
        role: "member" as const,
      };
      const service = registerFakeAiService(harness.deps.aiServices);
      const generate = createChatSuggestionGenerator(harness.deps);
      await runWithIxRequestAccess(
        actor,
        store,
        restrictedScopeFor(actor, store, "POST"),
        async () => {
          await expect(
            (async () => {
              const visibleThread = requirePublicThread(
                harness.deps.db,
                thread.id,
              );
              return generate(visibleThread.id, new AbortController().signal);
            })(),
          ).rejects.toMatchObject({ status: 404 });
        },
      );
      expect(service.completeCalls).toHaveLength(0);
    });
  });
});
