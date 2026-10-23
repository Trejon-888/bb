import {
  readDefaultBranchRefs,
  hasRef,
  type DefaultBranchRelation,
} from "bb-environment-provider-host/git";
import type { WorktreeBaseBranch } from "../contract.js";

interface ResolveDefaultWorktreeBaseBranchArgs {
  defaultBranch: string | null;
  defaultBranchRelation: DefaultBranchRelation | null;
  originDefaultBranch: string | null;
}

function resolveDefaultWorktreeBaseBranch(
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
    if (await hasRef(sourcePath, `refs/remotes/${requested.name}`))
      return requested.name;
    return !requested.name.startsWith("refs/") &&
      (await hasRef(sourcePath, `refs/remotes/origin/${requested.name}`))
      ? `origin/${requested.name}`
      : requested.name;
  }
  const refs = await readDefaultBranchRefs(sourcePath);
  const resolved = resolveDefaultWorktreeBaseBranch({
    defaultBranch: refs.defaultBranch ?? null,
    defaultBranchRelation: refs.defaultBranchRelation ?? null,
    originDefaultBranch: refs.originDefaultBranch ?? null,
  });
  return resolved;
}
