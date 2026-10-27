import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import {
  clearInviteTokenFromUrl,
  ixRequest,
  readInviteTokenFromUrl,
  setCurrentIxRole,
  useIxMe,
  useIxRefresh,
  useIxStatus,
  type IxStatus,
} from "./ix-auth";

type Screen = "sign-in" | "bootstrap" | "invite";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block text-sm">
      <span className="mb-1 block text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function AuthForm({ status, screen, inviteToken, onDone, onSwitch }: { status: IxStatus; screen: Screen; inviteToken: string | null; onDone: () => void; onSwitch: (next: Screen) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState(status.orgName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (screen === "bootstrap") {
        await ixRequest("/bootstrap", { method: "POST", body: { email, password, name, orgName: orgName || undefined } });
      } else if (screen === "invite" && inviteToken !== null) {
        await ixRequest("/invitations/accept", { method: "POST", body: { token: inviteToken, name, password } });
        clearInviteTokenFromUrl();
      } else {
        await ixRequest("/sign-in", { method: "POST", body: { email, password } });
      }
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const title = screen === "bootstrap" ? "Create the owner account" : screen === "invite" ? "Accept your invitation" : "Sign in";
  const subtitle =
    screen === "bootstrap"
      ? "This server has no owner yet. The first account becomes the owner."
      : screen === "invite"
        ? "Choose a name and a password to join this workspace."
        : status.orgName
          ? `Sign in to ${status.orgName}`
          : "Sign in to this server";

  return (
    <Shell title={title} subtitle={subtitle}>
      <form onSubmit={submit}>
        {screen !== "invite" && (
          <Field label="Email">
            <Input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
        )}
        {screen !== "sign-in" && (
          <Field label="Your name">
            <Input type="text" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
        )}
        <Field label="Password">
          <Input type="password" autoComplete={screen === "sign-in" ? "current-password" : "new-password"} required minLength={screen === "sign-in" ? 1 : 8} value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        {screen === "bootstrap" && (
          <Field label="Workspace name">
            <Input type="text" value={orgName} onChange={(event) => setOrgName(event.target.value)} />
          </Field>
        )}
        {error !== null && <p className="mb-3 text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Working…" : title}
        </Button>
      </form>
      {screen === "invite" && (
        <button type="button" className="mt-4 text-sm text-muted-foreground underline" onClick={() => onSwitch("sign-in")}>
          Already have an account? Sign in
        </button>
      )}
    </Shell>
  );
}

export function IxAuthGate({ children }: { children: ReactNode }) {
  const statusQuery = useIxStatus();
  const status = statusQuery.data;
  const teamMode = status?.mode === "team";
  const meQuery = useIxMe(teamMode);
  const refresh = useIxRefresh();
  const [inviteToken] = useState(readInviteTokenFromUrl);
  const [screen, setScreen] = useState<Screen | null>(null);

  const actor = meQuery.data?.actor ?? null;
  useEffect(() => {
    setCurrentIxRole(actor !== null && actor.kind === "user" ? actor.role : null);
  }, [actor]);

  if (statusQuery.isError || (status !== undefined && !teamMode)) return children;
  if (status === undefined || (teamMode && meQuery.isPending)) return null;
  if (actor !== null) return children;

  const resolved: Screen = screen ?? (inviteToken !== null ? "invite" : status.bootstrapped ? "sign-in" : "bootstrap");
  return (
    <AuthForm
      status={status}
      screen={resolved}
      inviteToken={inviteToken}
      onDone={() => {
        void refresh();
      }}
      onSwitch={setScreen}
    />
  );
}
