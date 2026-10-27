import { appQueryClient } from "@/lib/app-query-client";
import { applicationLinkApprovalsQueryKey } from "@/hooks/cache-owners/application-link-approvals-cache-owner";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import { applicationLinkApprovals } from "@/lib/application-url";
import { appToast } from "@/components/ui/app-toast";
import { SettingsWithControl } from "@/components/ui/settings-section";

export function ApplicationLinkApprovalsSettings() {
  const approvals = useQuery(
    {
      queryKey: applicationLinkApprovalsQueryKey,
      queryFn: applicationLinkApprovals.list,
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
    appQueryClient,
  );
  const revoke = async (scheme: string | null) => {
    try {
      await applicationLinkApprovals.revoke(scheme);
    } catch (error) {
      appToast.error("Couldn't reset application link approvals", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  };
  return (
    <SettingsWithControl
      label="Application link approvals"
      description="App links you've allowed to open without asking on this device. These choices apply only to this BB site and don't sync to other devices or app profiles."
      controlPlacement="below"
    >
      {approvals.isPending ? (
        <p className="text-sm">Loading approvals…</p>
      ) : approvals.isError ? (
        <p className="text-sm">{approvals.error.message}</p>
      ) : approvals.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No saved approvals. BB asks before opening an app.
        </p>
      ) : (
        <div className="space-y-3">
          {approvals.data.map((scheme) => (
            <div
              key={scheme}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-sm">{scheme}:</span>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Ask again for ${scheme} links`}
                onClick={() => {
                  void revoke(scheme);
                }}
              >
                Ask again
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => {
              void revoke(null);
            }}
          >
            Reset all approvals
          </Button>
        </div>
      )}
    </SettingsWithControl>
  );
}
