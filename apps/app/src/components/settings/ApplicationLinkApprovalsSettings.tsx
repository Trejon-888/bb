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
      description="App links you've chosen to always allow on this device. Choose Ask again to restore confirmation."
      controlPlacement="below"
    >
      <div className="space-y-3">
        {approvals.isPending ? (
          <p className="text-sm">Loading approvals…</p>
        ) : approvals.isError ? (
          <p className="text-sm">{approvals.error.message}</p>
        ) : approvals.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved approvals. Choose Always allow when opening an app link to
            add it here.
          </p>
        ) : (
          <>
            <div className="divide-y divide-border">
              {approvals.data.map((scheme) => (
                <div
                  key={scheme}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{scheme}:</p>
                    <p className="mt-0.5 text-xs text-subtle-foreground">
                      Opens without asking
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    aria-label={`Ask again for ${scheme} links`}
                    onClick={() => {
                      void revoke(scheme);
                    }}
                  >
                    Ask again
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex justify-end border-t border-border pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void revoke(null);
                }}
              >
                Reset all approvals
              </Button>
            </div>
          </>
        )}
        <p className="text-xs leading-snug text-subtle-foreground">
          Only for this BB site. Approvals aren't shared with other browsers,
          apps, or devices.
        </p>
      </div>
    </SettingsWithControl>
  );
}
