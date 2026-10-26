import {
  invalidateApplicationLinkApprovals,
  writeApplicationLinkApprovals,
} from "@/hooks/cache-owners/application-link-approvals-cache-owner";
import {
  createApplicationLinkApprovals,
  applicationLinkApprovalsSchema,
  APPLICATION_LINK_APPROVALS_STORAGE_KEY,
} from "@bb/domain/application-link-approvals";
import { useQuery } from "@tanstack/react-query";
import { systemConfigQueryOptions } from "@/hooks/queries/system-queries";
import { appQueryClient } from "./app-query-client";
import {
  createApplicationUrlOpener,
  type ApplicationUrl,
  type ApplicationUrlDecision,
} from "@bb/domain/application-url";
import { getBbDesktopInfo } from "./bb-desktop";
import { getNativeShell } from "./native-shell";
import { appToast } from "@/components/ui/app-toast";

const browserApprovals = createApplicationLinkApprovals({
  read: () =>
    window.localStorage.getItem(APPLICATION_LINK_APPROVALS_STORAGE_KEY),
  write: (value) =>
    window.localStorage.setItem(APPLICATION_LINK_APPROVALS_STORAGE_KEY, value),
});

async function manageApplicationLinkApprovals(
  request: { action: "list" } | { action: "revoke"; scheme: string | null },
): Promise<string[]> {
  const desktop = getBbDesktopInfo();
  if (desktop !== null) {
    if (!desktop.applicationLinkApprovals)
      throw new Error(
        "Update the BB desktop app to manage application link approvals.",
      );
    return applicationLinkApprovalsSchema.parse(
      await desktop.applicationLinkApprovals(request),
    );
  }
  const native = getNativeShell();
  if (native !== null) {
    if (native.handshake.bridgeVersion < 4)
      throw new Error(
        "Update the BB mobile app to manage application link approvals.",
      );
    return applicationLinkApprovalsSchema.parse(
      await native.request("application-link-approvals", request),
    );
  }
  if (request.action === "revoke") browserApprovals.revoke(request.scheme);
  return browserApprovals.list();
}

export const applicationLinkApprovals = {
  list: () => manageApplicationLinkApprovals({ action: "list" }),
  revoke: async (scheme: string | null) => {
    const remaining = await manageApplicationLinkApprovals({
      action: "revoke",
      scheme,
    });
    writeApplicationLinkApprovals(appQueryClient, remaining);
    return remaining;
  },
};

let confirmation: {
  target: ApplicationUrl;
  resolve: (decision: ApplicationUrlDecision) => void;
} | null = null;
const listeners = new Set<() => void>();

export const getApplicationUrlConfirmation = () => confirmation;
export function subscribeApplicationUrlConfirmation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resolveApplicationUrlConfirmation(
  decision: ApplicationUrlDecision,
) {
  const current = confirmation;
  confirmation = null;
  for (const listener of listeners) listener();
  current?.resolve(decision);
}

export function useApplicationLinksEnabled(): boolean {
  const { data } = useQuery(
    {
      ...systemConfigQueryOptions(),
      enabled: false,
      select: (config) => config.experiments.applicationLinks,
    },
    appQueryClient,
  );
  return data === true;
}

export function applicationLinksEnabled(): boolean {
  return (
    appQueryClient.getQueryData(systemConfigQueryOptions().queryKey)
      ?.experiments.applicationLinks === true
  );
}

const openBrowserApplicationUrl = createApplicationUrlOpener({
  approvals: browserApprovals,
  confirm: (target) =>
    new Promise<ApplicationUrlDecision>((resolve) => {
      confirmation = { target, resolve };
      for (const listener of listeners) listener();
    }),
  open: (url) => {
    window.location.assign(url);
  },
});

export function openApplicationUrl(url: string): void {
  if (!applicationLinksEnabled()) return;
  void dispatchApplicationUrl(url)
    .finally(() => {
      invalidateApplicationLinkApprovals(appQueryClient);
    })
    .catch((error: unknown) => {
      appToast.error("Couldn't open application link", {
        description:
          error instanceof Error
            ? error.message
            : "Check that the destination app is installed.",
      });
    });
}

async function dispatchApplicationUrl(url: string): Promise<void> {
  const desktop = getBbDesktopInfo();
  if (desktop !== null) {
    if (!desktop.openApplicationUrl)
      throw new Error("Update the BB desktop app to open application links.");
    await desktop.openApplicationUrl(url);
    return;
  }
  const native = getNativeShell();
  if (native !== null) {
    if (native.handshake.bridgeVersion < 3)
      throw new Error("Update the BB mobile app to open application links.");
    await native.request("open-application", { url });
    return;
  }
  await openBrowserApplicationUrl(url);
}
