import { useMemo } from "react";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import { currentIxRole, roleAtLeast } from "@/components/ix/ix-auth";
import {
  AUTOMATIONS_PLUGIN_ID,
  getAutomationsRoutePath,
} from "@/lib/route-paths";
import {
  NEXUS_SITES_PATH,
  NEXUS_SITES_PLUGIN_ID,
  NEXUS_SITES_FALLBACK_PATH,
  NEXUS_ASSETS_PATH,
  NEXUS_ASSETS_PLUGIN_ID,
  NEXUS_DEFAULT_DOCS,
  NEXUS_CONNECTORS_PATH,
  NEXUS_CONNECTORS_PLUGIN_ID,
  NEXUS_DEFAULT_INTEGRATIONS,
  NEXUS_SCHEDULED_PATH,
  NEXUS_WORKFLOWS,
  NEXUS_WORKFLOWS_PLUGIN_ID,
  NEXUS_MEMORY_PATH,
  NEXUS_MEMORY_PLUGIN_ID,
  NEXUS_BROWSER_PATH,
  NEXUS_BROWSER_PLUGIN_ID,
  NEXUS_PROVIDERS_PATH,
  NEXUS_PROVIDERS_PLUGIN_ID,
  NEXUS_CAPACITY_PATH,
  NEXUS_CAPACITY_PLUGIN_ID,
  NEXUS_SKILLS_PATH,
  NEXUS_SKILLS_PLUGIN_ID,
  NEXUS_SKILLS_FALLBACK_PATH,
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
  const hasWorkflows = panels.some(
    (entry) => entry.chrome.pluginId === NEXUS_WORKFLOWS_PLUGIN_ID,
  );
  const hasMemory = panels.some(
    (entry) => entry.chrome.pluginId === NEXUS_MEMORY_PLUGIN_ID,
  );
  const hasBrowser = panels.some(
    (entry) => entry.chrome.pluginId === NEXUS_BROWSER_PLUGIN_ID,
  );
  const hasProviders = panels.some(
    (entry) => entry.chrome.pluginId === NEXUS_PROVIDERS_PLUGIN_ID,
  );
  const hasCapacity = panels.some(
    (entry) => entry.chrome.pluginId === NEXUS_CAPACITY_PLUGIN_ID,
  ) && roleAtLeast(currentIxRole(), "admin");
  const hasSkills = panels.some(
    (entry) => entry.chrome.pluginId === NEXUS_SKILLS_PLUGIN_ID,
  );
  return useMemo(
    () => ({
      scheduled: hasWorkflows
        ? NEXUS_WORKFLOWS
        : {
            label: "Scheduled",
            to: hasAutomations ? getAutomationsRoutePath() : NEXUS_SCHEDULED_PATH,
            icon: "TimeSchedule",
          },
      integrations: hasConnectors
        ? { label: "Connectors", to: NEXUS_CONNECTORS_PATH }
        : NEXUS_DEFAULT_INTEGRATIONS,
      docs: hasAssets
        ? { label: "Assets", to: NEXUS_ASSETS_PATH, icon: "Folder02" }
        : NEXUS_DEFAULT_DOCS,
      sites: hasSites ? NEXUS_SITES_PATH : NEXUS_SITES_FALLBACK_PATH,
      memory: hasMemory ? NEXUS_MEMORY_PATH : null,
      browser: hasBrowser ? NEXUS_BROWSER_PATH : null,
      providers: hasProviders ? NEXUS_PROVIDERS_PATH : null,
      capacity: hasCapacity ? NEXUS_CAPACITY_PATH : null,
      skills: hasSkills ? NEXUS_SKILLS_PATH : NEXUS_SKILLS_FALLBACK_PATH,
    }),
    [hasAutomations, hasWorkflows, hasConnectors, hasAssets, hasSites, hasMemory, hasBrowser, hasProviders, hasCapacity, hasSkills],
  );
}
