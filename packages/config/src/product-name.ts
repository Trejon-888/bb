export const BB_PRODUCT_CLI_NAME = "bb";
export const IX_PRODUCT_CLI_NAME = "ix";
export const PRODUCT_CLI_ENV_NAME = "BB_IX_PRODUCT_CLI";

export type ProductCliName =
  | typeof BB_PRODUCT_CLI_NAME
  | typeof IX_PRODUCT_CLI_NAME;

interface ProductCliNameArgs {
  env?: NodeJS.ProcessEnv;
  scriptPath?: string | undefined;
}

export function invokedAsIx(scriptPath: string | undefined): boolean {
  if (scriptPath === undefined || scriptPath.length === 0) return false;
  const base = scriptPath.split(/[\\/]/u).pop() ?? "";
  return base.toLowerCase().startsWith(IX_PRODUCT_CLI_NAME);
}

export function productCliName(args: ProductCliNameArgs = {}): ProductCliName {
  const env = args.env ?? process.env;
  const scriptPath = "scriptPath" in args ? args.scriptPath : process.argv[1];
  const configured = env[PRODUCT_CLI_ENV_NAME];
  if (configured?.trim().toLowerCase() === IX_PRODUCT_CLI_NAME) {
    return IX_PRODUCT_CLI_NAME;
  }
  if (configured === undefined && invokedAsIx(scriptPath)) {
    return IX_PRODUCT_CLI_NAME;
  }
  return BB_PRODUCT_CLI_NAME;
}

export function productCliProgramName(
  suffix: string,
  args: ProductCliNameArgs = {},
): string {
  return `${productCliName(args)}${suffix}`;
}
