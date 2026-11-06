import {
  loadCommonConfig,
  loadLogLevelConfig,
  type LoadCommonConfigArgs,
  type LogLevelConfig,
} from "./common.js";
import { readEnvVarWithDefault, resolveEnvLoader } from "./env.js";
import {
  BB_LOG_ROTATE_SIZE_DEFAULT,
  BB_LOG_ROTATE_SIZE_ENV,
  BB_LOG_ROTATED_FILES_DEFAULT,
  BB_LOG_ROTATED_FILES_ENV,
} from "./env-vars.js";

export interface LogRotationConfig {
  BB_LOG_ROTATED_FILES: number;
  BB_LOG_ROTATE_SIZE: string;
}

interface LoggerConfig extends LogLevelConfig, LogRotationConfig {
  BB_DATA_DIR: string;
}

interface LoadLoggerConfigArgs extends LoadCommonConfigArgs {
  dataDir?: string;
}

export function loadLogRotationConfig(
  args: LoadCommonConfigArgs = {},
): LogRotationConfig {
  const loader = resolveEnvLoader(args);
  return {
    BB_LOG_ROTATED_FILES: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: BB_LOG_ROTATED_FILES_DEFAULT,
      definition: BB_LOG_ROTATED_FILES_ENV,
      env: loader.env,
    }),
    BB_LOG_ROTATE_SIZE: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: BB_LOG_ROTATE_SIZE_DEFAULT,
      definition: BB_LOG_ROTATE_SIZE_ENV,
      env: loader.env,
    }),
  };
}

export function loadLoggerConfig(
  args: LoadLoggerConfigArgs = {},
): LoggerConfig {
  const rotation = loadLogRotationConfig(args);
  if (args.dataDir !== undefined) {
    return {
      ...loadLogLevelConfig(args),
      ...rotation,
      BB_DATA_DIR: args.dataDir,
    };
  }

  return { ...loadCommonConfig(args), ...rotation };
}
