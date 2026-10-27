# IX fork of bb

This fork (`Trejon-888/bb`, branch `ix`) adds a feature-flagged multi-user layer to bb: human sign-in, one organization per server with members and roles, identity passed to plugins, and role-gated screens. Upstream is `get-bb/bb` (MIT). The patch is kept thin so it rebases onto every upstream release.

## Behavior

## bb ix CLI

The fork adds `bb ix status`, `brand get`, `brand set <json|@file|->`, `sso-secret set [-]`, `sso-secret clear`, `members`, `invite <email> --role <owner|admin|member|viewer>`, and `me`. Requests use `BB_SERVER_URL` and `BB_SERVER_HEADERS`; `--json` prints the server's raw JSON response. Non-2xx responses exit with the server error code and message. The SSO secret is read from stdin only, never from an argument. `brand set` accepts inline JSON, a file prefixed with `@`, or stdin with `-`. Invitation output includes the `acceptUrl` to share. Clearing SSO sends `{ "secret": null }` and removes the stored secret.

| Setting | Values | Meaning |
|---|---|---|
| `BB_IX_AUTH` | `off` (default) / `team` | `off` keeps upstream behavior exactly. `team` requires a signed-in member for `/api/v1/*` and `/ws`. |
| `BB_IX_AUTH_LOOPBACK` | `owner` (default) / `deny` | In team mode, a loopback request with no `Origin` header (the `bb` CLI, plugins calling their own server) acts as the owner. `deny` turns that off. |
| `BB_IX_AUTH_BOOTSTRAP_EMAIL` / `_PASSWORD` / `_NAME` | | Create the owner and the organization at first start. Otherwise the first visitor creates the owner in the app. |
| `BB_IX_AUTH_ORG_NAME` | default `Workspace` | Organization name used by bootstrap. |
| `BB_IX_AUTH_SESSION_DAYS` | default `30` | Session lifetime. |

Roles: `owner` > `admin` > `member` > `viewer`. Viewers can read everything but every non-GET `/api/v1` request is refused except marking threads read, UI preferences, and plugin RPC calls (plugins see the caller's role and gate their own writes). Admins manage members and invitations; only owners grant owner. The last owner cannot be demoted or removed.

Routes (all new, mounted at `/api/ix` and `/api/auth`):

- `GET /api/ix/status` (public; includes `brand`) · `GET /api/ix/brand` (public) · `POST /api/ix/bootstrap` · `POST /api/ix/sign-in` · `POST /api/ix/invitations/accept` · `POST /api/ix/sso/accept`
- `GET /api/ix/me` · `POST /api/ix/sign-out` · `PUT /api/ix/brand` (admin+) · `PUT /api/ix/sso/secret` (owner) · `GET /api/ix/members` · `POST /api/ix/members/invite` · `POST /api/ix/members/:id/role` · `DELETE /api/ix/members/:id` · `GET /api/ix/invitations` · `DELETE /api/ix/invitations/:id`
- `/api/auth/*` is better-auth's own handler (email + password, organization plugin). Tables are `ix_user`, `ix_session`, `ix_account`, `ix_verification`, `ix_organization`, `ix_member`, `ix_invitation`, created by better-auth's migrator at boot, outside Drizzle's journal. `ix_kv` (`key`, `value`, `updated_at`) is created next to them with `CREATE TABLE IF NOT EXISTS` and holds the brand record (`brand`), the SSO secret (`sso.secret`) and consumed SSO nonces (`sso.nonce.<nonce>` → expiry ms).

Brand: `PUT /api/ix/brand` replaces the record with `{ name?, logoUrl?, accent?, appTitle?, loginTitle?, loginSubtitle?, supportUrl?, faviconUrl? }` (all optional strings; URLs must be http(s); `accent` is a hex or functional CSS color; unknown fields are refused). Admins, owners and the loopback owner may write it; anyone may read it. The login screen uses `loginTitle`, `loginSubtitle`, `logoUrl`, `accent` and `supportUrl`; `IxAuthGate` sets `document.title` from `appTitle` when present. ix-superadmin resolves its org-tree brand (field-level inheritance) and pushes the resolved record here; the fork stores no inheritance of its own.

SSO: `PUT /api/ix/sso/secret { secret }` (owner or loopback owner, min 32 characters) stores the per-workspace HMAC secret that ix-superadmin's `workspace.setSso` shares. `POST /api/ix/sso/accept { token }` takes `base64url(payloadJson) + "." + base64url(hmacSha256(secret, payloadB64))` with payload `{ sub: email, name, role: owner|admin|member|viewer, workspaceId, exp: epoch seconds, nonce }`. It refuses with `401 ix_sso_<reason>` for `no_secret`, `malformed`, `bad_signature`, `expired` and `replayed` (nonces are remembered in memory and in `ix_kv` until they expire). On success it upserts the user by email (a random password if new; existing users keep their name), upserts the membership with the token's role but never lowers an existing member's role, creates a better-auth session directly and returns the session cookie plus `{ ok, userId, role }`. An `owner` token on a server with no organization yet creates the organization (`BB_IX_AUTH_ORG_NAME`); lesser roles get `409`. The app accepts `?ix-sso=<token>` on load, posts it, strips the parameter and refreshes. Every acceptance, refusal, secret rotation and brand write is a `logger.info` line prefixed `ix-sso:` / `ix-brand:`.

Plugins: in team mode the RPC caller a plugin receives is `{ kind: "client", experimental_user: { id, email, name, role } }`. ix-superadmin reads that to act as the signed-in member.

Invitations: `POST /api/ix/members/invite` returns `acceptUrl` (`<appUrl>/?ix-invite=<id>`); the app opens the accept screen when that query parameter is present. No email is sent; the admin shares the link.

Deployment: team mode is meant for a server behind your own reverse proxy with `BB_APP_URL` set to the public origin. The getbb.app Connect tunnel gates on the owner's session before the server sees a request, so it is not a path for other members.

## Upstream files touched (keep this list exact)

| File | Insert | Why |
|---|---|---|
| `apps/server/src/types.ts` | `ixAuth: IxAuthService` on `AppDeps` + import | the service rides on deps |
| `apps/server/src/start-server.ts` | create `ixAuth` after `machineAuth.ensureReady()`; `ixAuth,` in the `createApp` deps | construction |
| `apps/server/src/server.ts` | `publicApi.use("*", ixApiGate(deps))` after the browser-origin gate; `mountIxAuthHandler` + `app.route("/api/ix", …)` before `app.route("/api/v1", publicApi)`; `await assertIxWebSocketAllowed` in the `/ws` upgrade (callback made `async`) | the gate |
| `apps/server/src/routes/plugins.ts` | `withIxUser(callerResolution.caller, getIxActor(context))` + import | identity to plugins |
| `apps/server/test/helpers/test-app.ts` | create `ixAuth` (mode off) and pass it in deps | upstream tests keep passing |
| `packages/plugin-sdk/src/rpc-contract.ts` | `experimental_user?` on the client caller; `ExperimentalPluginRpcCallerUser` | SDK type |
| `packages/plugin-sdk/src/__tests__/rpc-contract.test.ts`, `__tests__/public-types.test.ts` | widened assertion; new export listed | upstream tests |
| `apps/app/src/components/onboarding/OnboardingGate.tsx` | export wraps `IxAuthGate` around the original body | sign-in screen |
| `apps/app/src/components/settings/settings-nav.tsx` | `settingsSectionAllowed(section.id) &&` + import | role-gated settings |

Everything else lives in `apps/server/src/ix/*` (`auth-service`, `middleware`, `routes`, `context`, `config`, `kv`, `brand`, `sso`, `test-harness` and the `*.test.ts` files), `apps/app/src/components/ix/*`, `docs/ix/*`, `scripts/ix/*`.

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
