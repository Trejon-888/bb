// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";

const handlers = vi.hoisted(() => new Map<string, () => boolean>());
const sidebar = vi.hoisted(() => ({
  toggleSidebar: vi.fn(),
  isCompactViewport: false,
}));
const dispatch = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: (command: string, handler: () => boolean) => {
    handlers.set(command, handler);
  },
  useAppCommandRunner: () => ({
    dispatch,
    isCommandAvailable: () => true,
    getShortcutCommand: () => null,
  }),
}));

vi.mock("@/components/ui/sidebar.js", () => ({ useSidebar: () => sidebar }));
vi.mock("@/lib/plugin-nav-panel-chrome", () => ({
  usePluginNavPanelChrome: () => [
    { chrome: { pluginId: "automations" }, panel: null },
  ],
}));
vi.mock("../IxOrganizationView", () => ({
  IxOrganizationView: () => <div data-testid="org-view" />,
}));
vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    isLoading: false,
    data: {
      sections: [],
      projects: [
        {
          id: "proj_1",
          name: "Ops",
          threads: [
            makeThreadListEntry({
              id: "thr_1",
              projectId: "proj_1",
              title: "Quarterly report",
            }),
          ],
        },
      ],
      personalProject: { id: "proj_personal", name: "Personal", threads: [] },
    },
  }),
}));

import { NexusMain } from "./NexusMain";

function LocationProbe() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

afterEach(() => {
  cleanup();
  handlers.clear();
  vi.clearAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <NexusMain threadTitle={null}>
                <div data-testid="route-content" />
              </NexusMain>
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

it("marks the document root for the Nexus font and clears it on unmount", () => {
  const view = renderAt("/");
  expect(document.documentElement.getAttribute("data-ix-shell")).toBe("nexus");
  view.unmount();
  expect(document.documentElement.getAttribute("data-ix-shell")).toBeNull();
});

it("renders bb's route content except on Nexus-owned pages", () => {
  const home = renderAt("/");
  expect(home.getByTestId("route-content")).toBeTruthy();
  expect(home.getByTestId("nexus-topbar").textContent).toContain("Home");
  cleanup();
  const org = renderAt("/ix/organization");
  expect(org.getByTestId("org-view")).toBeTruthy();
  expect(org.queryByTestId("route-content")).toBeNull();
  cleanup();
  const spaces = renderAt("/ix/spaces");
  expect(spaces.getAllByTestId("nexus-space")).toHaveLength(1);
});

it("toggles the sidebar on mod+B and starts a new chat on mod+Enter outside inputs", () => {
  const view = renderAt("/skills");
  fireEvent.keyDown(window, { key: "b", metaKey: true });
  expect(sidebar.toggleSidebar).toHaveBeenCalledTimes(1);
  const input = document.createElement("textarea");
  document.body.append(input);
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  expect(view.getByTestId("path").textContent).toBe("/skills");
  input.remove();
  fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
  expect(view.getByTestId("path").textContent).toBe("/");
});

it("opens the palette from the thread search command and jumps to a chat", async () => {
  const view = renderAt("/");
  act(() => {
    expect(handlers.get("thread.search")?.()).toBe(true);
  });
  const input = await view.findByLabelText("Search pages, chats and actions");
  expect(view.getByRole("option", { name: "Scheduled" })).toBeTruthy();
  fireEvent.change(input, { target: { value: "quarterly" } });
  expect(view.getAllByRole("option")).toHaveLength(1);
  fireEvent.keyDown(input, { key: "Enter" });
  await vi.waitFor(() =>
    expect(view.getByTestId("path").textContent).toBe(
      "/projects/proj_1/threads/thr_1",
    ),
  );
});

it("routes Scheduled to the automations panel when that plugin is installed", async () => {
  const view = renderAt("/");
  fireEvent.click(view.getByTestId("nexus-search"));
  const input = await view.findByLabelText("Search pages, chats and actions");
  fireEvent.change(input, { target: { value: "scheduled" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await vi.waitFor(() =>
    expect(view.getByTestId("path").textContent).toBe(
      "/plugins/automations/automations",
    ),
  );
});
