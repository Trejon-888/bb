import { createFileApplicationLinkApprovals } from "@bb/config/application-link-approvals";

export function listLocalApplicationLinkApprovals(directory: string): string[] {
  return createFileApplicationLinkApprovals(directory).list();
}

export async function revokeLocalApplicationLinkApproval(
  directory: string,
  scheme: string | null,
): Promise<string[]> {
  const approvals = createFileApplicationLinkApprovals(directory);
  await approvals.revoke(scheme);
  return approvals.list();
}
