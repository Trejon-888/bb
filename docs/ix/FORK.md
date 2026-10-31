# IX fork of bb

This fork (`Trejon-888/bb`, branch `ix`) adds a feature-flagged multi-user layer to bb: human sign-in, one organization per server with members and roles, identity passed to plugins, and role-gated screens. Upstream is `get-bb/bb` (MIT). The patch is kept thin so it rebases onto every upstream release.

## Behavior

## bb ix CLI

The fork adds `bb ix status`, `brand get`, `brand set <json|@file|->`, `brand asset set <logo|favicon|icon> <file>`, `brand asset clear <kind>`, `sso-secret set [-]`, `sso-secret clear`, `tokens rotate`, `members`, `invite <email> --role <owner|admin|member|viewer>`, and `me`. Requests use `BB_SERVER_URL`, `BB_SERVER_HEADERS` and the CLI's server token (`BB_IX_TOKEN` or the owner token file, see Scoped server tokens); `--json` prints the server's raw JSON response. Non-2xx responses exit with the server error code and message. The SSO secret is read from stdin only, never from an argument. `brand set` accepts inline JSON, a file prefixed with `@`, or stdin with `-`. Invitation output includes the `acceptUrl` to share. Clearing SSO sends `{ "secret": null }` and removes the stored secret. `brand asset set` reads the file, infers the content type from the extension (`.png`, `.svg`, `.ico`, `.webp`, `.jpg`/`.jpeg`; anything else is refused) and uploads it base64-encoded; `brand asset clear` sends `DELETE`.

| Setting | Values | Meaning |
|---|---|---|
| `BB_IX_AUTH` | `off` (default) / `team` | `off` keeps upstream behavior exactly. `team` requires a signed-in member for `/api/v1/*` and `/ws`. |
| `BB_IX_AUTH_LOOPBACK` | `owner` (default) / `deny` | In team mode, a loopback request with no `Origin` header and no token acts as the owner. `deny` turns that off, so loopback callers need a token (see Scoped server tokens). |
| `BB_IX_TOKEN` | set by the server | The scoped token the server puts in every agent's (and terminal's) environment. The `bb` CLI sends it as `Authorization: Bearer`. Never set it by hand. |
| `BB_IX_OWNER_TOKEN_FILE` | path | For operator helpers and the server's own subprocesses: the `bb` CLI reads the owner token from this file. The server sets it on itself to `<dataDir>/ix-owner-token`. It is stripped from agent and daemon environments. |
| `BB_IX_AUTH_BOOTSTRAP_EMAIL` / `_PASSWORD` / `_NAME` | | Create the owner and the organization at first start. Otherwise the first visitor creates the owner in the app. |
| `BB_IX_AUTH_ORG_NAME` | default `Workspace` | Organization name used by bootstrap. |
| `BB_IX_AUTH_SESSION_DAYS` | default `30` | Session lifetime. |
| `BB_IX_AUTH_GOOGLE_CLIENT_ID` / `_SECRET` | | Enables "Continue with Google". Both must be set. |
| `BB_IX_AUTH_MICROSOFT_CLIENT_ID` / `_SECRET` | | Enables "Continue with Microsoft" (Entra ID). Both must be set. |
| `BB_IX_AUTH_MICROSOFT_TENANT_ID` | default `common` | Entra tenant: `common`, `organizations`, `consumers`, or a tenant id/domain to restrict sign-in to one directory. |
| `BB_IX_AUTH_GITHUB_CLIENT_ID` / `_SECRET` | | Enables "Continue with GitHub". Both must be set. |

Social sign-in: each provider is passed to better-auth's `socialProviders` only when its id and secret are both present. `GET /api/ix/status` lists them in `providers` (`google`, `microsoft`, `github`, in that order) next to `password: true`. The app shows a "Continue with …" button per provider on the sign-in, bootstrap and invitation screens, above email + password; a click posts `/api/auth/sign-in/social { provider, callbackURL, errorCallbackURL }` and follows the returned `url`. `callbackURL` is the app origin (plus `?ix-invite=<id>` on the invitation screen); a provider error lands on `/?ix-auth-error=1&error=<code>` and is shown on the sign-in screen. Register these redirect URIs, with `<baseUrl>` = `BB_APP_URL` (the public origin, no trailing slash):

| Provider | Redirect URI | Where |
|---|---|---|
| Google | `<baseUrl>/api/auth/callback/google` | Google Cloud console → APIs & Services → Credentials → OAuth client (Web application) → Authorized redirect URIs |
| Microsoft | `<baseUrl>/api/auth/callback/microsoft` | Entra admin center → App registrations → Authentication → Web platform → Redirect URIs |
| GitHub | `<baseUrl>/api/auth/callback/github` | GitHub → Settings → Developer settings → OAuth Apps → Authorization callback URL |

Membership rule for any signed-in user without a membership (checked on every request in `resolveSession`, serialized in-process so concurrent callbacks cannot race): (a) if the server has no organization yet, the user creates it (`BB_IX_AUTH_ORG_NAME`) and becomes owner, first claimer wins; (b) otherwise, if a pending, unexpired invitation exists for the user's email (case-insensitive) and better-auth marks the email verified (`user.emailVerified`, which Google, Microsoft and GitHub set from the provider's verified-email claim), the membership is created with the invitation's role and the invitation is marked `accepted`; (c) otherwise the user stays a non-member and every gated route answers `403 ix_not_member` "This account has no access to this workspace. Ask an admin for an invitation." The app shows that message with a Sign out button (`POST /api/ix/sign-out` is public so non-members can use it). Email + password sign-ups never have a verified email, so they cannot claim an invitation by address; they still use the invitation link. better-auth links a provider account to an existing user with the same verified email, so a password member who later signs in with Google keeps their membership.

Roles: `owner` > `admin` > `member` > `viewer`. Viewers can read everything but every non-GET `/api/v1` request is refused except marking threads read, UI preferences, and plugin RPC calls (plugins see the caller's role and gate their own writes). Admins manage members and invitations; only owners grant owner. The last owner cannot be demoted or removed.

Routes (all new, mounted at `/api/ix` and `/api/auth`):

- `GET /api/ix/status` (public; includes `brand`, `password`, `providers`) · `GET /api/ix/brand` (public) · `GET /api/ix/brand/assets/:kind` (public) · `POST /api/ix/bootstrap` · `POST /api/ix/sign-in` · `POST /api/ix/sign-out` · `POST /api/ix/invitations/accept` · `POST /api/ix/sso/accept`
- `GET /api/ix/me` · `PUT /api/ix/brand` (admin+) · `PUT /api/ix/brand/assets/:kind` (admin+) · `DELETE /api/ix/brand/assets/:kind` (admin+) · `PUT /api/ix/sso/secret` (owner) · `GET /api/ix/members` · `POST /api/ix/members/invite` · `POST /api/ix/members/:id/role` · `DELETE /api/ix/members/:id` · `GET /api/ix/invitations` · `DELETE /api/ix/invitations/:id`
- `/api/auth/*` is better-auth's own handler (email + password, organization plugin). Tables are `ix_user`, `ix_session`, `ix_account`, `ix_verification`, `ix_organization`, `ix_member`, `ix_invitation`, created by better-auth's migrator at boot, outside Drizzle's journal. `ix_kv` (`key`, `value`, `updated_at`) is created next to them with `CREATE TABLE IF NOT EXISTS` and holds the brand record (`brand`), uploaded brand images (`brand.asset.<kind>`), the SSO secret (`sso.secret`) and consumed SSO nonces (`sso.nonce.<nonce>` → expiry ms).

Brand: `PUT /api/ix/brand` replaces the record with `{ name?, logoUrl?, accent?, appTitle?, loginTitle?, loginSubtitle?, supportUrl?, faviconUrl?, iconUrl? }` (all optional strings; URLs must be http(s), except `logoUrl`, `faviconUrl` and `iconUrl`, which also accept a same-origin path starting with a single `/`; `accent` is a hex or functional CSS color; unknown fields are refused). Admins, owners and the loopback owner may write it; anyone may read it. Brand assets: `PUT /api/ix/brand/assets/<logo|favicon|icon>` takes `{ contentType: "image/png"|"image/svg+xml"|"image/x-icon"|"image/webp"|"image/jpeg", dataBase64 }` (admin+ or loopback owner; at most 2 MB decoded, `413 ix_asset_too_large` above that; SVGs containing `<script`, an `on…=` attribute or `javascript:` are refused with `400 ix_asset_unsafe_svg`). The image is stored in `ix_kv` under `brand.asset.<kind>` (JSON with the content type, base64 bytes, a content hash `etag`, size and time), so it travels with the database and needs no extra directory. The upload sets the matching brand field (`logo` → `logoUrl`, `favicon` → `faviconUrl`, `icon` → `iconUrl`) to `/api/ix/brand/assets/<kind>?v=<etag>`. `GET` serves the bytes with the stored content type, `Cache-Control: public, max-age=300`, a quoted `ETag` (304 on `If-None-Match`), `X-Content-Type-Options: nosniff` and a sandboxing CSP; 404 when none is set. `DELETE` removes the image and clears the brand field when it still points at that asset (an external URL set through `PUT /api/ix/brand` is kept). A later `PUT /api/ix/brand` replaces the whole record, so include the asset URLs if they should stay. In the app, `IxAuthGate` points `<link rel="icon">` at `faviconUrl` and `<link rel="apple-touch-icon">` at `iconUrl ?? faviconUrl` (its own `ix-brand-*` links; the stock links are parked with a `data-ix-original-rel` attribute and restored when the field is cleared), and `BrandLogo` renders `logoUrl` in place of the bb mark.

The login screen uses `loginTitle`, `loginSubtitle`, `logoUrl`, `accent` and `supportUrl`; `IxAuthGate` sets `document.title` from `appTitle` when present. ix-superadmin resolves its org-tree brand (field-level inheritance) and pushes the resolved record here; the fork stores no inheritance of its own.

SSO: `PUT /api/ix/sso/secret { secret }` (owner or loopback owner, min 32 characters) stores the per-workspace HMAC secret that ix-superadmin's `workspace.setSso` shares. `POST /api/ix/sso/accept { token }` takes `base64url(payloadJson) + "." + base64url(hmacSha256(secret, payloadB64))` with payload `{ sub: email, name, role: owner|admin|member|viewer, workspaceId, exp: epoch seconds, nonce }`. It refuses with `401 ix_sso_<reason>` for `no_secret`, `malformed`, `bad_signature`, `expired` and `replayed` (nonces are remembered in memory and in `ix_kv` until they expire). On success it upserts the user by email (a random password if new; existing users keep their name), upserts the membership with the token's role but never lowers an existing member's role, creates a better-auth session directly and returns the session cookie plus `{ ok, userId, role }`. An `owner` token on a server with no organization yet creates the organization (`BB_IX_AUTH_ORG_NAME`); lesser roles get `409`. The app accepts `?ix-sso=<token>` on load, posts it, strips the parameter and refreshes. Every acceptance, refusal, secret rotation and brand write is a `logger.info` line prefixed `ix-sso:` / `ix-brand:`.

Plugins: in team mode the RPC caller a plugin receives is `{ kind: "client", experimental_user: { id, email, name, role } }`. ix-superadmin reads that to act as the signed-in member.

Invitations: `POST /api/ix/members/invite` returns `acceptUrl` (`<appUrl>/?ix-invite=<id>`); the app opens the accept screen when that query parameter is present. No email is sent; the admin shares the link.

Deployment: team mode is meant for a server behind your own reverse proxy with `BB_APP_URL` set to the public origin. The getbb.app Connect tunnel gates on the owner's session before the server sees a request, so it is not a path for other members.

## Simple company shell

A workspace whose brand record has `shell: "simple"` (`bb ix brand set '{"shell":"simple"}'`, or pushed by ix-superadmin from an org brand) renders a calm company layout instead of the full bb chrome: brand, chat-title search, New chat, Projects, Team, Organization (admins: members, roles, invitations at `/ix/organization`), Chats, and the signed-in person. Threads, the composer and realtime updates are the same bb views; only the sidebar and the organization page differ. `shell: "full"` or no value keeps the full app. `composer: "locked"` additionally hides the model and permission controls from members and viewers in the simple shell (default `open`).

## Nexus shell

`shell: "nexus"` (`bb ix brand set '{"name":"Advisy","appTitle":"Nexus","shell":"nexus"}'`) renders an AI-employee layout modeled on Viktor: a 248px sidebar (brand tile from `iconUrl`, `appTitle` and the company name; Home, Integrations, Scheduled, Skills, Spaces, Docs; the chat list with working spinner, unread dot, and archive/rename/pin/read actions; the signed-in person's menu with Settings, Appearance, Archived chats, Organization for admins, Reset my desk and Sign out) and a main column inset on the sidebar color with a 56px top bar (sidebar toggle, breadcrumb, "Search or jump to…" and New chat). On settings routes the sidebar body swaps to bb's settings navigation. Nav mapping: Home `/` (the real root compose view, with a greeting, starter chips that prefill the composer, recent chats and a setup checklist), Integrations `/plugins`, Scheduled the automations panel when that plugin is installed (else `/ix/scheduled`, a placeholder), Skills `/skills`, Spaces `/ix/spaces` (projects), Docs `/ix/docs` (placeholder). Shortcuts: the `thread.search` binding (⌘K by default) opens the Nexus palette (pages, chats, actions, and "All commands" for bb's palette), ⌘B toggles the sidebar, ⌘Enter outside a text field starts a new chat. The sign-in screen becomes a split layout (story panel with `loginTitle`/`loginSubtitle`, the existing form on the right). Manrope is applied by `data-ix-shell="nexus"` on the document root only while the shell or its sign-in is mounted; colors come from the theme tokens (`--sidebar*`, `--primary`, `--background`), so the workspace theme drives light and dark. `composer: "locked"` applies to the nexus shell as it does to the simple one. Code lives in `apps/app/src/components/ix/nexus/*`.

## Project access

`bb ix access mode restricted` (or Organization → Project access) limits members and viewers to the projects an admin grants (`read` = see the project and open their own chats, `write` = also start chats and send) and to chats they created; owners and admins see everything. Enforcement is server-side: the project/thread/environment lookups, the list and search queries, realtime subscriptions and fan-out, and a deny list for host files, host browsing, terminals and project settings. Chat ownership is recorded at thread creation (agent child chats inherit their parent's owner) in `ix_thread_owner`. `GET /api/ix/access`, `PUT /api/ix/access/mode`, `PUT /api/ix/access/members/:memberId/projects/:projectId`; CLI `bb ix access show|mode|grant`.

## Plugins act as the person

While a plugin handles a member's or viewer's RPC call, CLI command or HTTP route, every `bb.sdk` request it makes carries `x-bb-ix-on-behalf` with a per-call token held only in server memory (`apps/server/src/ix/on-behalf.ts`). The gate accepts it from loopback without an Origin, outside `/api/v1/plugins/*`, and runs the request as that person: project grants, chat visibility, the restricted deny list (host files, hosts, terminals) and the viewer write rule all apply, with `/files/read|list|paths|previews` counted as reads. Owners, admins, plugin callers and owner-level callers are unchanged. The token dies when the call returns; a late request without a live token falls back to the plugin's normal owner access.

## Chat sharing

Every chat has a share mode (`private`, `project`, `workspace`, stored in `ix_thread_share`) plus a list of specific people (`ix_thread_member (thread_id, user_id, added_by, added_at)`, kept on the root chat; sub-agent chats follow the root's people). Added people see the chat in their lists, open it by link, send, get its realtime events and can leave; a restricted member added to a chat in a project they were not granted gets that chat (and, for reads, that project's attachments) and nothing else in the project, which still appears in their sidebar only to hold the chat. Every visibility path honors it: the per-id lookups, thread list, count, running, search, mentions, queue, attention, prompt history (global and per project), project lists, attachment content and socket subscriptions/fan-out.

The workspace policy lives in `ix_kv` (`thread_share:policy`): `defaultShare` for new chats, `allowedShares` (any of `private`, `project`, `workspace`, `people`; owners and admins are not limited; `people` also permits `private`), `whoCanChange` (`starter` | `starter_and_admins` | `participants` = anyone who can see the chat normally), `participantsCanAdd` (added people may add others) and `adminsSeeAll` (owners and admins can read any chat; writes return `403 ix_oversight_read_only`). `GET /api/ix/sharing-policy` (any member) / `PUT` (admins). Per chat: `GET|PUT /api/ix/threads/:id/share` (the view carries `people`, `canChange`, `canAdd`, `canRemove`, `canLeave`, `allowedShares` and a plain-language `reason`/`addReason`), `POST /api/ix/threads/:id/people { userIds }`, `DELETE /api/ix/threads/:id/people/:userId` (your own id leaves). `PUT /api/ix/access/thread-default` still works and writes `defaultShare`.

The sender of each user turn is recorded in `ix_turn_sender (thread_id, sequence, user_id)` keyed by the `client/turn/requested` event sequence (the timeline row's `messageSeq`); turns dispatched later outside a request (queued messages, async first turns) take the chat's latest sender, else its owner. `GET /api/ix/threads/:id/senders` returns `{ multi, senders }`; the app shows the sender's initials and name above each user message once the chat has more than one person. Older messages have no record and show nothing.

CLI: `bb ix sharing show|policy [--default] [--allow] [--who-can-change] [--participants-can-add on|off] [--admins-see-all on|off]`, `bb ix chat share <threadId> [mode]`, `bb ix chat add <threadId> <emails...>`, `bb ix chat remove <threadId> <email>`, `bb ix chat leave <threadId>`.

## Remote control plane calls

A request to `/api/v1/plugins/<id>/http/...` that carries that plugin's own token in the `x-bb-plugin-token` header passes the ix gate as actor `plugin-token`; the route's own auth check still runs. This is how an ix control plane reaches a member server's ix-superadmin agent route through its tunnel. A wrong token, another plugin's token, a token in the query string, or any non-plugin path still needs a session.

## Scoped server tokens

Every chat's agent acts as a person, not as the owner. In team mode the server mints a token per chat and puts it in the agent environment as `BB_IX_TOKEN` (`thread-runtime-config.ts`, on thread start and every turn). The token is `ixt1.<b64url threadId>.-.<epoch>.<HMAC-SHA256>`, keyed by `<dataDir>/ix-agent-token-key` (32 random bytes, 0600, never leaves the server). It is bound to the chat; the gate resolves the person on every request as the chat's acting person: the latest turn's sender (walking up to 8 parent chats), else the chat's owner, else the workspace's first owner for chats with no person (loopback roots, legacy). It is deterministic for (chat, epoch), so the agent's environment never changes when someone else sends a message: provider CLIs that keep their shell environment for the whole session (Codex) act as the new sender on the next request instead of failing with 401. Tokens minted before this change (`ixt1.<thread>.<b64url userId>...`) still verify, but only while that person is still the acting person.

The `bb` CLI sends `Authorization: Bearer <token>` on every request and on its WebSocket upgrades (`cliFetch`, `createCliBbSdk`, `bb terminal attach`). The gate (`resolveIxActor`) checks the MAC and the epoch, loads the person's membership and role live, and requires that the chat still exists and that its acting person can still see it. The caller then becomes that person (`kind: "user"`, `via: { kind: "agent-token", threadId }`), so every role, project-grant, chat-visibility and plugin-admin check applies: a member's chat gets member power (403 on plugin install, no other people's private chats), an owner's chat keeps owner power. A presented but invalid, tampered, earlier-epoch or no-longer-matching token gets `401 ix_invalid_token`; it never falls back to a session or the loopback owner. A shared chat whose latest sender is a member runs with that member's power, even if an owner started it.

Terminals get a person-only token for whoever opened them (`ixt1.-.<user>...`). Host and plugin environment entries named `BB_IX_TOKEN` or `BB_IX_OWNER_TOKEN_FILE` are dropped before the core token is added, and the launcher strips both from the server and daemon environments; agents never receive the owner token path.

Owner token: on start the server writes `<dataDir>/ix-owner-token` (0600, `ixo1.<epoch>.<HMAC>`) and sets `BB_IX_OWNER_TOKEN_FILE` on itself, so its own subprocesses (server-side plugins running `bb`, `BB_CLI` children, ix-superadmin's local `bb admin`) act as owner. It is accepted only from loopback without an `Origin` or proxy header and resolves to the `loopback-owner` actor (`via: "owner-token"`). The CLI picks a token in this order: `BB_IX_TOKEN`, then the file named by `BB_IX_OWNER_TOKEN_FILE` (an error if unreadable), then `<BB_DATA_DIR>/ix-owner-token` if present. `POST /api/ix/tokens/rotate` (owner; CLI `bb ix tokens rotate`) bumps the epoch in `ix_kv` (`agent_token:epoch`), which revokes every agent token and rewrites the owner token file; running chats get fresh tokens on their next turn.

Plugin CLI calls (`POST /api/v1/plugins/:id/cli`) made with a chat token get `ctx.threadId` and `ctx.projectId` forced to that chat, whatever the CLI sent, and `ctx.experimental_user` set to its person (see `docs/api_to_audit.md`).

Host enroll keys: `POST /internal/hosts/enroll-key` additionally needs `Authorization: Bearer <owner token>` in team mode (`403 ix_enroll_forbidden` otherwise). The launcher's auto-join reads `<dataDir>/ix-owner-token` and sends it, so first-boot enrollment still works.

Same-uid limits: an agent running as the server's unix user can still read `ix-owner-token`, `ix-agent-token-key` or `bb.db` directly. Tokens stop accidental and casual owner power; separating the agent's uid is the next stage.

### Switching a server to `BB_IX_AUTH_LOOPBACK=deny`

Per workspace, after deploying a build with scoped tokens:

1. Restart the server once with the new build (loopback still `owner`). Check `<dataDir>/ix-owner-token` exists, mode 0600, owned by the service user.
2. Point operator helpers at it: `/srv/<ws>/bin/ix` runs `bb` with `BB_IX_OWNER_TOKEN_FILE=/srv/<ws>/data/ix-owner-token` (or `BB_DATA_DIR=/srv/<ws>/data`) kept in its environment allowlist; same for ix-superadmin's `fleetBbCommand`. Verify `/srv/<ws>/bin/ix ix me` prints `Actor: owner (owner token file)`.
3. Start a new turn in an existing chat and confirm from inside it that `bb ix me` prints the chat's person `via chat <id>'s scoped token`.
4. Add `Environment=BB_IX_AUTH_LOOPBACK=deny` to the unit, `systemctl daemon-reload`, restart.
5. Verify: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/api/v1/system/config` returns `401`; `/srv/<ws>/bin/ix status` works; a member's chat gets 403 from `bb plugin install`; an owner's chat still can.

Rollback: remove the `Environment=` line and restart (loopback goes back to owner; tokens keep working).

### Agents as a separate unix user (Stage B)

On ix hosts the server (`bb-server`) and the host daemon (`bb-host-daemon`) run as two systemd units: the server as `<user>`, the daemon and every agent it spawns as `<user>-agent`. The daemon unit bind-mounts `/srv/<ws>/agent` over `/srv/<ws>/data`, so the daemon and agents see their own tree at the same absolute paths and never see `bb.db`, `ix-owner-token`, `ix-agent-token-key`, `ix-secrets.conf` or plugin data. The server keeps a copy of the daemon's `host-id` in its own data directory, which is how it still finds its local daemon. Runbook: `ix-canary/STAGE-B-RUNBOOK.md`.

`BB_HOST_AUTH_FILE=<path>` (daemon, optional): the daemon reads its enrolled auth (`{ hostId, hostKey }`) from that file once at start, deletes it, and never writes `<data>/auth.json`. With it the host key is out of reach of agents that share the daemon's unix user: the unit copies a root-owned `/etc/ix/<ws>/host-auth.json` to a runtime directory in `ExecStartPre=+`, and the daemon removes it before any agent starts. The launcher counts the file as enrolled. A missing file is a startup error, never a re-enrollment.

## Upstream files touched (keep this list exact)

| File | Insert | Why |
|---|---|---|
| `apps/server/src/types.ts` | `ixAuth: IxAuthService` on `AppDeps` + import | the service rides on deps |
| `apps/server/src/start-server.ts` | create `ixAuth` after `machineAuth.ensureReady()`; `ixAuth,` in the `createApp` deps | construction |
| `apps/server/src/server.ts` | `publicApi.use("*", ixApiGate({ ...deps, pluginToken: (id) => pluginService.httpToken(id), pluginRouteAuth: … }))` after the browser-origin gate; `mountIxAuthHandler` + `app.route("/api/ix", …)` before `app.route("/api/v1", publicApi)`; `await assertIxWebSocketAllowed` in the `/ws` upgrade (callback made `async`) | the gate |
| `apps/server/src/server.ts` | `pluginCaller: (token) => …resolveRpcCaller…` in the `ixApiGate` deps | plugin-to-plugin RPC under loopback deny |
| `apps/server/src/services/plugins/plugin-service.ts` | viewer refusal at the top of `invokeRpcHandler` unless the method's `viewer` flag is set | viewers are read-only on plugin RPC |
| `apps/server/src/services/plugins/plugin-api.ts`, `packages/plugin-sdk/src/internal/host-policy.ts`, `packages/plugin-sdk/src/rpc-contract.ts` | `experimental_viewer` on `PluginRpcMethodContract`, read into the handler record as `viewer` | viewers are read-only on plugin RPC |
| `plugins/{thread-list,inline-vis,docs,github-pr-status,workflows,automations}` | `experimental_viewer: true` on their read methods | viewers can still browse |
| `apps/server/src/routes/plugins.ts` | `runIxOnBehalfOf(getIxActor(context), …)` around plugin RPC, CLI and HTTP invocations | plugin SDK calls act as the person |
| `apps/server/src/services/plugins/plugin-runtime.ts`, `plugin-rpc-caller.ts` | `withIxOnBehalfHeader` on every plugin SDK request | plugin SDK calls act as the person |
| `apps/server/src/ws/hub.ts` | `notifyPluginSignal` filters by the payload's `threadId` | plugin signals about a chat reach only people who can see it |
| `apps/server/src/services/plugins/plugin-api.ts`, `packages/plugin-sdk/src/backend-contract.ts`, `packages/plugin-sdk/src/testing/fake-plugin-host.ts` | `bb.server.experimental_personCanSeeThread` | per-person push delivery |
| `plugins/push-notifications` | devices record their person; people list and remove only their own; phones get a chat only if their person can see it | push notifications per person |
| `apps/app/src/components/layout/AppLayout.tsx` | `useIxShell()`; `<SimpleSidebar />` in place of `<AppLayoutSidebar>` and `<IxOrganizationView />` in place of `children` on `/ix/organization` when the brand sets `shell: "simple"`; header hidden on that route | simple company shell |
| `apps/app/src/components/layout/AppLayout.tsx` | `<NexusSidebar />` in place of `<AppLayoutSidebar>`, `<NexusMain>` (top bar + content) in place of `AppHeader` + `<main>`, 248px width in `SidebarStateBridge`, no trigger overlay, when the brand sets `shell: "nexus"` | Nexus shell |
| `apps/app/src/views/RootComposeSecondaryContent.tsx` | `<NexusHomeHero />` before and `<NexusHomeSections />` after the root promptbox (each renders nothing outside the nexus shell) | Nexus home |
| `apps/server/src/services/lib/entity-lookup.ts` | `assertIxProjectAccess` in `requirePublicProject` and `requireEnvironment`, `assertIxThreadAccess` in `requirePublicThread` | project access: per-id routes |
| `apps/server/src/services/threads/thread-create-helpers.ts` | `noteIxThreadCreated(thread)` after `createThread` | chat ownership |
| `apps/server/src/routes/projects.ts` | `filterIxProjects` / `filterIxThreads` in the sidebar and project-list builders | project access: lists |
| `apps/server/src/routes/threads/base.ts` | `ixScopedThreadIds`, `filterIxThreads`, `filterIxThreadsById`, `filterIxSearchGroup` in count, running, list, search, resolve-mentions | project access: lists |
| `apps/server/src/routes/environments.ts`, `routes/queue.ts`, `routes/prompt-history.ts` | `filterIxByProjectId`, `filterIxByThreadId`, `ixRestricted()` | project access: lists |
| `apps/server/src/services/prompt-history.ts` | `filterIxByThreadId(acceptedEntries)` in `listProjectPromptHistory` + import | chat sharing: prompt history |
| `apps/server/src/routes/projects.ts` | `allowIxChatProjectRead` before `requirePublicProject` in attachment content | chat sharing: attachments for added people |
| `apps/server/src/services/threads/thread-events.ts` | `noteIxTurnRequested(...)` after each `client/turn/requested` append + import | chat sharing: per-turn sender |
| `apps/app/src/components/thread/timeline/ThreadTimelineRows.tsx` | fragment with `<IxMessageSender row={row} />` before the user `ConversationMessageContent` + import | chat sharing: sender above user messages |
| `apps/server/src/ws/hub.ts` | `setSocketAccessFilter` and per-socket checks in subscribe, fan-out, thread-list, broadcasts and timeline signals | project access: realtime |
| `packages/db/src/data/threads.ts` | `threadIds` filter on `countThreads` | restricted counts in SQL |
| `apps/server/src/routes/system.ts` | attention dot over `ixScopedThreadIds(undefined)` | project access: attention |
| `apps/server/src/routes/system.ts` | appearance read/write through `ixDeskAppearance` / `setIxDeskAppearance` | personal desk: theme |
| `apps/server/src/internal/tool-calls.ts` | plugin tool ctx gets `experimental_user` (thread owner) | per-person tools |
| `apps/server/src/services/threads/thread-runtime-config.ts` | instruction providers get `experimental_user` | per-person tools |
| `packages/plugin-sdk/src/backend-contract.ts` | `experimental_user` on `PluginAgentToolContext` and the instruction provider ctx | per-person tools |
| `apps/server/src/services/plugins/plugin-api.ts` | internal instruction provider ctx type | per-person tools |
| `apps/server/src/routes/ui-preferences.ts` | get/put/delete through `overlayIxDeskPreferences` / `writeIxDeskPreference` / `resetIxDeskPreference` | personal desk: layout |
| `apps/server/src/routes/plugins.ts` (mention search) | project/thread check, no plugin mentions for restricted members (plugins search as owner) | project access: mentions |
| `apps/app/src/components/promptbox/ExecutionControls.tsx`, `components/pickers/PermissionModePicker.tsx` | hidden for staff (`useIxStaffShell()`) in the simple shell | simple shell |
| `apps/server/src/routes/plugins.ts` | `withIxUser(callerResolution.caller, getIxActor(context))` + import | identity to plugins |
| `apps/server/test/helpers/test-app.ts` | create `ixAuth` (mode off) and pass it in deps | upstream tests keep passing |
| `packages/plugin-sdk/src/rpc-contract.ts` | `experimental_user?` on the client caller; `ExperimentalPluginRpcCallerUser` | SDK type |
| `packages/plugin-sdk/src/__tests__/rpc-contract.test.ts`, `__tests__/public-types.test.ts` | widened assertion; new export listed | upstream tests |
| `apps/app/src/components/onboarding/OnboardingGate.tsx` | export wraps `IxAuthGate` around the original body | sign-in screen |
| `apps/app/src/components/settings/settings-nav.tsx` | `settingsSectionAllowed(section.id) &&` + import | role-gated settings |
| `apps/app/src/components/onboarding/OnboardingViews.tsx` | import; `<BrandLogo alt={productName} …>` wrapped around the onboarding header logo `img` | brand logo in onboarding chrome |
| `apps/app/src/components/settings/UpdatesSettingsSection.tsx` | import; `<BrandLogo className="size-4 -translate-y-px">` wrapped around the app row's `BbLogo` | brand logo on the About/Updates card |
| `plugins/bb-guide/skills/bb-cli/references/command-index.md` | `bb ix brand asset`, `asset set`, `asset clear`, `ix sharing`, `ix chat`, `ix tokens` lines | CLI coverage test lists every command |
| `apps/server/src/services/threads/thread-runtime-config.ts` | `withoutReservedIxEnv(...)` around the host + plugin env merge, then `ixAgentTokenEnv({ threadId })` | scoped tokens: agent env |
| `apps/server/src/services/terminals/terminal-session-lifecycle.ts` | `ixTerminalTokenEnv(...)` around `resolveHostEnvironment` in `terminal.open` + import | scoped tokens: terminal env |
| `apps/server/src/routes/plugins.ts` (plugin CLI) | `ixBindPluginCliContext(getIxActor(context), ctx, ...)` around the `runCliCommand` ctx + `getThread` import | scoped tokens: thread-bound plugin CLI |
| `apps/server/src/internal/hosts.ts` | `assertIxEnrollAllowed(deps.ixAuth, ...)` after `assertLoopbackRequest` + import | scoped tokens: enroll-key gate |
| `apps/server/src/start-server.ts` | set `BB_IX_OWNER_TOKEN_FILE` on the server process to `ixAuth.ownerTokenPath` in team mode | owner token for server subprocesses |
| `packages/plugin-sdk/src/backend-contract.ts` | `experimental_user` on `PluginCliContext` | thread-bound plugin CLI |
| `packages/config/src/runtime.ts` | `BB_IX_TOKEN`, `BB_IX_OWNER_TOKEN_FILE` in `THREAD_CONTEXT_ENV_KEYS` | never forwarded to server or daemon |
| `packages/config/src/env-vars.ts`, `packages/config/src/host-daemon-entrypoint.ts` | `BB_HOST_AUTH_FILE_ENV` and its read into `HostDaemonEntrypointConfig.BB_HOST_AUTH_FILE` | Stage B: host key out of agents' reach |
| `apps/host-daemon/src/index.ts`, `apps/host-daemon/src/start-host-daemon.ts`, `apps/host-daemon/src/auth-state.ts` | `authFile` option; `takeHostAuthStateFile` read-and-delete in place of `readHostAuthState`; no `auth.json` write when it is set | Stage B: host key out of agents' reach |
| `packages/bb-app/src/launcher.ts`, `packages/scripts/src/commands/run-host-daemon.ts` | read `<dataDir>/ix-owner-token` and send it on the enroll-key request; the launcher also counts an existing `BB_HOST_AUTH_FILE` as enrolled | enroll-key gate; Stage B |
| `apps/cli/src/client.ts`, `apps/cli/src/commands/terminal.ts` | bearer token on `cliFetch`, SDK websocket and terminal attach | CLI sends the token |
| `packages/sdk/src/node-websocket.ts` | optional `headers` on `createNodeWebsocketFactory` | CLI websocket auth |

Everything else lives in `apps/server/src/ix/*` (`auth-service`, `middleware`, `routes`, `context`, `config`, `kv`, `brand`, `brand-assets`, `sso`, `test-harness` and the `*.test.ts` files), `apps/app/src/components/ix/*` (`IxAuthGate`, `ix-auth`, `BrandLogo`, `SimpleSidebar`, `IxOrganizationView`, the `nexus/` shell and their tests), `apps/app/src/lib/ix/brand.ts`, `docs/ix/*`, `scripts/ix/*`.

## Syncing with upstream

```bash
scripts/ix/sync-upstream.sh            # rebase ix onto origin/main, verify, report
scripts/ix/sync-upstream.sh desktop-v0.48.0   # or onto a release tag
```

The script fetches upstream, rebases the `ix` branch, then runs `scripts/ix/check-markers.sh` (every insert above must still be present), typechecks `@bb/server`, `@bb/app`, `@get-bb/plugin-sdk`, and runs the server and SDK tests. A conflict stops the rebase with the file list; resolve, `git rebase --continue`, rerun the script. Tag the result `ix-v<bb version>` and push `ix` + the tag to the fork.

Expect conflicts in `server.ts` and `start-server.ts` (hot upstream files). Each of our inserts there is one or two lines next to a stable anchor, so resolution is "keep both".

## Not in this patch (on purpose)

- Per-project membership. Workspace = server; ix-superadmin keeps the directory across servers.
- Email delivery for invitations.
- The desktop app's own window still talks to a local server as loopback owner.
- Agents run as the server's unix user, so a hostile agent can still read the owner token file or the token key from disk (see Scoped server tokens).

## Personal desks

Each signed-in person has their own desk on the shared server: a personal theme and personal UI preferences (sidebar, visible plugin pages, panel order and every other `UI_PREFERENCE_KEYS` entry) stored in `ix_desk_pref`, layered over the workspace defaults. Requests without a signed-in person (CLI, loopback, snapshots) read and write the workspace defaults. Admins lock either area with `bb ix desk policy --theme locked|allowed --layout locked|allowed` or the Organization page; while locked, staff get `403 ix_desk_locked`, admins write the workspace default, and nobody's personal rows are applied. `DELETE /api/ix/desk` ("Reset my desk") drops a person's rows.
