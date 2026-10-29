import { describe, expect, it } from "vitest";
import { matchPluginHttpRoute } from "../../../src/services/plugins/plugin-service.js";

const routes = [
  { method: "POST", path: "/gemini/v1beta/models/gemini-2.5-pro:generateContent" },
  { method: "POST", path: "/gemini/v1beta/models/*" },
  { method: "POST", path: "/gemini/*" },
  { method: "GET", path: "/v1/models" },
];

describe("matchPluginHttpRoute", () => {
  it("prefers an exact route", () => {
    expect(
      matchPluginHttpRoute(routes, "post", "/gemini/v1beta/models/gemini-2.5-pro:generateContent"),
    ).toBe(routes[0]);
  });

  it("falls back to the longest matching prefix route", () => {
    expect(
      matchPluginHttpRoute(routes, "POST", "/gemini/v1beta/models/gemini-9:streamGenerateContent"),
    ).toBe(routes[1]);
    expect(matchPluginHttpRoute(routes, "POST", "/gemini/v1/other")).toBe(routes[2]);
  });

  it("never matches the bare prefix, another method, or unrelated paths", () => {
    expect(matchPluginHttpRoute(routes, "POST", "/gemini/v1beta/models/")).toBe(routes[2]);
    expect(matchPluginHttpRoute(routes, "GET", "/gemini/v1beta/models/x")).toBeUndefined();
    expect(matchPluginHttpRoute(routes, "POST", "/v1/messages")).toBeUndefined();
    expect(matchPluginHttpRoute(routes, "GET", "/v1/models")).toBe(routes[3]);
  });
});
