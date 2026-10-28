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
check apps/server/src/server.ts 'publicApi.use("*", ixApiGate({ ...deps, pluginToken: (id) => pluginService.httpToken(id) }));'
check apps/server/src/server.ts 'mountIxAuthHandler(app, deps);'
check apps/server/src/server.ts 'app.route("/api/ix", createIxRoutes(deps));'
check apps/server/src/server.ts 'await assertIxWebSocketAllowed(context, deps);'
check apps/server/src/routes/plugins.ts 'withIxUser(callerResolution.caller, getIxActor(context))'
check apps/server/test/helpers/test-app.ts 'createIxAuthService('
check packages/plugin-sdk/src/rpc-contract.ts 'experimental_user?: ExperimentalPluginRpcCallerUser'
check packages/plugin-sdk/src/__tests__/public-types.test.ts '"ExperimentalPluginRpcCallerUser"'
check apps/app/src/components/onboarding/OnboardingGate.tsx '<IxAuthGate>'
check apps/app/src/components/layout/AppLayout.tsx 'const ixShell = useIxShell();'
check apps/app/src/components/layout/AppLayout.tsx '<SimpleSidebar />'
check apps/app/src/components/layout/AppLayout.tsx '{ixOrganizationView ? <IxOrganizationView /> : children}'
check apps/app/src/components/settings/settings-nav.tsx 'settingsSectionAllowed(section.id)'
for f in apps/server/src/ix/auth-service.ts apps/server/src/ix/middleware.ts apps/server/src/ix/routes.ts apps/server/src/ix/context.ts apps/server/src/ix/config.ts apps/server/src/ix/kv.ts apps/server/src/ix/brand.ts apps/server/src/ix/sso.ts apps/server/src/ix/test-harness.ts apps/server/src/ix/brand.test.ts apps/server/src/ix/sso.test.ts apps/server/src/ix/brand-assets.ts apps/server/src/ix/brand-assets.test.ts apps/server/src/ix/social.test.ts apps/app/src/components/ix/IxAuthGate.tsx apps/app/src/components/ix/ix-auth.ts apps/app/src/components/ix/BrandLogo.tsx; do
  if [ -f "$f" ]; then echo "ok       $f"; else echo "MISSING  $f"; fail=1; fi
done
check packages/config/package.json '"./product-name"'
check packages/bb-app/package.json '"ix": "dist/ix.js"'
check packages/bb-app/package.json '"ix-app": "dist/ix-app.js"'
check packages/bb-app/scripts/build.mjs '["ix", "ix.js"]'
check packages/bb-app/scripts/build.mjs '["ix-app", "ix-app.js"]'
check packages/bb-app/src/launcher.ts 'applyIxEnvAliases(process.env);'
check packages/bb-app/src/launcher.ts 'productCliProgramName("-app")'
check apps/cli/src/index.ts '.name(productCliName())'
check apps/cli/src/command-groups.ts 'registerIxCommands'
check apps/cli/src/commands/ix.ts '"/api/ix/sso/secret", { secret: null }'
check docs/ix/FORK.md '## bb ix CLI'
check apps/cli/src/commands/guide.ts '`${productCliName()} ${names.join("")}`'
check apps/app/src/components/layout/AppLayout.tsx 'const productName = useProductName();'
check apps/app/src/components/layout/AppLayout.tsx 'location.pathname === "/" ? productName'
check apps/app/src/components/layout/core-page-title.tsx '?? productName()'
check apps/app/src/components/onboarding/OnboardingViews.tsx 'alt={productName}'
check apps/app/src/components/onboarding/OnboardingFlow.tsx 'title={`Make ${productName} yours`}'
check apps/app/src/components/onboarding/OnboardingFlow.tsx 'title={`Use ${productName} from anywhere`}'
check apps/app/src/components/sidebar/SidebarNavigationHeader.tsx 'so ${productName()} drew'
check apps/app/src/components/settings/UpdatesSettingsSection.tsx 'aria-label={productName}'
check apps/app/src/components/onboarding/OnboardingViews.tsx '<BrandLogo alt={productName}'
check apps/app/src/components/onboarding/OnboardingViews.tsx 'import { BrandLogo } from "@/components/ix/BrandLogo";'
check apps/app/src/components/settings/UpdatesSettingsSection.tsx '<BrandLogo className="size-4 -translate-y-px">'
check apps/app/src/components/settings/UpdatesSettingsSection.tsx 'import { BrandLogo } from "@/components/ix/BrandLogo";'
check plugins/bb-guide/skills/bb-cli/references/command-index.md '`bb ix brand asset set`'
for f in packages/config/src/product-name.ts packages/bb-app/src/ix-env-aliases.ts packages/bb-app/src/bin/ix.ts packages/bb-app/src/bin/ix-app.ts apps/app/src/lib/ix/brand.ts; do
  if [ -f "$f" ]; then echo "ok       $f"; else echo "MISSING  $f"; fail=1; fi
done
if [ -f apps/cli/src/product-cli-name.ts ]; then echo "ok       apps/cli/src/product-cli-name.ts"; else echo "MISSING  apps/cli/src/product-cli-name.ts"; fail=1; fi
exit $fail
