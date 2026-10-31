import { describe, expect, it } from "vitest";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

describe("NotificationHub.notifyThreadOpen", () => {
  it("broadcasts to every connected client and returns the delivered count", () => {
    const hub = new NotificationHub();
    const viewing = createMockHubSocket();
    const other = createMockHubSocket();
    hub.subscribe(viewing, { kind: "thread-detail", threadId: "thr_1" });
    hub.subscribe(other, { kind: "thread-detail", threadId: "thr_2" });

    const delivered = hub.notifyThreadOpen(
      { projectId: "proj_1", threadId: "thr_1" },
      {
        split: "right",
        file: {
          source: "workspace",
          path: "src/index.ts",
          lineNumber: 42,
        },
      },
    );

    expect(delivered).toBe(2);
    for (const socket of [viewing, other]) {
      expect(socket.messages).toHaveLength(1);
      expect(JSON.parse(socket.messages[0])).toEqual({
        type: "thread-open",
        projectId: "proj_1",
        threadId: "thr_1",
        split: "right",
        file: {
          source: "workspace",
          path: "src/index.ts",
          lineNumber: 42,
        },
      });
    }
  });

  it("broadcasts typed thread-pane actions to every connected client", () => {
    const hub = new NotificationHub();
    const first = createMockHubSocket();
    const second = createMockHubSocket();
    hub.registerClient(first);
    hub.registerClient(second);

    expect(
      hub.notifyThreadPaneAction(
        { projectId: "proj_1", threadId: "thr_1" },
        "clear-spotlight",
      ),
    ).toBe(2);
    for (const socket of [first, second]) {
      expect(JSON.parse(socket.messages[0]!)).toEqual({
        type: "thread-pane-action",
        projectId: "proj_1",
        threadId: "thr_1",
        action: "clear-spotlight",
      });
    }
  });
});

describe("NotificationHub.notifyPluginSignal", () => {
  it("sends a signal about a thread only to clients that may see that thread", () => {
    const hub = new NotificationHub();
    const allowed = createMockHubSocket();
    const blocked = createMockHubSocket();
    const unfiltered = createMockHubSocket();
    for (const socket of [allowed, blocked, unfiltered]) hub.registerClient(socket);
    const filter = (visible: boolean) => ({
      canSeeThread: () => visible,
      canSeeProject: () => true,
      canSeeEnvironment: () => true,
    });
    hub.setSocketAccessFilter(allowed, filter(true));
    hub.setSocketAccessFilter(blocked, filter(false));

    expect(hub.notifyPluginSignal("push-notifications", "notify", { threadId: "thr_1", title: "Private" })).toBe(2);
    expect(blocked.messages).toHaveLength(0);
    expect(allowed.messages).toHaveLength(1);
    expect(unfiltered.messages).toHaveLength(1);

    expect(hub.notifyPluginSignal("push-notifications", "notify", { threadId: null, title: "Test" })).toBe(3);
    expect(blocked.messages).toHaveLength(1);
  });
});
