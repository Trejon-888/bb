import { z } from "zod";

export const IX_AUTH_MODES = ["off", "team"] as const;
export type IxAuthMode = (typeof IX_AUTH_MODES)[number];
export const IX_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type IxRole = (typeof IX_ROLES)[number];
export const IX_SOCIAL_PROVIDERS = ["google", "microsoft", "github"] as const;
export type IxSocialProvider = (typeof IX_SOCIAL_PROVIDERS)[number];

const envSchema = z.object({
  BB_IX_AUTH: z.enum(IX_AUTH_MODES).default("off"),
  BB_IX_AUTH_LOOPBACK: z.enum(["owner", "deny"]).default("owner"),
  BB_IX_AUTH_BOOTSTRAP_EMAIL: z.string().email().optional(),
  BB_IX_AUTH_BOOTSTRAP_PASSWORD: z.string().min(8).optional(),
  BB_IX_AUTH_BOOTSTRAP_NAME: z.string().min(1).optional(),
  BB_IX_AUTH_ORG_NAME: z.string().min(1).default("Workspace"),
  BB_IX_AUTH_SESSION_DAYS: z.coerce.number().int().positive().default(30),
  BB_IX_AUTH_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  BB_IX_AUTH_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  BB_IX_AUTH_MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  BB_IX_AUTH_MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
  BB_IX_AUTH_MICROSOFT_TENANT_ID: z.string().min(1).default("common"),
  BB_IX_AUTH_GITHUB_CLIENT_ID: z.string().min(1).optional(),
  BB_IX_AUTH_GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
});

export interface IxSocialProviderConfig {
  google: { clientId: string; clientSecret: string } | null;
  microsoft: { clientId: string; clientSecret: string; tenantId: string } | null;
  github: { clientId: string; clientSecret: string } | null;
}

export interface IxAuthConfig {
  mode: IxAuthMode;
  loopback: "owner" | "deny";
  bootstrap: { email: string; password: string; name: string } | null;
  orgName: string;
  sessionDays: number;
  baseUrl: string;
  social: IxSocialProviderConfig;
}

function credentials(clientId: string | undefined, clientSecret: string | undefined): { clientId: string; clientSecret: string } | null {
  return clientId !== undefined && clientSecret !== undefined ? { clientId, clientSecret } : null;
}

export function configuredIxSocialProviders(social: IxSocialProviderConfig): IxSocialProvider[] {
  return IX_SOCIAL_PROVIDERS.filter((provider) => social[provider] !== null);
}

export function readIxAuthConfig(
  env: NodeJS.ProcessEnv,
  baseUrl: string,
): IxAuthConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`BB_IX_AUTH configuration is invalid: ${issues}`);
  }
  const value = parsed.data;
  const bootstrap =
    value.BB_IX_AUTH_BOOTSTRAP_EMAIL && value.BB_IX_AUTH_BOOTSTRAP_PASSWORD
      ? {
          email: value.BB_IX_AUTH_BOOTSTRAP_EMAIL,
          password: value.BB_IX_AUTH_BOOTSTRAP_PASSWORD,
          name:
            value.BB_IX_AUTH_BOOTSTRAP_NAME ??
            value.BB_IX_AUTH_BOOTSTRAP_EMAIL.split("@")[0] ??
            "Owner",
        }
      : null;
  return {
    mode: value.BB_IX_AUTH,
    loopback: value.BB_IX_AUTH_LOOPBACK,
    bootstrap,
    orgName: value.BB_IX_AUTH_ORG_NAME,
    sessionDays: value.BB_IX_AUTH_SESSION_DAYS,
    baseUrl,
    social: {
      google: credentials(value.BB_IX_AUTH_GOOGLE_CLIENT_ID, value.BB_IX_AUTH_GOOGLE_CLIENT_SECRET),
      microsoft: (() => {
        const base = credentials(value.BB_IX_AUTH_MICROSOFT_CLIENT_ID, value.BB_IX_AUTH_MICROSOFT_CLIENT_SECRET);
        return base === null ? null : { ...base, tenantId: value.BB_IX_AUTH_MICROSOFT_TENANT_ID };
      })(),
      github: credentials(value.BB_IX_AUTH_GITHUB_CLIENT_ID, value.BB_IX_AUTH_GITHUB_CLIENT_SECRET),
    },
  };
}

export const ROLE_RANK: Record<IxRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export function parseIxRole(value: unknown): IxRole | null {
  if (typeof value !== "string") return null;
  const first = value.split(",")[0]?.trim();
  return (IX_ROLES as readonly string[]).includes(first ?? "")
    ? (first as IxRole)
    : null;
}

export function roleAtLeast(role: IxRole, min: IxRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
