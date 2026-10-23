import type { WorkspaceDescriptor, EnvironmentStatus } from "@bb/domain";
import type { WorkspaceContext } from "@bb/host-daemon-contract";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";

interface WorkspaceCommandTargetEnvironment extends Omit<
  WorkspaceDescriptor,
  "path"
> {
  hostId: string;
  id: string;
  path: string | null;
  status: EnvironmentStatus;
}

export interface WorkspaceCommandTarget {
  environmentId: string;
  hostId: string;
  workspaceContext: WorkspaceContext;
}

export function workspaceContextFromEnvironment(
  target: WorkspaceDescriptor,
): WorkspaceContext {
  return {
    workspacePath: target.path,
    ...(target.repoRoot !== null || !target.isGitRepo
      ? {
          descriptor: {
            path: target.path,
            repoRoot: target.repoRoot,
            isGitRepo: target.isGitRepo,
            isWorktree: target.isWorktree,
            branchName: target.branchName,
            defaultBranch: target.defaultBranch,
          },
        }
      : {}),
  };
}

export function requireWorkspaceCommandTarget(
  environment: WorkspaceCommandTargetEnvironment,
): WorkspaceCommandTarget {
  if (environment.status !== "ready" || !environment.path) {
    throwEnvironmentNotReady(environment);
  }

  return {
    environmentId: environment.id,
    hostId: environment.hostId,
    workspaceContext: workspaceContextFromEnvironment({
      ...environment,
      path: environment.path,
    }),
  };
}

export function workspaceReadCacheKey(target: WorkspaceCommandTarget): string {
  return JSON.stringify(target.workspaceContext);
}
