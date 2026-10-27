import {
  IX_PRODUCT_CLI_NAME,
  PRODUCT_CLI_ENV_NAME,
  invokedAsIx,
} from "@bb/config/product-name";

const IX_PREFIX = "IX_";
const BB_PREFIX = "BB_";
const IX_ALWAYS_WINS = new Set(["IX_DATA_DIR"]);

export function applyIxEnvAliases(
  env: NodeJS.ProcessEnv,
  scriptPath: string | undefined = process.argv[1],
): NodeJS.ProcessEnv {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(IX_PREFIX) || value === undefined) continue;
    const bbName = `${BB_PREFIX}${name.slice(IX_PREFIX.length)}`;
    if (env[bbName] === undefined || IX_ALWAYS_WINS.has(name)) {
      env[bbName] = value;
    }
  }
  if (env[PRODUCT_CLI_ENV_NAME] === undefined && invokedAsIx(scriptPath)) {
    env[PRODUCT_CLI_ENV_NAME] = IX_PRODUCT_CLI_NAME;
  }
  return env;
}
