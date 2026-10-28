// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IxAuthGate, readableTextOn } from "./IxAuthGate";
import { resetIxSessionForTests } from "./ix-auth";

const originalLocation = window.location;

afterEach(() => {
  cleanup();
  resetIxSessionForTests();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { value: originalLocation, configurable: true });
});

type Route = (url: string, init: RequestInit | undefined) => Response | undefined;

function stubFetch(route: Route): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const response = route(url, init);
    if (response !== undefined) return response;
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const teamStatus = { mode: "team", bootstrapped: true, orgName: "Acme", brand: {}, password: true, providers: ["google", "github"] };

it("offers each configured provider and starts the redirect through better-auth", async () => {
  const assign = vi.fn();
  Object.defineProperty(window, "location", { value: { ...originalLocation, origin: originalLocation.origin, search: "", href: originalLocation.href, assign }, configurable: true });
  const fetchMock = stubFetch((url) => {
    if (url.endsWith("/api/ix/status")) return jsonResponse(teamStatus);
    if (url.endsWith("/api/ix/me")) return jsonResponse({ code: "ix_unauthenticated", message: "Sign in" }, 401);
    if (url.endsWith("/api/auth/sign-in/social")) return jsonResponse({ url: "https://accounts.google.com/o/oauth2/auth?x=1", redirect: true });
    return undefined;
  });
  const view = render(<IxAuthGate><div>app</div></IxAuthGate>);
  await view.findByRole("button", { name: "Continue with Google" });
  expect(view.getByRole("button", { name: "Continue with GitHub" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Continue with Microsoft" })).toBeNull();
  expect(view.getByRole("button", { name: "Sign in" })).toBeTruthy();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  fireEvent.click(view.getByRole("button", { name: "Continue with Google" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/auth?x=1"));
  const call = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/api/auth/sign-in/social"));
  expect(call?.[1]).toMatchObject({ method: "POST", credentials: "include" });
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ provider: "google", callbackURL: `${originalLocation.origin}/` });
});

it("shows a no-access screen with sign-out for a signed-in non-member", async () => {
  let signedOut = false;
  stubFetch((url) => {
    if (url.endsWith("/api/ix/status")) return jsonResponse(teamStatus);
    if (url.endsWith("/api/ix/me")) {
      return signedOut
        ? jsonResponse({ code: "ix_unauthenticated", message: "Sign in" }, 401)
        : jsonResponse({ code: "ix_not_member", message: "This account has no access to this workspace. Ask an admin for an invitation." }, 403);
    }
    if (url.endsWith("/api/ix/sign-out")) {
      signedOut = true;
      return jsonResponse({ ok: true });
    }
    return undefined;
  });
  const view = render(<IxAuthGate><div>app</div></IxAuthGate>);
  expect(await view.findByText("This account has no access to this workspace. Ask an admin for an invitation.")).toBeTruthy();
  expect(view.queryByText("app")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Sign out" }));
  expect(await view.findByRole("button", { name: "Continue with Google" })).toBeTruthy();
});

describe("readableTextOn", () => {
  it("picks white on dark accents and near-black on light ones", () => {
    expect(readableTextOn("#193f32")).toBe("#ffffff");
    expect(readableTextOn("#1AE5BE")).toBe("#0a0a0a");
    expect(readableTextOn("#000000")).toBe("#ffffff");
    expect(readableTextOn("#ffffff")).toBe("#0a0a0a");
    expect(readableTextOn("not-a-color")).toBe("#ffffff");
  });
});
