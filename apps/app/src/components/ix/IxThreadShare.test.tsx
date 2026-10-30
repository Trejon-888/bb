// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IxMessageSender } from "./IxMessageSender";
import { IxOrganizationView } from "./IxOrganizationView";
import { IxThreadShare, ixThreadShareLabel } from "./IxThreadShare";
import { refreshIxSession, resetIxSessionForTests, type IxThreadShareView } from "./ix-auth";
import { resetIxThreadSendersForTests } from "./ix-thread-senders";

type Route = (url: string, init: RequestInit | undefined) => Response | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(route: Route): ReturnType<typeof vi.fn> {
  const base: Route = (url) => {
    if (url.endsWith("/api/ix/status")) return jsonResponse({ mode: "team", bootstrapped: true, orgName: "Acme", brand: {} });
    if (url.endsWith("/api/ix/me")) return jsonResponse({ actor: { kind: "user", user: { id: "u-me", email: "me@example.test", name: "Me" }, organizationId: "o", memberId: "m-me", role: "member" }, mode: "team", orgName: "Acme" });
    return undefined;
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const response = route(url, init) ?? base(url, init);
    if (response !== undefined) return response;
    throw new Error(`unexpected fetch ${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const member = (userId: string, name: string) => ({ id: `m-${userId}`, userId, email: `${name.toLowerCase()}@example.test`, name, role: "member", createdAt: "2026-01-01" });
const view = (patch: Partial<IxThreadShareView>): IxThreadShareView => ({
  share: "private",
  owner: { id: "u-me", name: "Me", email: "me@example.test" },
  mine: true,
  member: false,
  people: [],
  canChange: true,
  canAdd: true,
  canRemove: true,
  canLeave: false,
  allowedShares: ["private", "project", "workspace", "people"],
  reason: null,
  addReason: null,
  ...patch,
});

beforeEach(() => {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  resetIxSessionForTests();
  resetIxThreadSendersForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderShare() {
  await refreshIxSession();
  const screen = render(<MemoryRouter><IxThreadShare threadId="t1" /></MemoryRouter>);
  const trigger = await screen.findByTestId("ix-thread-share");
  return { screen, trigger };
}

describe("ixThreadShareLabel", () => {
  it("names the mode, the people count, or both", () => {
    const ben = { id: "u-ben", name: "Ben", email: "", addedBy: null, addedAt: 1 };
    expect(ixThreadShareLabel({ share: "private", people: [] })).toBe("Private");
    expect(ixThreadShareLabel({ share: "workspace", people: [] })).toBe("Workspace");
    expect(ixThreadShareLabel({ share: "private", people: [ben, { ...ben, id: "u-cy" }] })).toBe("3 people");
    expect(ixThreadShareLabel({ share: "project", people: [ben] })).toBe("Project + 1");
  });
});

describe("IxThreadShare", () => {
  it("shows added people as chips and adds someone from the searchable picker", async () => {
    let current = view({ people: [{ id: "u-ben", name: "Ben", email: "ben@example.test", addedBy: "u-me", addedAt: 1 }] });
    const fetchMock = stubFetch((url, init) => {
      if (url.endsWith("/api/ix/threads/t1/share")) return jsonResponse(current);
      if (url.endsWith("/api/ix/members")) return jsonResponse({ members: [member("u-me", "Me"), member("u-ben", "Ben"), member("u-cy", "Cy"), member("u-dee", "Dee")] });
      if (url.endsWith("/api/ix/threads/t1/people") && init?.method === "POST") {
        current = view({ people: [...current.people, { id: "u-cy", name: "Cy", email: "cy@example.test", addedBy: "u-me", addedAt: 2 }] });
        return jsonResponse(current);
      }
      return undefined;
    });
    const { screen, trigger } = await renderShare();
    expect(trigger.textContent).toBe("2 people");
    fireEvent.click(trigger);
    const people = await screen.findByTestId("ix-thread-people");
    expect(within(people).getByText("Ben")).toBeTruthy();
    expect(within(people).getByRole("button", { name: "Remove Ben" })).toBeTruthy();
    fireEvent.click(within(people).getByTestId("ix-thread-people-add"));
    const picker = await screen.findByTestId("ix-thread-people-picker");
    await within(picker).findByText("Cy");
    expect(within(picker).queryByText("Ben")).toBeNull();
    expect(within(picker).queryByText("me@example.test")).toBeNull();
    fireEvent.change(within(picker).getByRole("textbox", { name: "Search people" }), { target: { value: "dee" } });
    expect(within(picker).queryByText("Cy")).toBeNull();
    fireEvent.change(within(picker).getByRole("textbox", { name: "Search people" }), { target: { value: "cy@" } });
    fireEvent.click(within(picker).getByText("Cy"));
    await waitFor(() => expect(trigger.textContent).toBe("3 people"));
    const post = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith("/people") && init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ userIds: ["u-cy"] });
  });

  it("hides choices the policy disallows and disables controls with the reason", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/ix/threads/t1/share")) {
        return jsonResponse(view({
          share: "project",
          mine: false,
          member: true,
          canLeave: true,
          canChange: false,
          canAdd: false,
          canRemove: false,
          allowedShares: ["private", "project", "people"],
          reason: "Only the person who started this chat can change who sees it.",
          addReason: "Only the person who started this chat can add people.",
          people: [{ id: "u-me", name: "Me", email: "me@example.test", addedBy: "u-x", addedAt: 1 }],
        }));
      }
      return undefined;
    });
    const { screen, trigger } = await renderShare();
    expect(trigger.textContent).toBe("Project + 1");
    fireEvent.click(trigger);
    await screen.findByTestId("ix-thread-share-menu");
    expect(screen.queryByTestId("ix-thread-share-workspace")).toBeNull();
    expect((screen.getByTestId("ix-thread-share-private") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("ix-thread-share-reason").textContent).toContain("Only the person who started");
    expect(screen.queryByTestId("ix-thread-people-add")).toBeNull();
    expect(screen.getByTestId("ix-thread-people-reason").textContent).toBe("Only the person who started this chat can add people.");
    expect(screen.queryByRole("button", { name: "Remove Me" })).toBeNull();
    expect(screen.getByTestId("ix-thread-leave")).toBeTruthy();
  });

  it("lets an added person leave", async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url.endsWith("/api/ix/threads/t1/share")) return jsonResponse(view({ mine: false, member: true, canLeave: true, canChange: false, canAdd: false, canRemove: false }));
      if (url.endsWith("/api/ix/threads/t1/people/u-me") && init?.method === "DELETE") return jsonResponse({ ok: true, left: true });
      return undefined;
    });
    const { screen, trigger } = await renderShare();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId("ix-thread-leave"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/people/u-me") && init?.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("ix-thread-share")).toBeNull());
  });
});

describe("IxMessageSender", () => {
  it("shows the sender above a user message only when the chat has more than one person", async () => {
    let multi = true;
    stubFetch((url) => {
      if (url.endsWith("/api/ix/threads/t1/senders")) return jsonResponse({ multi, senders: [{ sequence: 4, userId: "u-ben", name: "Ben Okafor", email: "ben@example.test" }] });
      return undefined;
    });
    await refreshIxSession();
    const screen = render(<><IxMessageSender row={{ threadId: "t1", messageSeq: 4, initiator: "user" }} /><IxMessageSender row={{ threadId: "t1", messageSeq: 2, initiator: "user" }} /><IxMessageSender row={{ threadId: "t1", messageSeq: 4, initiator: "agent" }} /></>);
    const label = await screen.findByTestId("ix-message-sender");
    expect(label.textContent).toBe("BOBen Okafor");
    expect(screen.getAllByTestId("ix-message-sender")).toHaveLength(1);
    cleanup();
    resetIxThreadSendersForTests();
    multi = false;
    const solo = render(<IxMessageSender row={{ threadId: "t1", messageSeq: 4, initiator: "user" }} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(solo.queryByTestId("ix-message-sender")).toBeNull();
  });
});

describe("IxOrganizationView chat sharing", () => {
  it("lets admins change the workspace sharing policy", async () => {
    let policy = { defaultShare: "private", allowedShares: ["private", "project", "workspace", "people"], whoCanChange: "starter", participantsCanAdd: false, adminsSeeAll: false };
    const puts: unknown[] = [];
    stubFetch((url, init) => {
      if (url.endsWith("/api/ix/me")) return jsonResponse({ actor: { kind: "user", user: { id: "u-me", email: "me@example.test", name: "Me" }, organizationId: "o", memberId: "m-me", role: "owner" }, mode: "team", orgName: "Acme" });
      if (url.endsWith("/api/ix/members")) return jsonResponse({ members: [member("u-me", "Me")] });
      if (url.endsWith("/api/ix/invitations")) return jsonResponse({ invitations: [] });
      if (url.endsWith("/api/ix/access")) return jsonResponse({ mode: "open", projects: [], members: [] });
      if (url.endsWith("/api/ix/desk")) return jsonResponse({ policy: { theme: true, layout: true }, personal: null });
      if (url.endsWith("/api/ix/sharing-policy") && init?.method === "PUT") {
        policy = JSON.parse(String(init.body)) as typeof policy;
        puts.push(policy);
        return jsonResponse({ ok: true, policy });
      }
      if (url.endsWith("/api/ix/sharing-policy")) return jsonResponse({ policy });
      return undefined;
    });
    await refreshIxSession();
    const screen = render(<MemoryRouter><IxOrganizationView /></MemoryRouter>);
    const section = await screen.findByTestId("ix-chat-sharing");
    fireEvent.click(within(section).getByRole("checkbox", { name: "Allow Workspace" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ allowedShares: ["private", "project", "people"] });
    await waitFor(() => expect((within(section).getByRole("checkbox", { name: "Allow Workspace" }) as HTMLInputElement).checked).toBe(false));
    fireEvent.change(within(section).getByRole("combobox", { name: "Who can change sharing" }), { target: { value: "participants" } });
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toMatchObject({ whoCanChange: "participants" });
    fireEvent.click(await within(section).findByRole("button", { name: "Turn on: Owners and admins can open any chat" }));
    await waitFor(() => expect(puts).toHaveLength(3));
    expect(puts[2]).toMatchObject({ adminsSeeAll: true });
    fireEvent.click(within(section).getByRole("checkbox", { name: "Allow Specific people" }));
    await waitFor(() => expect(puts).toHaveLength(4));
    await waitFor(() => expect((within(section).getByRole("checkbox", { name: "Allow Private" }) as HTMLInputElement).disabled).toBe(true));
  });
});
