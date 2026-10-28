// @vitest-environment jsdom

import { cleanup, render as renderReact } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "@/components/layout/AppLayout";

import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";

function render(ui: ReactNode) {
  return renderReact(ui, { wrapper: createQueryClientTestHarness().wrapper });
}

const shellState = vi.hoisted(() => ({
  shell: "full" as "full" | "simple" | "nexus",
}));

vi.mock("@/components/ix/ix-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ix/ix-auth")>()),
  useIxShell: () => shellState.shell,
}));

vi.mock("@/components/ix/SimpleSidebar", () => ({
  SimpleSidebar: () => <aside data-testid="simple-sidebar" />,
}));

vi.mock("@/components/ix/nexus/NexusSidebar", () => ({
  NexusSidebar: ({ routeSidebar }: { routeSidebar: { id: string } | null }) => (
    <aside
      data-testid="nexus-sidebar"
      data-route-sidebar={routeSidebar?.id ?? ""}
    />
  ),
}));

vi.mock("@/components/ix/nexus/NexusMain", () => ({
  NexusMain: ({
    children,
    threadTitle,
  }: {
    children: ReactNode;
    threadTitle: string | null;
  }) => (
    <div data-testid="nexus-main" data-thread-title={threadTitle ?? ""}>
      {children}
    </div>
  ),
}));

const mockUseThread = vi.hoisted(() => vi.fn());
const mockUseThreadDetailBootstrap = vi.hoisted(() => vi.fn());
const commandHandlers = vi.hoisted(() => new Map<string, () => boolean>());

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useIndexedAppCommandHandlers: () => {},
  useAppCommandHandler: (command: string, handler: () => boolean) => {
    commandHandlers.set(command, handler);
  },
  useAppCommandShortcut: () => null,
  useAppCommandShortcuts: () => new Map(),
  useAppCommandRunner: () => ({
    dispatch: () => false,
    isCommandAvailable: () => false,
  }),
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("@/components/sidebar/AppSidebar", () => ({
  AppSidebar: () => <aside data-testid="app-sidebar" />,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useUiPreferences: () => ({ data: undefined, isError: false }),
  useSystemConfig: () => ({
    data: {
      experiments: {
        changelogPreview: false,
        serverMove: false,
        performanceDiagnostics: false,
        timelinePush: false,
      },
    },
  }),
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
  useLocalHostDaemonAccess: () => ({ accessState: "unavailable" }),
}));

vi.mock("@/hooks/usePluginSafeModeCommands", () => ({
  usePluginSafeModeCommands: () => undefined,
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  ProjectActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  ThreadActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/dialogs/ProjectPathDialog", () => ({
  ProjectPathDialog: () => null,
}));

vi.mock("@/components/layout/AppPageHeader", () => ({
  HEADER_ICON_BUTTON_CLASS: "header-icon-button",
  AppPageHeader: ({
    center,
    actions,
  }: {
    center?: ReactNode;
    actions?: ReactNode;
  }) => (
    <header>
      {center}
      {actions}
    </header>
  ),
}));

vi.mock("@/lib/iframe-drag-guard", () => ({
  IframeDragGuardOverlay: () => null,
}));

vi.mock("@/lib/bb-desktop", () => ({
  BROWSER_SIDEBAR_TRIGGER_INSET_CLASS: "",
  CHROME_ROW_CLASS: "",
  DEFAULT_DESKTOP_WINDOW_STATE: { isFullScreen: false },
  MACOS_CHROME_CONTROL_AXIS_CLASS: "",
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS: "",
  MACOS_TITLE_BAR_CONTROL_AXIS_CLASS: "",
  MACOS_TITLE_BAR_CONTROL_SIZE_CLASS: "",
  MACOS_TITLE_BAR_PINNED_TOGGLE_CLASS: "",
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS: "",
  MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS: "",
  MACOS_WINDOW_DRAG_CLASS: "",
  MACOS_WINDOW_NO_DRAG_CLASS: "",
  getBbDesktopInfo: () => null,
  shouldReserveMacosTrafficLights: () => false,
  shouldUseMacosDesktopChrome: () => false,
}));

vi.mock("@/lib/favicon-color-preference", () => ({
  useFaviconBadge: vi.fn(),
}));

vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    hostId: null,
    hostName: null,
    isCreating: false,
    platform: "darwin",
    projectPathDialog: {
      onOpenChange: vi.fn(),
      target: null,
    },
    submitProjectPath: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      sections: [],
      personalProject: {
        id: "proj_personal",
        kind: "personal",
        name: "Personal",
        sources: [],
        threads: [],
        defaultExecutionOptions: null,
        createdAt: 1,
        updatedAt: 1,
      },
      projects: [
        {
          id: "proj_opened",
          kind: "standard",
          name: "Opened Project",
          sources: [],
          threads: [],
          defaultExecutionOptions: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    },
    isError: false,
    isSuccess: true,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useArchivedThreads: () => ({ data: undefined }),
  didThreadDetailBootstrapRefreshAfterMount: () => true,
  useThread: (...args: unknown[]) => mockUseThread(...args),
  useThreadDetailBootstrap: (...args: unknown[]) =>
    mockUseThreadDetailBootstrap(...args),
  useThreadPendingInteractions: () => ({ data: undefined }),
}));

describe("AppLayout ix shell switch", () => {
  beforeEach(() => {
    mockUseThread.mockReturnValue({
      data: {
        id: "thr_opened",
        projectId: "proj_opened",
        title: "Opened Thread",
        titleFallback: "Opened Thread",
        lastReadAt: 100,
        latestAttentionAt: 100,
      },
    });
    mockUseThreadDetailBootstrap.mockReturnValue({
      isError: false,
      isSuccess: true,
    });
  });

  afterEach(() => {
    cleanup();
    shellState.shell = "full";
    commandHandlers.clear();
    vi.clearAllMocks();
  });

  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <AppLayout>
          <div data-testid="route-content">Route</div>
        </AppLayout>
      </MemoryRouter>,
    );
  }

  it("renders the Nexus sidebar and main column when the brand picks the nexus shell", () => {
    shellState.shell = "nexus";
    const view = renderAt("/");
    expect(view.getByTestId("nexus-sidebar")).toBeTruthy();
    expect(
      view
        .getByTestId("nexus-main")
        .contains(view.getByTestId("route-content")),
    ).toBe(true);
    expect(view.queryByTestId("app-sidebar")).toBeNull();
    expect(view.queryByTestId("simple-sidebar")).toBeNull();
  });

  it("hands the thread title to the Nexus top bar and the settings sidebar to the Nexus sidebar", () => {
    shellState.shell = "nexus";
    const thread = renderAt("/projects/proj_opened/threads/thr_opened");
    expect(thread.getByTestId("nexus-main").dataset.threadTitle).toBe(
      "Opened Thread",
    );
    cleanup();
    const settings = renderAt("/settings/appearance");
    expect(settings.getByTestId("nexus-sidebar").dataset.routeSidebar).toBe(
      "settings",
    );
    expect(settings.queryByRole("banner")).toBeNull();
  });

  it("keeps the full layout without a nexus brand", () => {
    const view = renderAt("/");
    expect(view.getByTestId("app-sidebar")).toBeTruthy();
    expect(view.queryByTestId("nexus-main")).toBeNull();
    expect(view.getByTestId("route-content")).toBeTruthy();
  });

  it("keeps the simple layout for simple brands", () => {
    shellState.shell = "simple";
    const view = renderAt("/");
    expect(view.getByTestId("simple-sidebar")).toBeTruthy();
    expect(view.queryByTestId("nexus-sidebar")).toBeNull();
    expect(view.queryByTestId("nexus-main")).toBeNull();
  });
});
