// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callPluginRpc } from "@/lib/plugin-sdk-hooks";
import {
  IxProviderConnect,
  ixPickerOptions,
  ixProviderConnected,
} from "./ix-provider-model";
vi.mock("@/lib/plugin-sdk-hooks", () => ({ callPluginRpc: vi.fn() }));
vi.mock("@/lib/plugin-nav-panel-chrome", () => ({
  usePluginNavPanelChrome: () => [],
}));
vi.mock("@/components/plugin/ProviderIcon", () => ({
  ProviderIcon: () => null,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function mount(admin = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <IxProviderConnect
        providerId="claude-code"
        viewer={{ canAddPrivate: true, canAddWorkspace: admin }}
      />
    </QueryClientProvider>,
  );
  return client;
}
describe("IX provider model picker", () => {
  it("always offers exactly the four subscription providers, including absent adapters", () => {
    const options = ixPickerOptions([
      { value: "pi", label: "Pi" },
      { value: "acp-cursor", label: "Cursor" },
      { value: "codex", label: "Codex" },
    ]);
    expect(options.map((p) => p.value)).toEqual([
      "codex",
      "claude-code",
      "acp-gemini",
      "acp-grok",
    ]);
  });
  it("ignores disabled, failed and unrelated project accounts", () => {
    const account = {
      provider: "claude",
      scope: "project:other",
      enabled: true,
      status: "ready",
    };
    expect(ixProviderConnected([account], "claude", "mine")).toBe(false);
    expect(ixProviderConnected([account], "claude", "other")).toBe(true);
    expect(
      ixProviderConnected([{ ...account, scope: "private" }], "claude"),
    ).toBe(true);
    expect(
      ixProviderConnected(
        [{ ...account, scope: "workspace", enabled: false }],
        "claude",
      ),
    ).toBe(false);
    expect(
      ixProviderConnected(
        [{ ...account, scope: "workspace", status: "error" }],
        "claude",
      ),
    ).toBe(false);
  });
  it("starts the existing plugin flow in the chosen workspace scope", async () => {
    vi.mocked(callPluginRpc).mockResolvedValue({
      sessionId: "s",
      authorizeUrl: "https://claude.ai/oauth/authorize",
    });
    mount();
    fireEvent.click(screen.getByRole("radio", { name: /Workspace/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Connect Claude Code" }),
    );
    await waitFor(() =>
      expect(callPluginRpc).toHaveBeenCalledWith(
        fetch,
        "ix-providers",
        "login.start",
        { provider: "claude", scope: "workspace" },
      ),
    );
    expect(
      (
        await screen.findByRole("link", { name: "Sign in to Claude Code" })
      ).getAttribute("href"),
    ).toBe("https://claude.ai/oauth/authorize");
  });
  it("defaults to personal and hides workspace connection from members", async () => {
    vi.mocked(callPluginRpc).mockResolvedValue({
      sessionId: "s",
      authorizeUrl: "https://claude.ai/oauth/authorize",
    });
    mount(false);
    expect(screen.queryByRole("radio", { name: /Workspace/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect Claude Code" }),
    );
    await waitFor(() =>
      expect(callPluginRpc).toHaveBeenCalledWith(
        fetch,
        "ix-providers",
        "login.start",
        { provider: "claude", scope: "private" },
      ),
    );
  });
  it("shows a failed login and permits another attempt", async () => {
    vi.mocked(callPluginRpc).mockRejectedValue(
      new Error("Provider temporarily unavailable"),
    );
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect Claude Code" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Provider temporarily unavailable",
    );
    expect(
      screen
        .getByRole("button", { name: "Connect Claude Code" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
