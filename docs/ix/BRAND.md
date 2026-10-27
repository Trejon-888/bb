# IX brand layer

The product reads "ix" wherever a human sees it, without a source-wide rename. Every change is a one- or two-line insert next to a stable anchor, or a new file, so upstream rebases stay cheap. This document is the exact inventory; `scripts/ix/check-markers.sh` asserts each insert is still present after a rebase.

## CLI name

| Invocation | Program name shown | Why |
|---|---|---|
| `bb`, `bb-app` | `bb`, `bb-app` | default |
| `ix`, `ix-app` | `ix`, `ix-app` | the invoked script's basename starts with `ix` |
| any bin with `BB_IX_PRODUCT_CLI=ix` | `ix` | explicit override; `BB_IX_PRODUCT_CLI=bb` forces `bb` even through the `ix` bin |

The decision lives in one module, `packages/config/src/product-name.ts` (`@bb/config/product-name`): `productCliName()` returns `"ix"` when `BB_IX_PRODUCT_CLI=ix`, or when that variable is unset and `process.argv[1]`'s basename starts with `ix`; otherwise `"bb"`. `productCliProgramName("-app")` yields `ix-app` / `bb-app`.

`packages/bb-app` ships two extra bins, `ix` and `ix-app`, built from `src/bin/ix.ts` and `src/bin/ix-app.ts`, which call the same `runBbCli` / `runBbApp` as `bb` / `bb-app`. The launcher sets `BB_IX_PRODUCT_CLI=ix` in its own environment when invoked through an `ix` bin, so the bundled CLI it spawns (whose `argv[1]` is the bundle, not `ix`) also prints `ix`.

Switched strings (headers only; example lines inside help and the guide still say `bb`):

- `apps/cli/src/index.ts`: commander `.name(productCliName())` (drives the `Usage: ix [options] [command]` line) and the description `IX CLI - manage your AI coding agents`.
- `apps/cli/src/commands/guide.ts`: the per-command head line in `ix guide commands` (`ix thread show <id>` …).
- `packages/bb-app/src/launcher.ts` `printBbAppHelp`: first line and the two `Usage:` lines read `ix-app`.

`bb-server` and `bb-host-daemon` keep their names; they are not user-facing entry points.

## Environment aliases

`packages/bb-app/src/ix-env-aliases.ts` runs once at launcher start (`runLauncherEntry`, before any bin's entry function): for every `IX_<X>` set in the environment, `BB_<X>` is set to the same value when `BB_<X>` is absent. The copy happens before the launcher reads any setting, and the launcher passes its environment to the server, host daemon and bundled CLI it spawns, so every `BB_*` knob in `docs/configuration.md` is also accepted as `IX_*`.

Exception: `IX_DATA_DIR` always wins over `BB_DATA_DIR` when both are set, so an ix-branded install can pin its data directory without caring what the shell inherited.

The default data directory is unchanged: `~/.bb` (`BB_PROD_DATA_DIR_NAME` in `@bb/config/runtime`). For an ix-branded install set `IX_DATA_DIR=~/.ix` (or `BB_DATA_DIR=~/.ix`) in the service environment or the shell profile. The default is not switched silently because existing `~/.bb` installs upgraded through the `ix` bin must keep finding their database. `bb-app config` / `bb-app env` store `BB_*` names; set `BB_*` there, not `IX_*`.

## App product name

`apps/app/src/lib/ix/brand.ts` exports:

- `PRODUCT_NAME` — the default, `"bb"`.
- `useProductName()` — a hook that fetches `GET /api/ix/brand` once (credentials included, result cached for the session) and returns `appTitle`, else `name`, else `PRODUCT_NAME`. A 404 or any error leaves the default in place.
- `productName()` — the last resolved value, for strings built outside React (toasts, title helpers). It is populated by the first `useProductName()` call, which the app layout makes on mount.

Places switched to the hook or getter (each one line, plus the import and a `const productName = useProductName();` line where a hook was needed):

| File | What |
|---|---|
| `apps/app/src/components/layout/AppLayout.tsx` | document title for `/` and the final fallback (was `"bb"` / `"BB"`) |
| `apps/app/src/components/layout/core-page-title.tsx` | section label fallback for focused page titles (was `"BB"`) |
| `apps/app/src/components/onboarding/OnboardingViews.tsx` | onboarding chrome logo `alt` (was `"bb"`) |
| `apps/app/src/components/onboarding/OnboardingFlow.tsx` | step headlines `Make … yours` and `Use … from anywhere` |
| `apps/app/src/components/sidebar/SidebarNavigationHeader.tsx` | sidebar header fallback toast "… so bb drew the … header instead" |
| `apps/app/src/components/settings/UpdatesSettingsSection.tsx` | the Updates/About card `aria-label` (the section that carries the server version line) |

There is no favicon label beyond the document title; the favicon images themselves are untouched. `apps/app/index.html` still ships `<title>bb</title>` and `apple-mobile-web-app-title="bb"` — the first is replaced at runtime by the app layout; the second only matters for iOS home-screen installs and is left for a later pass.

## Remaining literal "bb"/"BB" user-facing strings

Census method: `grep -rnE '(["'\''`> ]|^)(bb|BB)([ .,!?:;)"'\''`<]|$)' apps/app/src apps/cli/src --include='*.ts' --include='*.tsx'`, excluding tests, stories, imports, `@bb/` package names, `data-*`/`testid`/query-key identifiers, `"bb"` used as an enum/provider id, and storage keys shaped `bb.<segment>`. Run on 2026-10-27 after this patch: **391 lines** (185 in `apps/app/src`, 206 in `apps/cli/src`). Lines, not occurrences; a line with two mentions counts once.

Where they cluster:

| Area | Lines | Character |
|---|---|---|
| `apps/cli/src/commands/*` | 160 | command descriptions and help text that mention `bb` in prose (`bb plugin install <id>`, "machines bb manages", …). Top files: `plugin.ts` 39, `server.ts` 28, `settings.ts` 15, `server-move.ts` 15, `updates.ts` 14, `server-machine-service.ts` 11 |
| `apps/cli/src/*` (root) | 27 | `index.ts` quick-start block, error hints in `cli-error-output.ts`, `context-hints.ts`, `daemon.ts` |
| `apps/cli/src/commands/thread/*` | 19 | thread command descriptions |
| `apps/app/src/components/settings/*` | 51 | section copy: code renderer, updates/changelog aria-labels, mobile app, machines, experiments |
| `apps/app/src/components/plugin/management/*` | 20 | plugin browse and install copy ("BB Official", "bundled with bb") |
| `apps/app/src/components/tools/*` | 19 | skills collection provider label `bb` |
| `apps/app/src/lib/*` | 19 | plugin-frontend console warnings (`bb plugin "<id>": …`), command metadata labels |
| `apps/app/src/views/*` | 12 | settings view section copy |
| `apps/app/src/components/onboarding/*` | 12 | step descriptions ("bb runs the agents you already use", "bb connect …") |
| `apps/app/src/components/machines/*` | 9 | install and enrol copy |
| other (`secondary-panel`, `plugin/browse-hero`, `app-update`, `hooks/queries`, `dialogs`, `thread/timeline`, `code`) | ~24 | scattered one-offs; `ConversationMessageContent.tsx` uses `"BB"` as a `sourceName` |

Not counted: the `bb guide` chapters in `packages/templates/src/templates/bb-guide-*.md`, the `bb-guide` skill under `plugins/bb-guide`, `apps/app/index.html`, and the desktop shell. Those are a separate decision because the guide text is also an agent-facing manual that quotes commands verbatim.

Suggested next pass, if the count should go to zero: route the CLI descriptions through a `${productCliName()}` template in `command-groups.ts` registration time (one helper, many call sites) and the app copy through `useProductName()` per component; `SkillsCollection.tsx` needs the provider id `"bb"` kept as a value while its label switches.

## Upstream files touched by this layer

| File | Insert |
|---|---|
| `packages/config/package.json` | `./product-name` export entry |
| `packages/bb-app/package.json` | `ix-app` and `ix` in `bin` |
| `packages/bb-app/scripts/build.mjs` | `ix-app` and `ix` in `entrypoints` |
| `packages/bb-app/src/launcher.ts` | two imports; `applyIxEnvAliases(process.env);` first in `runLauncherEntry`; `productCliProgramName("-app")` for the `printBbAppHelp` header and `Usage:` lines |
| `apps/cli/src/index.ts` | import; `.name(productCliName())` and the description |
| `apps/cli/src/commands/guide.ts` | import; product name in the command head line |
| `apps/app/src/components/layout/AppLayout.tsx` | import; `useProductName()`; title fallback lines |
| `apps/app/src/components/layout/core-page-title.tsx` | import; `productName()` fallback |
| `apps/app/src/components/onboarding/OnboardingViews.tsx` | import; `useProductName()`; logo `alt` |
| `apps/app/src/components/onboarding/OnboardingFlow.tsx` | import; `useProductName()` in two step containers; two titles |
| `apps/app/src/components/sidebar/SidebarNavigationHeader.tsx` | import; `productName()` in the crash toast |
| `apps/app/src/components/settings/UpdatesSettingsSection.tsx` | import; `useProductName()`; card `aria-label` |

New files: `packages/config/src/product-name.ts`, `packages/bb-app/src/ix-env-aliases.ts`, `packages/bb-app/src/bin/ix.ts`, `packages/bb-app/src/bin/ix-app.ts`, `packages/bb-app/test/ix-env-aliases.test.ts`, `apps/app/src/lib/ix/brand.ts`, this document.
