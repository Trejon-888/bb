import { useMemo } from "react";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import {
  AUTOMATIONS_PLUGIN_ID,
  getAutomationsRoutePath,
} from "@/lib/route-paths";
import {
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
  return useMemo(
    () => ({
      scheduled: hasAutomations
        ? getAutomationsRoutePath()
        : NEXUS_SCHEDULED_PATH,
      integrations: hasConnectors
        ? { label: "Connectors", to: NEXUS_CONNECTORS_PATH }
        : NEXUS_DEFAULT_INTEGRATIONS,
    }),
    [hasAutomations, hasConnectors],
  );
}
