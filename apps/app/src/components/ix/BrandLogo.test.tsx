// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { applyBrandIcons } from "@/lib/ix/brand";
import { BrandLogo } from "./BrandLogo";
import { loadIxStatus, resetIxSessionForTests } from "./ix-auth";

afterEach(() => {
  cleanup();
  resetIxSessionForTests();
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
});

function stubStatus(brand: Record<string, string>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ mode: "off", bootstrapped: false, orgName: null, brand, password: true, providers: [] }), { status: 200 })),
  );
}

it("renders the original logo until a brand logo is set, then the brand image", async () => {
  const view = render(
    <BrandLogo alt="Acme" className="size-4">
      <span data-testid="original" />
    </BrandLogo>,
  );
  expect(view.getByTestId("original")).toBeTruthy();
  stubStatus({ logoUrl: "/api/ix/brand/assets/logo?v=abc" });
  await act(async () => {
    await loadIxStatus();
  });
  expect(view.queryByTestId("original")).toBeNull();
  expect(view.getByRole("img", { name: "Acme" }).getAttribute("src")).toBe("/api/ix/brand/assets/logo?v=abc");
});

it("swaps the favicon and apple-touch-icon links and restores them when cleared", () => {
  document.head.innerHTML =
    '<link rel="icon" id="favicon-32" href="/favicon-32x32.png"><link rel="icon" id="favicon-16" href="/favicon-16x16.png"><link rel="apple-touch-icon" id="apple-touch-icon" href="/apple-touch-icon.png">';
  applyBrandIcons({ faviconUrl: "/api/ix/brand/assets/favicon?v=1" });
  const icons = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
  expect(icons.map((link) => link.getAttribute("href"))).toEqual(["/api/ix/brand/assets/favicon?v=1"]);
  expect(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.getAttribute("href")).toBe("/api/ix/brand/assets/favicon?v=1");

  applyBrandIcons({ faviconUrl: "/api/ix/brand/assets/favicon?v=2", iconUrl: "/api/ix/brand/assets/icon?v=9" });
  expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  expect(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.getAttribute("href")).toBe("/api/ix/brand/assets/icon?v=9");

  applyBrandIcons({});
  expect(Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')).map((link) => link.id)).toEqual(["favicon-32", "favicon-16"]);
  expect(document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.id).toBe("apple-touch-icon");
});

it("creates an icon link when the page has none", () => {
  applyBrandIcons({ faviconUrl: "/brand.ico" });
  expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute("href")).toBe("/brand.ico");
});
