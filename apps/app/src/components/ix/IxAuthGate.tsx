import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import {
  acceptSsoToken,
  clearInviteTokenFromUrl,
  clearSsoTokenFromUrl,
  ixRequest,
  readInviteTokenFromUrl,
  readSsoTokenFromUrl,
  refreshIxSession,
  rememberedTeamMode,
  setCurrentIxRole,
  useIxSessionBoot,
  type IxBrand,
  type IxStatus,
} from "./ix-auth";
import { setBrandProductName } from "@/lib/ix/brand";

type Screen = "sign-in" | "bootstrap" | "invite";

function Shell({ brand, title, subtitle, children }: { brand: IxBrand; title: string; subtitle: string; children: ReactNode }) {
  const accentStyle = brand.accent === undefined ? undefined : { backgroundColor: brand.accent };
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {accentStyle !== undefined && <div className="h-1 w-full" style={accentStyle} />}
        <div className="p-6">
          {brand.logoUrl !== undefined && (
            <img src={brand.logoUrl} alt={brand.name ?? ""} className="mb-4 h-8 w-auto max-w-[160px] object-contain" />
          )}
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-5">{children}</div>
          {brand.supportUrl !== undefined && (
            <a href={brand.supportUrl} target="_blank" rel="noreferrer" className="mt-5 block text-xs text-muted-foreground underline">
              Need help?
            </a>
          )}
        </div>
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

function AuthForm({ status, screen, inviteToken, notice, onDone, onSwitch }: { status: IxStatus; screen: Screen; inviteToken: string | null; notice: string | null; onDone: () => void; onSwitch: (next: Screen) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState(status.orgName ?? "");
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);
  const brand = status.brand;

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

  const action = screen === "bootstrap" ? "Create the owner account" : screen === "invite" ? "Accept your invitation" : "Sign in";
  const title = screen === "sign-in" ? (brand.loginTitle ?? action) : action;
  const defaultSubtitle =
    screen === "bootstrap"
      ? "This server has no owner yet. The first account becomes the owner."
      : screen === "invite"
        ? "Choose a name and a password to join this workspace."
        : status.orgName
          ? `Sign in to ${brand.name ?? status.orgName}`
          : "Sign in to this server";
  const subtitle = screen === "sign-in" ? (brand.loginSubtitle ?? defaultSubtitle) : defaultSubtitle;
  const buttonStyle = brand.accent === undefined ? undefined : { backgroundColor: brand.accent, borderColor: brand.accent };

  return (
    <Shell brand={brand} title={title} subtitle={subtitle}>
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
        <Button type="submit" className="w-full" disabled={busy} style={buttonStyle}>
          {busy ? "Working…" : action}
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
  const session = useIxSessionBoot();
  const status = session.status ?? undefined;
  const teamMode = status?.mode === "team";
  const [inviteToken] = useState(readInviteTokenFromUrl);
  const [ssoToken, setSsoToken] = useState(readSsoTokenFromUrl);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [holdForTeam] = useState(rememberedTeamMode);
  const actor = session.me?.actor ?? null;
  useEffect(() => {
    setCurrentIxRole(actor !== null && actor.kind === "user" ? actor.role : null);
  }, [actor]);
  const brand = status?.brand;
  useEffect(() => {
    if (brand === undefined) return;
    setBrandProductName(brand.appTitle ?? brand.name ?? null);
    if (brand.appTitle !== undefined && typeof document !== "undefined") document.title = brand.appTitle;
  }, [brand]);
  useEffect(() => {
    if (status === undefined || ssoToken === null) return;
    if (!teamMode) {
      clearSsoTokenFromUrl();
      setSsoToken(null);
      return;
    }
    let cancelled = false;
    void acceptSsoToken(ssoToken)
      .catch((caught: unknown) => {
        if (!cancelled) setSsoError(caught instanceof Error ? caught.message : "Single sign-on failed");
      })
      .finally(() => {
        clearSsoTokenFromUrl();
        if (cancelled) return;
        setSsoToken(null);
        void refreshIxSession();
      });
    return () => {
      cancelled = true;
    };
  }, [status, teamMode, ssoToken]);
  if (session.statusFailed || (status !== undefined && !teamMode)) return children;
  if (status === undefined) return holdForTeam ? null : children;
  if (ssoToken !== null || session.mePending) return null;
  if (actor !== null) return children;
  const resolved: Screen = screen ?? (inviteToken !== null ? "invite" : status.bootstrapped ? "sign-in" : "bootstrap");
  return (
    <AuthForm
      status={status}
      screen={resolved}
      inviteToken={inviteToken}
      notice={ssoError}
      onDone={() => {
        void refreshIxSession();
      }}
      onSwitch={setScreen}
    />
  );
}
