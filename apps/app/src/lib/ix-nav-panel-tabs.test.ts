import { afterEach, describe, expect, it } from "vitest";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { getPluginSlotSnapshot, resetPluginSlotStoreForTest, setPluginSlotRegistrations } from "./plugin-slots";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";

function SitesPage(_props: PluginNavPanelProps) {
  return null;
}

afterEach(() => resetPluginSlotStoreForTest());

describe("sidebar pages open in the chat side panel", () => {
  it("offers each plugin page as a chat side-panel tab", () => {
    setPluginSlotRegistrations("ix-sites", registrationSet({ navPanels: [{ id: "sites", title: "Sites", icon: "Layers", path: "sites", component: SitesPage }] }));
    const [tab] = getPluginSlotSnapshot().threadPanelActions;
    expect(tab).toMatchObject({ pluginId: "ix-sites", id: "panel-sites", title: "Sites", icon: "Layers", layout: "flush" });
  });

  it("keeps a plugin's own side-panel tab instead of adding its page twice", () => {
    const Viewer = () => null;
    setPluginSlotRegistrations("ix-browser", registrationSet({
      navPanels: [{ id: "ix-browser", title: "IX Browser", icon: "Browser", path: "ix-browser", component: SitesPage }],
      threadPanelActions: [{ id: "ix-browser", title: "IX Browser", component: Viewer }],
    }));
    expect(getPluginSlotSnapshot().threadPanelActions.map((action) => action.id)).toEqual(["ix-browser"]);
  });
});
