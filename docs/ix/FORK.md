# IX fork of bb

This fork (`Trejon-888/bb`, branch `ix`) adds a feature-flagged multi-user layer to bb: human sign-in, one organization per server with members and roles, identity passed to plugins, and role-gated screens. Upstream is `get-bb/bb` (MIT). The patch is kept thin so it rebases onto every upstream release.

## Behavior

## bb ix CLI

The fork adds `bb ix status`, `brand get`, `brand set <json|@file|->`, `brand asset set <logo|favicon|icon> <file>`, `brand asset clear <kind>`, `sso-secret set [-]`, `sso-secret clear`, `members`, `invite <email> --role <owner|admin|member|viewer>`, and `me`. Requests use `BB_SERVER_URL` and `BB_SERVER_HEADERS`; `--json` prints the server's raw JSON response. Non-2xx responses exit with the server error code and message. The SSO secret is read from stdin only, never from an argument. `brand set` accepts inline JSON, a file prefixed with `@`, or stdin with `-`. Invitation output includes the `acceptUrl` to share. Clearing SSO sends `{ "secret": null }` and removes the stored secret. `brand asset set` reads the file, infers the content type from the extension (`.png`, `.svg`, `.ico`, `.webp`, `.jpg`/`.jpeg`; anything else is refused) and uploads it base64-encoded; `brand asset clear` sends `DELETE`.

| Setting | Values | Meaning |
|---|---|---|
| `BB_IX_AUTH` | `off` (default) / `team` | `off` keeps upstream behavior exactly. `team` requires a signed-in member for `/api/v1/*` and `/ws`. |
| `BB_IX_AUTH_LOOPBACK` | `owner` (default) / `deny` | In team mode, a loopback request with no `Origin` header (the `bb` CLI, plugins calling their own server) acts as the owner. `deny` turns that off. |
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

A workspace whose brand record has `shell: "simple"` (`bb ix brand set '{"shell":"simple"}'`, or pushed by ix-superadmin from an org brand) renders a calm company layout instead of the full bb chrome: brand, chat-title search, New chat, Projects, Team, Organization (admins: members, roles, invitations at `/ix/organization`), Chats, and the signed-in person. Threads, the composer and realtime updates are the same bb views; only the sidebar and the organization page differ. `shell: "full"` or no value keeps the full app.

## Project access

`bb ix access mode restricted` (or Organization → Project access) limits members and viewers to the projects an admin grants (`read` = see the project and open their own chats, `write` = also start chats and send) and to chats they created; owners and admins see everything. Enforcement is server-side: the project/thread/environment lookups, the list and search queries, realtime subscriptions and fan-out, and a deny list for host files, host browsing, terminals and project settings. Chat ownership is recorded at thread creation (agent child chats inherit their parent's owner) in `ix_thread_owner`. `GET /api/ix/access`, `PUT /api/ix/access/mode`, `PUT /api/ix/access/members/:memberId/projects/:projectId`; CLI `bb ix access show|mode|grant`.

## Remote control plane calls

A request to `/api/v1/plugins/<id>/http/...` that carries that plugin's own token in the `x-bb-plugin-token` header passes the ix gate as actor `plugin-token`; the route's own auth check still runs. This is how an ix control plane reaches a member server's ix-superadmin agent route through its tunnel. A wrong token, another plugin's token, a token in the query string, or any non-plugin path still needs a session.

## Upstream files touched (keep this list exact)

| File | Insert | Why |
|---|---|---|
| `apps/server/src/types.ts` | `ixAuth: IxAuthService` on `AppDeps` + import | the service rides on deps |
| `apps/server/src/start-server.ts` | create `ixAuth` after `machineAuth.ensureReady()`; `ixAuth,` in the `createApp` deps | construction |
| `apps/server/src/server.ts` | `publicApi.use("*", ixApiGate({ ...deps, pluginToken: (id) => pluginService.httpToken(id) }))` after the browser-origin gate; `mountIxAuthHandler` + `app.route("/api/ix", …)` before `app.route("/api/v1", publicApi)`; `await assertIxWebSocketAllowed` in the `/ws` upgrade (callback made `async`) | the gate |
| `apps/app/src/components/layout/AppLayout.tsx` | `useIxShell()`; `<SimpleSidebar />` in place of `<AppLayoutSidebar>` and `<IxOrganizationView />` in place of `children` on `/ix/organization` when the brand sets `shell: "simple"`; header hidden on that route | simple company shell |
| `apps/server/src/services/lib/entity-lookup.ts` | `assertIxProjectAccess` in `requirePublicProject` and `requireEnvironment`, `assertIxThreadAccess` in `requirePublicThread` | project access: per-id routes |
| `apps/server/src/services/threads/thread-create-helpers.ts` | `noteIxThreadCreated(thread)` after `createThread` | chat ownership |
| `apps/server/src/routes/projects.ts` | `filterIxProjects` / `filterIxThreads` in the sidebar and project-list builders | project access: lists |
| `apps/server/src/routes/threads/base.ts` | `ixScopedThreadIds`, `filterIxThreads`, `filterIxThreadsById`, `filterIxSearchGroup` in count, running, list, search, resolve-mentions | project access: lists |
| `apps/server/src/routes/environments.ts`, `routes/queue.ts`, `routes/prompt-history.ts` | `filterIxByProjectId`, `filterIxByThreadId`, `ixRestricted()` | project access: lists |
| `apps/server/src/ws/hub.ts` | `setSocketAccessFilter` and per-socket checks in subscribe, fan-out, thread-list, broadcasts and timeline signals | project access: realtime |
| `packages/db/src/data/threads.ts` | `threadIds` filter on `countThreads` | restricted counts in SQL |
| `apps/server/src/routes/system.ts` | attention dot over `ixScopedThreadIds(undefined)` | project access: attention |
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
| `plugins/bb-guide/skills/bb-cli/references/command-index.md` | `bb ix brand asset`, `asset set`, `asset clear` lines | CLI coverage test lists every command |

Everything else lives in `apps/server/src/ix/*` (`auth-service`, `middleware`, `routes`, `context`, `config`, `kv`, `brand`, `brand-assets`, `sso`, `test-harness` and the `*.test.ts` files), `apps/app/src/components/ix/*` (`IxAuthGate`, `ix-auth`, `BrandLogo` and their tests), `apps/app/src/lib/ix/brand.ts`, `docs/ix/*`, `scripts/ix/*`.

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
- Agent tool and CLI contexts do not carry the user (the daemon originates those); thread ownership is tracked by ix-superadmin's thread bindings.
