import { useMemo } from "react";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import {
  AUTOMATIONS_PLUGIN_ID,
  getAutomationsRoutePath,
} from "@/lib/route-paths";
import {
  NEXUS_SITES_PATH,
  NEXUS_SITES_PLUGIN_ID,
  NEXUS_SPACES_PATH,
  NEXUS_ASSETS_PATH,
  NEXUS_ASSETS_PLUGIN_ID,
  NEXUS_DEFAULT_DOCS,
  NEXUS_CONNECTORS_PATH,
  NEXUS_CONNECTORS_PLUGIN_ID,
  NEXUS_DEFAULT_INTEGRATIONS,
  NEXUS_SCHEDULED_PATH,
  type NexusNavTargets,
} from "./nexus-model";

export function useNexusNavTargets(): NexusNavTargets {
  const panels = usePluginNavPanelChrome();
  const hasAutomations = panels.some(
    (entry) => entry.chrome.pluginId === AUTOMATIONS_PLUGIN_ID,
  );
  const hasConnectors = panels.some(
    (entry) => entry.chrome.pluginId === NEXUS_CONNECTORS_PLUGIN_ID,
  );
  const hasAssets = panels.some(
    (entry) => entry.chrome.pluginId === NEXUS_ASSETS_PLUGIN_ID,
  );
  const hasSites = panels.some(
    (entry) => entry.chrome.pluginId === NEXUS_SITES_PLUGIN_ID,
  );
  return useMemo(
    () => ({
      scheduled: hasAutomations
        ? getAutomationsRoutePath()
        : NEXUS_SCHEDULED_PATH,
      integrations: hasConnectors
        ? { label: "Connectors", to: NEXUS_CONNECTORS_PATH }
        : NEXUS_DEFAULT_INTEGRATIONS,
      docs: hasAssets
        ? { label: "Assets", to: NEXUS_ASSETS_PATH, icon: "Folder02" }
        : NEXUS_DEFAULT_DOCS,
      spaces: hasSites ? NEXUS_SITES_PATH : NEXUS_SPACES_PATH,
    }),
    [hasAutomations, hasConnectors, hasAssets, hasSites],
  );
}
