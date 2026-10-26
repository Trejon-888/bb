import { describe, expect, it, vi } from "vitest";
import {
  createApplicationUrlOpener,
  type ApplicationUrlDecision,
} from "../src/application-url.js";

describe("application links", () => {
  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,test",
    "file:///Applications/Calculator.app",
    "ms-msdt:/id",
    "search-ms:query=test",
    "ms-appinstaller://test",
    "ms-officecmd:test",
    "vbscript:test",
    "shell:test",
    "smb://server/share",
    "blob:https://example.com/id",
    "chrome://settings",
    "vscode://command/workbench.action.terminal.new",
    "devin://chat-plugin/install",
    "linear://user:password@issue/123",
    "linear://issue/%00test",
    "linear://issue/%0Atest",
    " linear://issue/123",
    "linear:\n//issue/123",
    "/some/file",
    "bb://settings",
  ])("rejects %s before prompting", async (url) => {
    const confirm = vi.fn();
    const open = vi.fn();
    const opener = createApplicationUrlOpener({
      confirm,
      open,
    });
    await expect(opener(url)).rejects.toThrow("blocked or invalid");
    expect(open).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each([
    ["linear://issue/ABC-123", "linear"],
    ["reflect://note/Project%20X?tag=a%2Fb#section", "reflect"],
    ["things:///show?id=abc", "things"],
    ["LINEAR://issue/ABC-123", "linear"],
  ])(
    "preserves %s and asks again after one-time approval",
    async (url, scheme) => {
      const confirm = vi.fn(
        async (): Promise<ApplicationUrlDecision> => "open",
      );
      const open = vi.fn();
      const opener = createApplicationUrlOpener({
        confirm,
        open,
      });
      expect(open).not.toHaveBeenCalled();
      await opener(url);
      await opener(url);
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(confirm).toHaveBeenCalledWith({ url, scheme });
      expect(open.mock.calls).toEqual([[url], [url]]);
    },
  );

  it("cancellation never launches the destination", async () => {
    const open = vi.fn();
    const opener = createApplicationUrlOpener({
      confirm: async () => "cancel",
      open,
    });
    await opener("linear://issue/123");
    expect(open).not.toHaveBeenCalled();
  });

  it("reports failed launches and allows another attempt", async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error("No application installed"))
      .mockResolvedValue(undefined);
    const confirm = vi.fn(async (): Promise<ApplicationUrlDecision> => "open");
    const opener = createApplicationUrlOpener({
      confirm,
      open,
    });
    await expect(opener("linear://issue/123")).rejects.toThrow(
      "No application installed",
    );
    await opener("linear://issue/123");
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("does not stack confirmations or launch a second URL while approval is pending", async () => {
    let settle: (decision: ApplicationUrlDecision) => void = () => {};
    const confirm = vi.fn(
      () =>
        new Promise<ApplicationUrlDecision>((resolve) => {
          settle = resolve;
        }),
    );
    const open = vi.fn();
    const opener = createApplicationUrlOpener({
      confirm,
      open,
    });
    const first = opener("linear://issue/123");
    await opener("reflect://note/test");
    expect(confirm).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    settle("open");
    await first;
    expect(open.mock.calls).toEqual([["linear://issue/123"]]);
  });
});
