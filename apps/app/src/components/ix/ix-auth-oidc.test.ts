// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { readOidcContinueFromUrl } from "./ix-auth";

describe("readOidcContinueFromUrl", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("resumes the workspace's authorize step when a site's sign-in request is in the URL", () => {
    window.history.replaceState(null, "", "/?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fapp.example.com%2F__ix%2Fcallback&state=s");
    expect(readOidcContinueFromUrl()).toBe("/api/auth/oauth2/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fapp.example.com%2F__ix%2Fcallback&state=s");
  });

  it("ignores ordinary pages and partial parameters", () => {
    window.history.replaceState(null, "", "/?client_id=c1");
    expect(readOidcContinueFromUrl()).toBeNull();
    window.history.replaceState(null, "", "/projects/p1?response_type=code&client_id=c1&redirect_uri=x");
    expect(readOidcContinueFromUrl()).toBeNull();
  });
});
