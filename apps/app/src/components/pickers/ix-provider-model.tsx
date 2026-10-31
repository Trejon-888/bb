import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { ProviderIcon } from "@/components/plugin/ProviderIcon";
import {
  allSystemExecutionOptionsQueryKeyPrefix,
  allSystemProvidersQueryKeyPrefix,
} from "@/hooks/queries/query-keys";
import { callPluginRpc } from "@/lib/plugin-sdk-hooks";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import type { ProviderPickerOption } from "./model-brand-prefix";

export const IX_PICKER_PROVIDERS = [
  { id: "codex", provider: "codex", label: "Codex" },
  { id: "claude-code", provider: "claude", label: "Claude Code" },
  { id: "acp-gemini", provider: "gemini", label: "Gemini CLI" },
  { id: "acp-grok", provider: "grok", label: "Grok Build" },
] as const;
const accountSchema = z.object({
  provider: z.string(),
  enabled: z.boolean(),
  scope: z.string(),
  status: z.string(),
});
const viewerSchema = z.object({
  canAddPrivate: z.boolean(),
  canAddWorkspace: z.boolean(),
});
export type IxPickerViewer = z.infer<typeof viewerSchema>;
export function ixProviderConnected(
  accounts: readonly z.infer<typeof accountSchema>[],
  provider: string,
  projectId?: string,
): boolean {
  return accounts.some(
    (a) =>
      a.provider === provider &&
      a.enabled &&
      a.status !== "error" &&
      a.status !== "not-allowed" &&
      (a.scope === "private" ||
        a.scope === "workspace" ||
        (projectId !== undefined && a.scope === `project:${projectId}`)),
  );
}
export function ixPickerOptions(
  options: readonly ProviderPickerOption[],
): ProviderPickerOption[] {
  return IX_PICKER_PROVIDERS.map((p) => {
    const existing = options.find((o) => o.value === p.id);
    return {
      ...existing,
      value: p.id,
      label: p.label,
      icon:
        existing?.icon ??
        (({ className }) => (
          <ProviderIcon
            providerKind="agent"
            provider={{
              id: p.id,
              icon:
                p.provider === "gemini"
                  ? "provider-acp/registry-gemini"
                  : "provider-acp/grok",
            }}
            className={className}
          />
        )),
    };
  });
}
export function ixProviderRpc(method: string, input: unknown = null) {
  return callPluginRpc(fetch, "ix-providers", method, input);
}
export function useIxProviderPicker(open: boolean) {
  const panels = usePluginNavPanelChrome();
  const enabled = panels.some((p) => p.chrome.pluginId === "ix-providers");
  const query = useQuery({
    queryKey: ["ix-provider-picker"],
    enabled: enabled && open,
    staleTime: 0,
    queryFn: async () => {
      const [accounts, viewer] = await Promise.all([
        ixProviderRpc("account.list"),
        ixProviderRpc("viewer.get"),
      ]);
      return {
        accounts: z.array(accountSchema).parse(accounts),
        viewer: viewerSchema.parse(viewer),
      };
    },
  });
  return { enabled, query };
}
const pasteSchema = z.object({
  sessionId: z.string(),
  authorizeUrl: z.string().url(),
});
const deviceSchema = z.object({
  sessionId: z.string(),
  verificationUri: z.string().url(),
  userCode: z.string(),
  expiresAt: z.number(),
  intervalMs: z.number().positive(),
});
const pollSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("complete") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
function safeLoginUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error("The provider returned an invalid sign-in URL.");
  return url.href;
}
export function IxProviderConnect({
  providerId,
  viewer,
}: {
  providerId: string;
  viewer: IxPickerViewer;
}) {
  const provider = IX_PICKER_PROVIDERS.find((p) => p.id === providerId);
  const client = useQueryClient();
  const [scope, setScope] = useState(
    viewer.canAddPrivate ? "private" : "workspace",
  );
  const [paste, setPaste] = useState<z.infer<typeof pasteSchema> | null>(null);
  const [device, setDevice] = useState<z.infer<typeof deviceSchema> | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [project, setProject] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = useCallback(async () => {
    await client.invalidateQueries({ queryKey: ["ix-provider-picker"] });
    await Promise.all([
      client.invalidateQueries({
        queryKey: allSystemExecutionOptionsQueryKeyPrefix(),
      }),
      client.invalidateQueries({
        queryKey: allSystemProvidersQueryKeyPrefix(),
      }),
    ]);
  }, [client]);
  useEffect(() => {
    if (!device) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() >= device.expiresAt) {
        setError("Sign-in expired. Connect again to retry.");
        setDevice(null);
        return;
      }
      try {
        const result = pollSchema.parse(
          await ixProviderRpc("codexLogin.poll", {
            sessionId: device.sessionId,
          }),
        );
        if (stopped) return;
        if (result.status === "complete") {
          setDevice(null);
          await connected();
        } else if (result.status === "error") {
          setError(result.message);
          setDevice(null);
        } else timer = setTimeout(poll, device.intervalMs);
      } catch (e) {
        if (!stopped) {
          setError(e instanceof Error ? e.message : "Could not check sign-in.");
          setDevice(null);
        }
      }
    };
    timer = setTimeout(poll, device.intervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [device, connected]);
  if (!provider) return null;
  async function start() {
    if (!provider) return;
    setPending(true);
    setError(null);
    try {
      const method =
        provider.provider === "claude" || provider.provider === "gemini"
          ? "login.start"
          : "codexLogin.start";
      const result = await ixProviderRpc(method, {
        provider: provider.provider,
        scope,
      });
      if (method === "login.start") {
        const step = pasteSchema.parse(result);
        safeLoginUrl(step.authorizeUrl);
        setPaste(step);
      } else {
        const step = deviceSchema.parse(result);
        safeLoginUrl(step.verificationUri);
        setDevice(step);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start sign-in.");
    } finally {
      setPending(false);
    }
  }
  async function complete() {
    if (!paste) return;
    setPending(true);
    setError(null);
    try {
      await ixProviderRpc("login.complete", {
        sessionId: paste.sessionId,
        pasted: code,
        ...(project.trim() ? { googleCloudProject: project.trim() } : {}),
      });
      setCode("");
      setPaste(null);
      await connected();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish sign-in.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div
      className="flex flex-col gap-3 p-3 text-sm"
      aria-label={`Connect ${provider.label}`}
    >
      <div className="font-medium">Connect {provider.label}</div>
      {!paste && !device ? (
        <>
          <p className="text-xs text-muted-foreground">
            Use your subscription to start chatting with {provider.label}.
          </p>
          <fieldset disabled={pending} className="flex flex-col gap-2">
            <legend className="mb-2 text-xs text-muted-foreground">
              Who can use this connection?
            </legend>
            {viewer.canAddPrivate ? (
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`scope-${providerId}`}
                  checked={scope === "private"}
                  onChange={() => setScope("private")}
                />
                <span>
                  Personal
                  <span className="block text-xs text-muted-foreground">
                    Only your chats
                  </span>
                </span>
              </label>
            ) : null}
            {viewer.canAddWorkspace ? (
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`scope-${providerId}`}
                  checked={scope === "workspace"}
                  onChange={() => setScope("workspace")}
                />
                <span>
                  Workspace
                  <span className="block text-xs text-muted-foreground">
                    Everyone in this workspace
                  </span>
                </span>
              </label>
            ) : null}
          </fieldset>
          {viewer.canAddPrivate || viewer.canAddWorkspace ? (
            <Button size="sm" disabled={pending} onClick={() => void start()}>
              {pending ? "Connecting…" : `Connect ${provider.label}`}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Ask a workspace admin to connect this provider.
            </p>
          )}
        </>
      ) : null}
      {paste ? (
        <>
          <a
            className="underline"
            href={safeLoginUrl(paste.authorizeUrl)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Sign in to {provider.label}
          </a>
          <label className="flex flex-col gap-1 text-xs">
            Paste the code from the sign-in page
            <Input
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {provider.provider === "gemini" ? (
            <label className="flex flex-col gap-1 text-xs">
              Google Cloud project (company Google accounts)
              <Input
                value={project}
                onChange={(e) => setProject(e.target.value)}
              />
            </label>
          ) : null}
          <Button
            size="sm"
            disabled={pending || !code.trim()}
            onClick={() => void complete()}
          >
            {pending ? "Connecting…" : "Finish connection"}
          </Button>
        </>
      ) : null}
      {device ? (
        <>
          <p className="text-xs text-muted-foreground">
            Enter this code on the provider’s sign-in page:
          </p>
          <code className="select-all rounded bg-muted p-2 text-center font-mono">
            {device.userCode}
          </code>
          <a
            className="underline"
            href={safeLoginUrl(device.verificationUri)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Sign in to {provider.label}
          </a>
          <p className="text-xs text-muted-foreground">Waiting for sign-in…</p>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
