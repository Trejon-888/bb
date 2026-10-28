import { useMemo } from "react";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import {
  AUTOMATIONS_PLUGIN_ID,
  getAutomationsRoutePath,
} from "@/lib/route-paths";
import { NEXUS_SCHEDULED_PATH, type NexusNavTargets } from "./nexus-model";

export function useNexusNavTargets(): NexusNavTargets {
  const panels = usePluginNavPanelChrome();
  const hasAutomations = panels.some(
    (entry) => entry.chrome.pluginId === AUTOMATIONS_PLUGIN_ID,
  );
  return useMemo(
    () => ({
      scheduled: hasAutomations
        ? getAutomationsRoutePath()
        : NEXUS_SCHEDULED_PATH,
    }),
    [hasAutomations],
  );
}
