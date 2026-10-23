import {
  readDefaultBranchRefs,
  hasRef,
  readBranchRelation,
  type DefaultBranchRelation,
} from "bb-environment-provider-host/git";
import type { WorktreeBaseBranch } from "../contract.js";

interface ResolveDefaultWorktreeBaseBranchArgs {
  defaultBranch: string | null;
  defaultBranchRelation: DefaultBranchRelation | null;
  originDefaultBranch: string | null;
}

function selectWorktreeBaseBranch(
  args: ResolveDefaultWorktreeBaseBranchArgs,
): string | null {
  if (!args.originDefaultBranch) {
    return args.defaultBranch;
  }
  if (!args.defaultBranch) {
    return args.originDefaultBranch;
  }
  if (
    args.defaultBranchRelation === "equal" ||
    args.defaultBranchRelation === "local-behind"
  ) {
    return args.originDefaultBranch;
  }
  return args.defaultBranch;
}

export async function resolveWorktreeBaseBranch(
  sourcePath: string,
  requested: WorktreeBaseBranch,
): Promise<string | null> {
  if (requested.kind === "named") {
    if (
      requested.name.startsWith("refs/") ||
      (await hasRef(sourcePath, `refs/remotes/${requested.name}`))
    )
      return requested.name;
    const localBranch = (await hasRef(
      sourcePath,
      `refs/heads/${requested.name}`,
    ))
      ? requested.name
      : null;
    const remoteBranch = (await hasRef(
      sourcePath,
      `refs/remotes/origin/${requested.name}`,
    ))
      ? `origin/${requested.name}`
      : null;
    if (!remoteBranch) return requested.name;
    return selectWorktreeBaseBranch({
      defaultBranch: localBranch,
      originDefaultBranch: remoteBranch,
      defaultBranchRelation:
        (await readBranchRelation(
          sourcePath,
          localBranch ?? undefined,
          remoteBranch,
        )) ?? null,
    });
  }
  const refs = await readDefaultBranchRefs(sourcePath);
  const resolved = selectWorktreeBaseBranch({
    defaultBranch: refs.defaultBranch ?? null,
    defaultBranchRelation: refs.defaultBranchRelation ?? null,
    originDefaultBranch: refs.originDefaultBranch ?? null,
  });
  return resolved;
}
