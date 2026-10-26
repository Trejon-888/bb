# Application links experiment

The `applicationLinks` experiment makes explicit Markdown links such as
`[Open Linear](linear://issue/ABC-123)` and
`[Review note](reflect://note/Project%20X)` clickable. It defaults on for early
adopters and off otherwise. A user's explicit setting overrides either default.
Change it in Settings → Experiments or with
`bb settings experiment applicationLinks true|false`; SDK clients use
`sdk.system.updateExperiments({ applicationLinks: true })`.

Clicks ask for confirmation on the viewing device unless the user chose Always
allow for that URL scheme. Rendering and sending messages never launch apps.
Approvals persist in the native app's local store (across BB servers), or in
browser localStorage scoped to this BB origin. Settings lists approved schemes
and can revoke one or all; native mobile also has a device reset action. Native
launch failure does not save a new grant. Browser handoff cannot report launch
success reliably. Revocation invalidates remember choices still pending. Bare custom schemes
are not automatically linkified. HTTP(S) and existing editor file links retain
their existing routing.

## Boundaries and lifecycle

`@bb/domain/application-url` validates URLs and serializes confirmation/launch
attempts. Each client provides confirmation and device dispatch. Desktop uses a
dedicated IPC method and a native dialog attached to the originating window
(a sheet on macOS), mobile uses an acknowledged bridge version-3 request and
native alert, and the web fallback uses the shared
responsive dialog. Native boundaries validate the URL and require consent;
they do not trust a renderer-supplied approval. No automatic navigation or
popup handler gains permission to launch custom schemes.

The web client reads the resolved experiment from the system configuration
cache. While disabled or not yet loaded, Markdown leaves application links
inert and `navigate.openUrl` declines them. The shared dispatcher also checks
the experiment before admitting a request. Changes affect new requests;
a confirmation already presented can finish. The setting uses the existing
server experiment store: no database migration or host-daemon wire change is needed.
No server permission data is added. A local revision and scheme list track device
approvals. Desktop persists atomically under its user-data directory with a file
lock; mobile uses MMKV. The Node SDK and CLI can list/revoke the local desktop
store. Plugin surfaces use `navigate.openUrl` or shared Markdown for opening;
experimental app SDK APIs list/revoke through the same path as core Settings.

Executable web schemes, local-file launch schemes, selected dangerous OS
schemes, and editor schemes already handled as BB file links remain blocked
on this generic path. Validation preserves the original URL's encoding.
Concurrent requests do not stack prompts within a client (per window on
desktop). Closing the originating desktop window cancels its pending launch.
Cancelling releases the pending request without launching; native launch
failures propagate back to the page
and appear as a toast. A mobile confirmation request has a five-minute bridge
timeout, instead of the default ten seconds.

The desktop method is optional in the shared contract, and the mobile bridge
version is checked before dispatch. Older native clients show an update message
rather than falling back to browser navigation. Approval management requires bridge version 4; opening still works with version 3.
Existing mobile capabilities remain unchanged so older web clients can still parse the handshake.

## Review demo

Run `pnpm dev`, enable the experiment on that isolated server, and open
`/application-links-prototype.html` on its frontend URL. The editable examples
use the production Markdown renderer and confirmation dialog. This Vite entry
is for development and is not a production route. Reload the demo after
changing the experiment in another client.

## Verification and release limits

Restored approvals: focused domain, file-store, native adapter, Settings/plugin
SDK, bridge, and Plugin Guide tests passed, along with affected Turbo typechecks
and lint. Chromium exercised remember, reload, bypass, revoke, and fresh unchecked
confirmation at desktop and compact widths. Source CLI list/revoke used the same
local desktop file store. The rebuilt iOS app passed a real native Always allow →
Messages → restart BB → reopen without a prompt → Ask again → fresh native prompt
flow. Choosing Always allow for the uninstalled scheme left no saved approval;
the brief error toast was not captured in that rerun. Rebuilt Android passed the
same flow, including persistence across a cold emulator restart, reopening the
installed Messages app without confirmation, and revocation followed by a fresh
native prompt. Its initial System UI hang and disconnected ADB transport were
resolved by a cold restart of the isolated emulator.

The rebuilt desktop displayed its new native checkbox, but its checked/open flow
still needs a manual click: macOS explicitly denied assistive access to automation.
The historical native runs below predate restoring remembered approvals.

Focused tests cover blocked schemes, original URL preservation, cancellation,
repeat confirmation, failed-launch retries, overlapping requests, plain/HTML
Markdown, media restrictions, middle-clicks, experiment toggling, plugin URL
routing, native adapter decisions, old-client compatibility, and mobile request
acknowledgement after a delayed decision. Server tests cover defaults, stored
settings, and early-adopter overrides using the real database.

The source CLI successfully enabled and disabled the experiment on the isolated
dev server. The Settings toggle persisted its value. Chromium and iOS 26.5
Simulator Safari exercised confirmation, cancellation, and reopening. The
compact Chromium check confirmed that `#root` had neither `inert` nor
`aria-hidden`; desktop and compact screenshots were inspected.

Native Electron startup initially stalled in a macOS Keychain call. Reading
the saved-credential file before asking for encryption availability lets a
fresh profile start without an unnecessary Keychain lookup. A regression test
failed before this ordering fix and passed afterward; the rebuilt app now
creates its window and exposes the native application-link method. Native
confirmation is displayed. A manual Cancel click returned native response 0
and produced no OS launch call. A manual Open click on `linear://` returned
native response 1, completed the real `shell.openExternal` call, and opened
the installed Linear app as confirmed by the user. Native buttons were clicked
manually because the automation process lacks macOS Accessibility access.
After attaching the dialog to its originating window, the real macOS sheet
was displayed and cancelled twice without launching an app. The missing-app
error path has automated coverage but was not completed manually.

Rebuilt Release apps were exercised through Maestro on iOS 26.5 Simulator
(iPhone 17 Pro) and Android 16/API 36 (Pixel 9 emulator). Both displayed native
confirmation, kept BB open on Cancel, showed an error toast for
`bb-link-test-uninstalled://example`, and allowed another confirmation after
the failed launch. Both opened the installed Messages app through `sms:`;
returning to BB and tapping again required fresh confirmation. Android Back
also dismissed the alert without launching and allowed a subsequent attempt.
These checks used the real native bridge and OS URL handlers, with no mocked
consent or launch result. The review demo includes Messages for this check.

The iOS build used normal simulator signing and disabled Xcode's SDK stat
cache for this local run after that tool stalled. Android used the standalone
`bb dev` APK. The split development API and Vite frontend were served through
a temporary loopback proxy, with Android ports forwarded through adb.

Physical-device checks, other desktop platforms, the manual desktop
missing-app check, and live old-client update messages remain unverified.
Browser handoff may show a second prompt and cannot reliably report whether an
application was installed or opened. Safari checks are not native BB checks.
