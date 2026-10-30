import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Command } from "commander";
import { createHttpTransport } from "@bb/sdk";
import { z } from "zod";
import { action } from "../action.js";
import { cliFetch } from "../client.js";
import { CliUsageError } from "../cli-usage-error.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";

export const IX_ROLES = ["owner", "admin", "member", "viewer"] as const;
type IxRole = (typeof IX_ROLES)[number];

const brandSchema = z.record(z.string(), z.string());
const statusSchema = z
  .object({
    mode: z.string(),
    bootstrapped: z.boolean(),
    orgName: z.string().nullable(),
    brand: brandSchema,
  })
  .loose();
const memberSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    role: z.enum(IX_ROLES),
    createdAt: z.string(),
  })
  .loose();
const membersSchema = z.object({ members: z.array(memberSchema) }).loose();
const inviteSchema = z
  .object({
    invitation: z.object({ id: z.string(), email: z.string(), role: z.enum(IX_ROLES) }).loose(),
    acceptUrl: z.string(),
  })
  .loose();
const actorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("user"),
      user: z.object({ id: z.string(), email: z.string(), name: z.string() }).loose(),
      role: z.enum(IX_ROLES),
    })
    .loose(),
  z.object({ kind: z.literal("loopback-owner") }).loose(),
  z.object({ kind: z.literal("off") }).loose(),
]);
const meSchema = z.object({ actor: actorSchema, mode: z.string(), orgName: z.string().nullable() }).loose();
const okSchema = z.object({ ok: z.literal(true) }).loose();

type IxBrand = z.infer<typeof brandSchema>;
type IxMember = z.infer<typeof memberSchema>;

type IxMethod = "GET" | "PUT" | "POST" | "DELETE";

export const IX_BRAND_ASSET_KINDS = ["logo", "favicon", "icon"] as const;
type IxBrandAssetKind = (typeof IX_BRAND_ASSET_KINDS)[number];
const ASSET_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
const assetUploadSchema = z
  .object({ kind: z.enum(IX_BRAND_ASSET_KINDS), contentType: z.string(), size: z.number(), etag: z.string(), brand: brandSchema })
  .loose();

export interface IxRequest {
  (method: IxMethod, path: string, body?: unknown): Promise<unknown>;
}

export function createIxRequest(baseUrl: string): IxRequest {
  const transport = createHttpTransport({ baseUrl, fetch: cliFetch, runtime: "node" });
  const rawHeaders = process.env.BB_SERVER_HEADERS;
  let serverHeaders: Record<string, string> = {};
  if (rawHeaders !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawHeaders);
    } catch {
      throw new CliUsageError({ code: "invalid_value", hint: null, message: "BB_SERVER_HEADERS must be a JSON object of string values." });
    }
    const headers = z.record(z.string(), z.string()).safeParse(parsed);
    if (!headers.success) {
      throw new CliUsageError({ code: "invalid_value", hint: null, message: "BB_SERVER_HEADERS must be a JSON object of string values." });
    }
    serverHeaders = headers.data;
  }
  return (method, path, body) => {
    const init: RequestInit =
      body === undefined
        ? { method, headers: serverHeaders }
        : {
            method,
            headers: { ...serverHeaders, "content-type": "application/json" },
            body: JSON.stringify(body),
          };
    return transport.readJson(cliFetch(`${baseUrl}${path}`, init));
  };
}

function parseResponse<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new Error(`Unexpected ${what} response from the server: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
}

async function readStdin(stdin: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin): Promise<string> {
  if (stdin.isTTY) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: "Pipe the value in, for example: printf '%s' \"$SECRET\" | bb ix sso-secret set -",
      message: "stdin is a terminal; this command reads its input from a pipe.",
    });
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function resolveBrandInput(source: string): Promise<IxBrand> {
  const text =
    source === "-"
      ? await readStdin()
      : source.startsWith("@")
        ? await readFile(source.slice(1), "utf8").catch((error: unknown) => {
            throw new CliUsageError({
              code: "invalid_value",
              hint: null,
              message: `Could not read brand file '${source.slice(1)}': ${error instanceof Error ? error.message : String(error)}`,
            });
          })
        : source;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: 'Pass a JSON object such as \'{"name":"Acme","accent":"#1ae5be"}\', @path/to/brand.json, or - for stdin.',
      message: `Brand input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const brand = brandSchema.safeParse(parsed);
  if (!brand.success || Array.isArray(parsed)) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: "Every brand field is a string: name, logoUrl, accent, appTitle, loginTitle, loginSubtitle, supportUrl, faviconUrl, iconUrl, shell (full | simple | nexus: the simple company layout, or the Nexus AI-employee layout), composer (open | locked: hide model and permission controls from staff in the simple and nexus shells).",
      message: "Brand input must be a JSON object of string fields.",
    });
  }
  return brand.data;
}

function parseAssetKind(value: string): IxBrandAssetKind {
  const kind = z.enum(IX_BRAND_ASSET_KINDS).safeParse(value);
  if (kind.success) return kind.data;
  throw new CliUsageError({
    code: "invalid_value",
    hint: null,
    message: `Invalid asset kind '${value}'. Expected one of: ${IX_BRAND_ASSET_KINDS.join(", ")}.`,
  });
}

export function assetContentType(file: string): string {
  const contentType = ASSET_CONTENT_TYPES[extname(file).toLowerCase()];
  if (contentType !== undefined) return contentType;
  throw new CliUsageError({
    code: "invalid_value",
    hint: `Supported extensions: ${Object.keys(ASSET_CONTENT_TYPES).join(", ")}`,
    message: `Cannot infer an image type from '${file}'.`,
  });
}

function parseRole(value: string): IxRole {
  const role = z.enum(IX_ROLES).safeParse(value);
  if (role.success) return role.data;
  throw new CliUsageError({
    code: "invalid_value",
    hint: null,
    message: `Invalid role '${value}'. Expected one of: ${IX_ROLES.join(", ")}.`,
  });
}

function printBrand(brand: IxBrand): void {
  const entries = Object.entries(brand);
  if (entries.length === 0) {
    console.log("(no brand set)");
    return;
  }
  const width = Math.max(...entries.map(([key]) => key.length));
  for (const [key, value] of entries) {
    console.log(`${key.padEnd(width)}  ${value}`);
  }
}

function printMembers(members: IxMember[]): void {
  if (members.length === 0) {
    console.log("No members.");
    return;
  }
  const rows = members.map((member) => [member.id, member.email, member.name, member.role, member.createdAt]);
  printBorderlessTable(
    { head: ["ID", "EMAIL", "NAME", "ROLE", "JOINED"], colWidths: columnWidths(rows, [2, 5, 4, 4, 6]) },
    rows,
  );
}

export function registerIxCommands(program: Command, getUrl: () => string): void {
  const request = (): IxRequest => createIxRequest(getUrl());

  const ix = program
    .command("ix")
    .description("Manage this server's IX team layer: brand, single sign-on secret, members and invitations");

  ix.command("status")
    .description("Show the IX auth mode, whether an owner exists, the organization name and the brand")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const raw = await request()("GET", "/api/ix/status");
        if (outputJson(opts, raw)) return;
        const status = parseResponse(statusSchema, raw, "status");
        console.log(`Mode: ${status.mode}`);
        console.log(`Bootstrapped: ${status.bootstrapped ? "yes" : "no"}`);
        console.log(`Organization: ${status.orgName ?? "(none)"}`);
        console.log("Brand:");
        printBrand(status.brand);
      }),
    );

  const brand = ix.command("brand").description("Read or replace the brand record the app renders");

  brand
    .command("get")
    .description("Print the brand record")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const raw = await request()("GET", "/api/ix/brand");
        if (outputJson(opts, raw)) return;
        printBrand(parseResponse(brandSchema, raw, "brand"));
      }),
    );

  brand
    .command("set <json>")
    .description("Replace the brand record from inline JSON, @file, or - for stdin (admin or loopback owner)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (source: string, opts: JsonOutputOptions) => {
        const input = await resolveBrandInput(source);
        const raw = await request()("PUT", "/api/ix/brand", input);
        if (outputJson(opts, raw)) return;
        const result = parseResponse(z.object({ brand: brandSchema }).loose(), raw, "brand");
        const keys = Object.keys(result.brand);
        console.log(keys.length === 0 ? "Brand cleared." : `Brand updated: ${keys.join(", ")}`);
      }),
    );

  const asset = brand.command("asset").description("Upload or remove the logo, favicon or icon image the server hosts");

  asset
    .command("set <kind> <file>")
    .description(`Upload an image (${IX_BRAND_ASSET_KINDS.join(", ")}); the brand's matching URL is pointed at it (admin or loopback owner)`)
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (kindArg: string, file: string, opts: JsonOutputOptions) => {
        const kind = parseAssetKind(kindArg);
        const contentType = assetContentType(file);
        const bytes = await readFile(file).catch((error: unknown) => {
          throw new CliUsageError({
            code: "invalid_value",
            hint: null,
            message: `Could not read '${file}': ${error instanceof Error ? error.message : String(error)}`,
          });
        });
        const raw = await request()("PUT", `/api/ix/brand/assets/${kind}`, { contentType, dataBase64: bytes.toString("base64") });
        if (outputJson(opts, raw)) return;
        const result = parseResponse(assetUploadSchema, raw, "asset");
        console.log(`Uploaded ${result.kind} (${result.contentType}, ${result.size} bytes, etag ${result.etag}).`);
      }),
    );

  asset
    .command("clear <kind>")
    .description("Remove an uploaded image and clear the brand URL that pointed at it")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (kindArg: string, opts: JsonOutputOptions) => {
        const kind = parseAssetKind(kindArg);
        const raw = await request()("DELETE", `/api/ix/brand/assets/${kind}`);
        if (outputJson(opts, raw)) return;
        parseResponse(okSchema, raw, "asset");
        console.log(`Cleared ${kind}.`);
      }),
    );

  const ssoSecret = ix
    .command("sso-secret")
    .description("Manage the HMAC secret that signs single sign-on tokens for this server");

  ssoSecret
    .command("set [stdin]")
    .description("Set the SSO secret, read from stdin (pass - or nothing; the secret is never taken from an argument)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (stdinMarker: string | undefined, opts: JsonOutputOptions) => {
        if (stdinMarker !== undefined && stdinMarker !== "-") {
          throw new CliUsageError({
            code: "invalid_value",
            hint: "printf '%s' \"$SECRET\" | bb ix sso-secret set -",
            message: "The secret is read from stdin only; do not pass it as an argument.",
          });
        }
        const secret = (await readStdin()).replace(/\r?\n+$/u, "");
        if (secret.length === 0) {
          throw new CliUsageError({ code: "invalid_value", hint: null, message: "stdin is empty; pipe the secret in." });
        }
        const raw = await request()("PUT", "/api/ix/sso/secret", { secret });
        if (outputJson(opts, raw)) return;
        parseResponse(okSchema, raw, "sso-secret");
        console.log("SSO secret set.");
      }),
    );

  ssoSecret
    .command("clear")
    .description("Remove the SSO secret; single sign-on tokens are refused until a new one is set")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const raw = await request()("PUT", "/api/ix/sso/secret", { secret: null });
        if (outputJson(opts, raw)) return;
        parseResponse(okSchema, raw, "sso-secret");
        console.log("SSO secret cleared.");
      }),
    );

  ix.command("members")
    .description("List the organization's members and roles")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const raw = await request()("GET", "/api/ix/members");
        if (outputJson(opts, raw)) return;
        printMembers(parseResponse(membersSchema, raw, "members").members);
      }),
    );

  const accessSchema = z.object({
    mode: z.enum(["open", "restricted"]),
    projects: z.array(z.object({ id: z.string(), name: z.string() })),
    members: z.array(z.object({ memberId: z.string(), email: z.string(), role: z.string(), projects: z.record(z.string(), z.enum(["read", "write"])) })),
  });
  const access = ix.command("access").description("Per-project access: in restricted mode members see only granted projects and their own chats");
  access.command("show", { isDefault: true })
    .description("Show the access mode, projects and each member's grants")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const raw = await request()("GET", "/api/ix/access");
        if (outputJson(opts, raw)) return;
        const view = parseResponse(accessSchema, raw, "access");
        const names = new Map(view.projects.map((p) => [p.id, p.name]));
        console.log(`Mode: ${view.mode}`);
        for (const m of view.members) {
          const grants = Object.entries(m.projects).map(([id, level]) => `${names.get(id) ?? id}=${level}`).join(", ");
          console.log(`${m.email} (${m.role}): ${m.role === "owner" || m.role === "admin" ? "all projects" : grants || "no projects"}`);
        }
      }),
    );
  access.command("mode <mode>")
    .description("open = everyone sees everything; restricted = members see only granted projects and their own chats")
    .action(
      action(async (mode: string) => {
        if (mode !== "open" && mode !== "restricted") throw new Error("mode must be open or restricted");
        await request()("PUT", "/api/ix/access/mode", { mode });
        console.log(`Access mode: ${mode}`);
      }),
    );
  access.command("grant <email> <project> <level>")
    .description("Set a member's access to a project (id or name): read, write, or none")
    .action(
      action(async (email: string, project: string, level: string) => {
        if (!["read", "write", "none"].includes(level)) throw new Error("level must be read, write or none");
        const view = parseResponse(accessSchema, await request()("GET", "/api/ix/access"), "access");
        const member = view.members.find((m) => m.email.toLowerCase() === email.toLowerCase());
        if (member === undefined) throw new Error(`No member with email ${email}`);
        const target = view.projects.find((p) => p.id === project) ?? view.projects.find((p) => p.name.toLowerCase() === project.toLowerCase());
        if (target === undefined) throw new Error(`No project ${project}`);
        await request()("PUT", `/api/ix/access/members/${encodeURIComponent(member.memberId)}/projects/${encodeURIComponent(target.id)}`, { level: level === "none" ? null : level });
        console.log(`${member.email} → ${target.name}: ${level}`);
      }),
    );

  const deskSchema = z.object({ policy: z.object({ theme: z.boolean(), layout: z.boolean() }), personal: z.object({ theme: z.boolean(), layout: z.number() }).nullable() });
  const desk = ix.command("desk").description("Personal desks: each person's own theme and layout on top of the workspace defaults");
  desk.command("show", { isDefault: true })
    .description("Show whether people may set their own theme and layout")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const raw = await request()("GET", "/api/ix/desk");
        if (outputJson(opts, raw)) return;
        const view = parseResponse(deskSchema, raw, "desk");
        console.log(`Personal themes: ${view.policy.theme ? "allowed" : "locked"}`);
        console.log(`Personal layouts: ${view.policy.layout ? "allowed" : "locked"}`);
      }),
    );
  desk.command("policy")
    .description("Allow or lock personal themes and layouts (locked = everyone uses the workspace default)")
    .option("--theme <state>", "allowed or locked")
    .option("--layout <state>", "allowed or locked")
    .action(
      action(async (opts: { theme?: string; layout?: string }) => {
        const current = parseResponse(deskSchema, await request()("GET", "/api/ix/desk"), "desk").policy;
        const flag = (value: string | undefined, fallback: boolean) => {
          if (value === undefined) return fallback;
          if (value !== "allowed" && value !== "locked") throw new Error("use allowed or locked");
          return value === "allowed";
        };
        const policy = { theme: flag(opts.theme, current.theme), layout: flag(opts.layout, current.layout) };
        await request()("PUT", "/api/ix/desk/policy", policy);
        console.log(`Personal themes: ${policy.theme ? "allowed" : "locked"}; personal layouts: ${policy.layout ? "allowed" : "locked"}`);
      }),
    );

  const shareModes = ["private", "project", "workspace"] as const;
  const shareChoices = ["private", "project", "workspace", "people"] as const;
  const whoCanChange = ["starter", "starter_and_admins", "participants"] as const;
  const policySchema = z.object({
    defaultShare: z.enum(shareModes),
    allowedShares: z.array(z.enum(shareChoices)),
    whoCanChange: z.enum(whoCanChange),
    participantsCanAdd: z.boolean(),
    adminsSeeAll: z.boolean(),
  });
  type SharingPolicy = z.infer<typeof policySchema>;
  const printPolicy = (policy: SharingPolicy) => {
    console.log(`Default for new chats: ${policy.defaultShare}`);
    console.log(`Members may pick: ${policy.allowedShares.join(", ")}`);
    console.log(`Who can change sharing: ${policy.whoCanChange}`);
    console.log(`Added people can add others: ${policy.participantsCanAdd ? "on" : "off"}`);
    console.log(`Owners and admins can read any chat: ${policy.adminsSeeAll ? "on" : "off"}`);
  };
  const onOff = (value: string | undefined, fallback: boolean) => {
    if (value === undefined) return fallback;
    if (value !== "on" && value !== "off") throw new CliUsageError({ code: "invalid_value", hint: null, message: "use on or off" });
    return value === "on";
  };
  const pick = <T extends string>(values: readonly T[], value: string, what: string): T => {
    const found = values.find((candidate) => candidate === value);
    if (found !== undefined) return found;
    throw new CliUsageError({ code: "invalid_value", hint: null, message: `Invalid ${what} '${value}'. Expected one of: ${values.join(", ")}.` });
  };
  const sharing = ix.command("sharing").description("Workspace chat-sharing policy: default for new chats, allowed choices, who can change them, admin oversight");
  sharing.command("show", { isDefault: true })
    .description("Show the chat-sharing policy")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const raw = await request()("GET", "/api/ix/sharing-policy");
        if (outputJson(opts, raw)) return;
        printPolicy(parseResponse(z.object({ policy: policySchema }), raw, "sharing-policy").policy);
      }),
    );
  sharing.command("policy")
    .description("Change the chat-sharing policy (owners and admins); omitted options keep their current value")
    .option("--default <share>", `Sharing for new chats (${shareModes.join(", ")})`)
    .option("--allow <choices>", `Comma-separated choices members may pick (${shareChoices.join(", ")})`)
    .option("--who-can-change <who>", `Who can change a chat's sharing (${whoCanChange.join(", ")})`)
    .option("--participants-can-add <state>", "on or off: people added to a chat can add others")
    .option("--admins-see-all <state>", "on or off: owners and admins can read any chat")
    .action(
      action(async (opts: { default?: string; allow?: string; whoCanChange?: string; participantsCanAdd?: string; adminsSeeAll?: string }) => {
        const current = parseResponse(z.object({ policy: policySchema }), await request()("GET", "/api/ix/sharing-policy"), "sharing-policy").policy;
        const next: SharingPolicy = {
          defaultShare: opts.default === undefined ? current.defaultShare : pick(shareModes, opts.default, "share"),
          allowedShares: opts.allow === undefined ? current.allowedShares : opts.allow.split(",").map((value) => pick(shareChoices, value.trim(), "choice")),
          whoCanChange: opts.whoCanChange === undefined ? current.whoCanChange : pick(whoCanChange, opts.whoCanChange, "who-can-change"),
          participantsCanAdd: onOff(opts.participantsCanAdd, current.participantsCanAdd),
          adminsSeeAll: onOff(opts.adminsSeeAll, current.adminsSeeAll),
        };
        const saved = parseResponse(z.object({ policy: policySchema }), await request()("PUT", "/api/ix/sharing-policy", next), "sharing-policy");
        printPolicy(saved.policy);
      }),
    );

  const personSchema = z.object({ id: z.string(), name: z.string(), email: z.string() });
  const shareViewSchema = z.object({ share: z.enum(shareModes), owner: personSchema.nullable(), people: z.array(personSchema) }).loose();
  const printShare = (view: z.infer<typeof shareViewSchema>) => {
    console.log(`Shared with: ${view.share}`);
    console.log(`Started by: ${view.owner === null ? "(unknown)" : `${view.owner.name} <${view.owner.email}>`}`);
    console.log(`People: ${view.people.length === 0 ? "(none)" : view.people.map((person) => `${person.name} <${person.email}>`).join(", ")}`);
  };
  const memberIds = async (emails: string[]) => {
    const members = z.object({ members: z.array(z.object({ userId: z.string(), email: z.string() }).loose()) }).parse(await request()("GET", "/api/ix/members")).members;
    return emails.map((email) => {
      const found = members.find((member) => member.email.toLowerCase() === email.toLowerCase());
      if (found === undefined) throw new CliUsageError({ code: "invalid_value", hint: null, message: `No member with email ${email}` });
      return found.userId;
    });
  };
  const chat = ix.command("chat").description("Who can see a chat: its share mode and the specific people added to it");
  const chatPath = (threadId: string) => `/api/ix/threads/${encodeURIComponent(threadId)}`;
  chat.command("share <threadId> [mode]")
    .description(`Show a chat's sharing, or set it (${shareModes.join(", ")})`)
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, mode: string | undefined, opts: JsonOutputOptions) => {
        const raw = mode === undefined
          ? await request()("GET", `${chatPath(threadId)}/share`)
          : await request()("PUT", `${chatPath(threadId)}/share`, { share: pick(shareModes, mode, "share") });
        if (outputJson(opts, raw)) return;
        printShare(parseResponse(shareViewSchema, raw, "share"));
      }),
    );
  chat.command("add <threadId> <emails...>")
    .description("Add specific people (by email) to a chat")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (threadId: string, emails: string[], opts: JsonOutputOptions) => {
        const raw = await request()("POST", `${chatPath(threadId)}/people`, { userIds: await memberIds(emails) });
        if (outputJson(opts, raw)) return;
        printShare(parseResponse(shareViewSchema, raw, "share"));
      }),
    );
  chat.command("remove <threadId> <email>")
    .description("Remove a person from a chat")
    .action(
      action(async (threadId: string, email: string) => {
        const [userId] = await memberIds([email]);
        await request()("DELETE", `${chatPath(threadId)}/people/${encodeURIComponent(userId ?? "")}`);
        console.log(`Removed ${email}.`);
      }),
    );
  chat.command("leave <threadId>")
    .description("Leave a chat you were added to")
    .action(
      action(async (threadId: string) => {
        const me = parseResponse(meSchema, await request()("GET", "/api/ix/me"), "me");
        if (me.actor.kind !== "user") throw new CliUsageError({ code: "invalid_value", hint: null, message: "Only a signed-in person can leave a chat" });
        await request()("DELETE", `${chatPath(threadId)}/people/${encodeURIComponent(me.actor.user.id)}`);
        console.log("Left the chat.");
      }),
    );

  ix.command("invite <email>")
    .description("Invite a member by email and print the accept URL to share")
    .option("--role <role>", `Role to grant (${IX_ROLES.join(", ")})`, "member")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (email: string, opts: JsonOutputOptions & { role: string }) => {
        const role = parseRole(opts.role);
        const raw = await request()("POST", "/api/ix/members/invite", { email, role });
        if (outputJson(opts, raw)) return;
        const result = parseResponse(inviteSchema, raw, "invite");
        console.log(`Invited ${result.invitation.email} as ${result.invitation.role} (invitation ${result.invitation.id})`);
        console.log(`Accept URL: ${result.acceptUrl}`);
      }),
    );

  ix.command("me")
    .description("Show who this CLI acts as on the server")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const raw = await request()("GET", "/api/ix/me");
        if (outputJson(opts, raw)) return;
        const me = parseResponse(meSchema, raw, "me");
        console.log(`Mode: ${me.mode}`);
        console.log(`Organization: ${me.orgName ?? "(none)"}`);
        if (me.actor.kind === "user") {
          console.log(`Actor: ${me.actor.user.email} (${me.actor.user.name}) role ${me.actor.role}`);
        } else if (me.actor.kind === "loopback-owner") {
          console.log("Actor: loopback owner (no Origin header on a loopback request)");
        } else {
          console.log("Actor: none (BB_IX_AUTH is off)");
        }
      }),
    );
}
