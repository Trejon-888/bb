import type { WorkspaceDescriptor } from "@bb/domain";
import { describeWorkspace } from "bb-environment-provider-host/git";
import type { ProvisioningTranscriptEntry, WorkspaceStatus } from "@bb/domain";
import { pathExists } from "@bb/process-utils";
import type {
  CommitOptions,
  LocalStateSnapshot,
  CommitResult,
  DiffOptions,
  DiffResult,
  DiffFilesArgs,
  DiffFilesResult,
  DiffPatchArgs,
  DiffPatchEntry,
  StatusOptions,
} from "./workspace.js";
import { Workspace } from "./workspace.js";
import {
  readDefaultBranch,
  WorkspaceError,
  type SharedGitRefsSnapshot,
  type GitProcessOptions,
} from "./git.js";
import { resolveAdditionalWorkspaceWriteRoots } from "./workspace-write-roots.js";

type ProvisionProgressCallback = (entry: ProvisioningTranscriptEntry) => void;

function createProvisionCancelledError(cause?: unknown): WorkspaceError {
  return new WorkspaceError(
    "provision_cancelled",
    "Workspace provisioning was cancelled",
    { cause },
  );
}

export function throwIfProvisionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createProvisionCancelledError(signal.reason);
  }
}

interface ProvisionBase {
  onProgress?: ProvisionProgressCallback;
  shellPath?: string;
  signal?: AbortSignal;
}

interface UnmanagedWorkspaceOpts extends ProvisionBase {
  descriptor?: WorkspaceDescriptor;
  path: string;
}

export type ProvisionWorkspaceArgs = UnmanagedWorkspaceOpts;

const WORKSPACE_BRANCH_GIT_TIMEOUT_MS = 15_000;

export interface HostWorkspace {
  readonly descriptor: WorkspaceDescriptor;
  readonly path: string;
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;

  getDefaultBranch(): Promise<string | null>;
  getCurrentBranch(): Promise<string | null>;
  getHeadSha(): Promise<string | null>;
  getLocalStateSnapshot(): Promise<LocalStateSnapshot>;
  getSharedGitRefsSnapshot(): Promise<SharedGitRefsSnapshot>;
  getAdditionalWorkspaceWriteRoots(): Promise<string[]>;
  getStatus(options?: StatusOptions): Promise<WorkspaceStatus>;
  getDiff(options?: DiffOptions): Promise<DiffResult>;
  diffFiles(args: DiffFilesArgs): Promise<DiffFilesResult>;
  diffPatch(args: DiffPatchArgs): Promise<DiffPatchEntry[]>;

  commit(options: CommitOptions): Promise<CommitResult>;
}

class ProvisionedHostWorkspace implements HostWorkspace {
  readonly descriptor: WorkspaceDescriptor;
  readonly path: string;
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;

  private readonly ws: Workspace;
  private readonly gitProcessOptions: GitProcessOptions;

  constructor(opts: { descriptor: WorkspaceDescriptor; shellPath?: string }) {
    this.descriptor = opts.descriptor;
    this.path = opts.descriptor.path;
    this.isGitRepo = opts.descriptor.isGitRepo;
    this.isWorktree = opts.descriptor.isWorktree;
    this.gitProcessOptions = {
      ...(opts.shellPath !== undefined ? { shellPath: opts.shellPath } : {}),
    };
    this.ws = new Workspace(
      this.descriptor.repoRoot ?? this.path,
      this.gitProcessOptions,
      this.isGitRepo,
    );
  }

  async getCurrentBranch(): Promise<string | null> {
    return (await this.ws.currentBranch) ?? null;
  }

  async getDefaultBranch(): Promise<string | null> {
    if (!this.isGitRepo) {
      return null;
    }
    return (
      (await readDefaultBranch(this.path, {
        timeoutMs: WORKSPACE_BRANCH_GIT_TIMEOUT_MS,
        ...this.gitProcessOptions,
      })) ?? null
    );
  }

  getHeadSha(): Promise<string | null> {
    return this.ws.getHeadSha();
  }

  getLocalStateSnapshot(): Promise<LocalStateSnapshot> {
    return this.ws.getLocalStateSnapshot();
  }

  getSharedGitRefsSnapshot(): Promise<SharedGitRefsSnapshot> {
    return this.ws.getSharedGitRefsSnapshot();
  }

  getAdditionalWorkspaceWriteRoots(): Promise<string[]> {
    if (!this.isGitRepo || !this.isWorktree) {
      return Promise.resolve([]);
    }
    return resolveAdditionalWorkspaceWriteRoots(
      this.path,
      this.gitProcessOptions,
    );
  }

  getStatus(options?: StatusOptions): Promise<WorkspaceStatus> {
    return this.ws.getStatus(options);
  }

  getDiff(options?: DiffOptions): Promise<DiffResult> {
    return this.ws.getDiff(options);
  }

  diffFiles(args: DiffFilesArgs): Promise<DiffFilesResult> {
    return this.ws.diffFiles(args);
  }

  diffPatch(args: DiffPatchArgs): Promise<DiffPatchEntry[]> {
    return this.ws.diffPatch(args);
  }

  commit(options: CommitOptions): Promise<CommitResult> {
    return this.ws.commit(options);
  }
}

export function provisionWorkspace(
  opts: ProvisionWorkspaceArgs,
): Promise<HostWorkspace> {
  return provisionUnmanaged(opts);
}

async function provisionUnmanaged(
  opts: UnmanagedWorkspaceOpts,
): Promise<HostWorkspace> {
  throwIfProvisionAborted(opts.signal);
  if (!(await pathExists(opts.path))) {
    throw new WorkspaceError(
      "path_not_found",
      `Unmanaged workspace path does not exist: ${opts.path}`,
    );
  }
  if (opts.descriptor && opts.descriptor.path !== opts.path) {
    throw new WorkspaceError(
      "workspace_type_mismatch",
      "Workspace descriptor does not match its execution directory",
    );
  }
  const descriptor =
    opts.descriptor ??
    (await describeWorkspace(opts.path, {
      ...(opts.shellPath !== undefined ? { shellPath: opts.shellPath } : {}),
    }));

  return new ProvisionedHostWorkspace({
    descriptor,
    shellPath: opts.shellPath,
  });
}
