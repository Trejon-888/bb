import { createElement, type ComponentType } from "react";
import type {
  ExperimentalTabRegistration,
  ExperimentalThreadActionTabProps,
  PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { PluginRegistrationSet } from "./plugin-slots";

export const IX_SIDE_PANEL_PLUGIN_ID = "ix-side-panel";

const wrapped = new WeakMap<ComponentType<PluginNavPanelProps>, ComponentType<ExperimentalThreadActionTabProps>>();

function navPanelInThread(component: ComponentType<PluginNavPanelProps>): ComponentType<ExperimentalThreadActionTabProps> {
  const known = wrapped.get(component);
  if (known !== undefined) return known;
  const InThread: ComponentType<ExperimentalThreadActionTabProps> = () => createElement(component, { subPath: "" });
  wrapped.set(component, InThread);
  generated.add(InThread);
  return InThread;
}

const generated = new WeakSet<ComponentType<ExperimentalThreadActionTabProps>>();

export function isIxNavPanelThreadTab(tab: { component?: unknown }): boolean {
  return typeof tab.component === "function" && generated.has(tab.component as ComponentType<ExperimentalThreadActionTabProps>);
}

export function ixNavPanelThreadTabs(
  set: PluginRegistrationSet,
  tabs: readonly ExperimentalTabRegistration[],
): ExperimentalTabRegistration[] {
  if (tabs.some((tab) => tab.context.kind === "thread")) return [];
  return set.navPanels.map((panel) => ({
    id: `panel-${panel.id}`,
    title: panel.title,
    icon: panel.icon,
    layout: "flush" as const,
    component: navPanelInThread(panel.component),
    context: { kind: "thread" as const },
    availability: "action" as const,
  }));
}
