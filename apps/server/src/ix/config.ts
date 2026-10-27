import { z } from "zod";

export const IX_AUTH_MODES = ["off", "team"] as const;
export type IxAuthMode = (typeof IX_AUTH_MODES)[number];
export const IX_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type IxRole = (typeof IX_ROLES)[number];

const envSchema = z.object({
  BB_IX_AUTH: z.enum(IX_AUTH_MODES).default("off"),
  BB_IX_AUTH_LOOPBACK: z.enum(["owner", "deny"]).default("owner"),
  BB_IX_AUTH_BOOTSTRAP_EMAIL: z.string().email().optional(),
  BB_IX_AUTH_BOOTSTRAP_PASSWORD: z.string().min(8).optional(),
  BB_IX_AUTH_BOOTSTRAP_NAME: z.string().min(1).optional(),
  BB_IX_AUTH_ORG_NAME: z.string().min(1).default("Workspace"),
  BB_IX_AUTH_SESSION_DAYS: z.coerce.number().int().positive().default(30),
});

export interface IxAuthConfig {
  mode: IxAuthMode;
  loopback: "owner" | "deny";
  bootstrap: { email: string; password: string; name: string } | null;
  orgName: string;
  sessionDays: number;
  baseUrl: string;
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
