// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IxAuthGate } from "../IxAuthGate";
import { resetIxSessionForTests } from "../ix-auth";

afterEach(() => {
  cleanup();
  resetIxSessionForTests();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-ix-shell");
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubSession(brand: Record<string, string>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/ix/status"))
      return jsonResponse({
        mode: "team",
        bootstrapped: true,
        orgName: "Advisy",
        brand,
        password: true,
        providers: ["google"],
      });
    if (url.endsWith("/api/ix/me"))
      return jsonResponse(
        { code: "ix_unauthenticated", message: "Sign in" },
        401,
      );
    if (url.endsWith("/api/ix/sign-in"))
      return jsonResponse(
        { code: "ix_bad_credentials", message: "Wrong email or password" },
        401,
      );
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("renders the split Nexus sign-in around the existing form for nexus brands", async () => {
  const fetchMock = stubSession({
    name: "Advisy",
    appTitle: "Nexus",
    shell: "nexus",
    loginTitle: "Your AI employee",
    loginSubtitle: "Built for client teams",
  });
  const view = render(
    <IxAuthGate>
      <div>app</div>
    </IxAuthGate>,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const google = await view.findByRole("button", {
    name: "Continue with Google",
  });
  const layout = view.getByTestId("nexus-sign-in");
  expect(document.documentElement.getAttribute("data-ix-shell")).toBe("nexus");
  expect(
    view.getByRole("complementary", { name: "About Nexus" }).textContent,
  ).toContain("Your AI employee");
  expect(view.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
  expect(view.getByText("Sign in to Advisy")).toBeTruthy();
  expect(layout.contains(google)).toBe(true);
  fireEvent.change(view.getByLabelText("Email"), {
    target: { value: "a@b.test" },
  });
  fireEvent.change(view.getByLabelText("Password"), {
    target: { value: "pw" },
  });
  fireEvent.click(view.getByRole("button", { name: "Sign in" }));
  expect(await view.findByText("Wrong email or password")).toBeTruthy();
  expect(
    fetchMock.mock.calls.some(([input]) =>
      String(input).endsWith("/api/ix/sign-in"),
    ),
  ).toBe(true);
});

it("keeps the centered card for other shells", async () => {
  stubSession({ name: "ECM", shell: "simple" });
  const view = render(
    <IxAuthGate>
      <div>app</div>
    </IxAuthGate>,
  );
  await view.findByRole("button", { name: "Sign in" });
  expect(view.queryByTestId("nexus-sign-in")).toBeNull();
  await waitFor(() =>
    expect(document.documentElement.getAttribute("data-ix-shell")).toBeNull(),
  );
});
