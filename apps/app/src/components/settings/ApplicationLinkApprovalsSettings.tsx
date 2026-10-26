import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import { applicationLinkApprovals } from "@/lib/application-url";
import { appToast } from "@/components/ui/app-toast";
import { SettingsSection } from "@/components/ui/settings-section";

export function ApplicationLinkApprovalsSettings() {
  const queryClient = useQueryClient();
  const queryKey = ["device-application-link-approvals"];
  const approvals = useQuery({
    queryKey,
    queryFn: applicationLinkApprovals.list,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const revoke = async (scheme: string | null) => {
    try {
      const remaining = await applicationLinkApprovals.revoke(scheme);
      queryClient.setQueryData(queryKey, remaining);
    } catch (error) {
      appToast.error("Couldn't reset application link approvals", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  };
  return (
    <SettingsSection title="Application link approvals">
      <p className="text-sm text-muted-foreground">
        Apps you've allowed to open without asking on this device. Browser
        approvals apply only to this BB site in this browser. These choices
        don't sync to other devices.
      </p>
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
    </SettingsSection>
  );
}
