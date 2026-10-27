import { z } from "zod";

export const experimentKeys = [
  "agentCpuPriority",
  "changelogPreview",
  "compactExpiredCache",
  "serverMove",
  "performanceDiagnostics",
  "sidebarMultiSelect",
  "timelinePush",
  "unreadDividerAtAnswer",
] as const;
export const experimentKeySchema = z.enum(experimentKeys);
export type ExperimentKey = z.infer<typeof experimentKeySchema>;

export const experimentsSchema = z.record(experimentKeySchema, z.boolean());
export type Experiments = z.infer<typeof experimentsSchema>;

export const experimentUpdatesSchema = z.partialRecord(
  experimentKeySchema,
  z.boolean(),
);
export type ExperimentUpdates = z.infer<typeof experimentUpdatesSchema>;

export const defaultExperiments: Experiments = {
  agentCpuPriority: false,
  changelogPreview: false,
  compactExpiredCache: false,
  serverMove: false,
  performanceDiagnostics: false,
  sidebarMultiSelect: false,
  timelinePush: false,
  unreadDividerAtAnswer: false,
};

export const earlyAdopterExperiments: Experiments = {
  agentCpuPriority: true,
  changelogPreview: false,
  compactExpiredCache: true,
  serverMove: false,
  performanceDiagnostics: false,
  sidebarMultiSelect: true,
  timelinePush: true,
  unreadDividerAtAnswer: false,
};
