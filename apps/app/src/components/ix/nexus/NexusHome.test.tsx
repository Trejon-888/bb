// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";

const session = vi.hoisted(() => ({
  value: {
    status: {
      mode: "team",
      bootstrapped: true,
      orgName: "Advisy",
      brand: { name: "Advisy", appTitle: "Nexus", shell: "nexus" },
    },
    statusFailed: false,
    me: {
      actor: {
        kind: "user",
        user: { id: "u", email: "jordan@advisy.test", name: "Jordan Lee" },
        organizationId: "o",
        memberId: "m",
        role: "member",
      },
      mode: "team",
      orgName: "Advisy",
    },
    mePending: false,
    notMember: null,
    version: 1,
  },
}));

vi.mock("../ix-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ix-auth")>()),
  useIxSession: () => session.value,
  useIxShell: () => session.value.status.brand.shell,
}));

vi.mock("@/lib/plugin-nav-panel-chrome", () => ({
  usePluginNavPanelChrome: () => [],
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
              id: "thr_recent",
              projectId: "proj_1",
              title: "Quarterly report",
              updatedAt: Date.now(),
            }),
          ],
        },
      ],
      personalProject: { id: "proj_personal", name: "Personal", threads: [] },
    },
  }),
}));

import { NexusHomeHero, NexusHomeSections } from "./NexusHome";

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location-state">
      {JSON.stringify(location.state)}
    </output>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 28, 9, 30));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  session.value.status.brand.shell = "nexus";
});

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <NexusHomeHero />
              <NexusHomeSections />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

it("greets the signed-in person by first name for the time of day", () => {
  const view = renderHome();
  expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
    "Good morning, Jordan",
  );
  expect(view.getByText("What should we work on?")).toBeTruthy();
});

it("prefills the real composer through route state when a starter chip is picked", () => {
  const view = renderHome();
  fireEvent.click(view.getByRole("button", { name: "Plan a project" }));
  expect(
    JSON.parse(view.getByTestId("location-state").textContent ?? "null"),
  ).toEqual({
    initialPrompt: "Help me plan this project step by step: ",
    replaceInitialPrompt: true,
  });
});

it("lists recent chats and hides admin-only setup steps from members", () => {
  const view = renderHome();
  expect(view.getByTestId("nexus-recent-chat").textContent).toContain(
    "Quarterly report",
  );
  const checklist = view.getByTestId("nexus-checklist");
  expect(checklist.textContent).toContain("Teach Nexus how you work");
  expect(checklist.textContent).not.toContain("Invite your team");
  fireEvent.click(view.getByRole("button", { name: "Hide" }));
  expect(view.queryByTestId("nexus-checklist")).toBeNull();
});

it("renders nothing outside the nexus shell", () => {
  session.value.status.brand.shell = "full";
  const view = renderHome();
  expect(view.queryByTestId("nexus-home-hero")).toBeNull();
  expect(view.queryByTestId("nexus-home-sections")).toBeNull();
});
