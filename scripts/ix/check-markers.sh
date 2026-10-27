#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
fail=0
check() {
  local file="$1" pattern="$2"
  if ! grep -qF -- "$pattern" "$file"; then
    echo "MISSING  $file :: $pattern"
    fail=1
  else
    echo "ok       $file :: $pattern"
  fi
}
check apps/server/src/types.ts 'ixAuth: IxAuthService;'
check apps/server/src/start-server.ts 'createIxAuthService('
check apps/server/src/start-server.ts '      ixAuth,'
check apps/server/src/server.ts 'publicApi.use("*", ixApiGate(deps));'
check apps/server/src/server.ts 'mountIxAuthHandler(app, deps);'
check apps/server/src/server.ts 'app.route("/api/ix", createIxRoutes(deps));'
check apps/server/src/server.ts 'await assertIxWebSocketAllowed(context, deps);'
check apps/server/src/routes/plugins.ts 'withIxUser(callerResolution.caller, getIxActor(context))'
check apps/server/test/helpers/test-app.ts 'createIxAuthService('
check packages/plugin-sdk/src/rpc-contract.ts 'experimental_user?: ExperimentalPluginRpcCallerUser'
check packages/plugin-sdk/src/__tests__/public-types.test.ts '"ExperimentalPluginRpcCallerUser"'
check apps/app/src/components/onboarding/OnboardingGate.tsx '<IxAuthGate>'
check apps/app/src/components/settings/settings-nav.tsx 'settingsSectionAllowed(section.id)'
for f in apps/server/src/ix/auth-service.ts apps/server/src/ix/middleware.ts apps/server/src/ix/routes.ts apps/server/src/ix/context.ts apps/server/src/ix/config.ts apps/server/src/ix/kv.ts apps/server/src/ix/brand.ts apps/server/src/ix/sso.ts apps/server/src/ix/test-harness.ts apps/server/src/ix/brand.test.ts apps/server/src/ix/sso.test.ts apps/app/src/components/ix/IxAuthGate.tsx apps/app/src/components/ix/ix-auth.ts; do
  if [ -f "$f" ]; then echo "ok       $f"; else echo "MISSING  $f"; fail=1; fi
done
exit $fail
