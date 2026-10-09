import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

export type BridgeConfig = {
  slackBotToken: string;
  slackAppToken: string;
  slackTeamId: string;
  allowedUserIds: ReadonlySet<string>;
  allowedChannelIds: ReadonlySet<string>;
  workspaceRoot: string;
  codexBin: string;
  agyBin: string;
  executionEnabled: boolean;
  postingEnabled: boolean;
  commandTimeoutMs: number;
  rateLimitMs: number;
  maxMediaFiles: number;
  maxFileBytes: number;
  maxOutputChars: number;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredSlackId(env: NodeJS.ProcessEnv, name: string, prefix: string): string {
  const value = required(env, name);
  if (!value.startsWith(prefix)) throw new Error(`${name} must begin with ${prefix}`);
  return value;
}

function parseIds(env: NodeJS.ProcessEnv, name: string, prefix: string): ReadonlySet<string> {
  const values = required(env, name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length === 0 || values.some((value) => !value.startsWith(prefix))) {
    throw new Error(`${name} must contain comma-separated Slack IDs beginning with ${prefix}`);
  }
  return new Set(values);
}

function parseBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function parseInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function existingAbsolutePath(env: NodeJS.ProcessEnv, name: string, executable = false): string {
  const raw = required(env, name);
  if (!isAbsolute(raw)) throw new Error(`${name} must be an absolute path`);
  const value = realpathSync(raw);
  if (executable) accessSync(value, constants.X_OK);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const executionEnabled = parseBoolean(env, "EXECUTION_ENABLED", false);
  const postingEnabled = parseBoolean(env, "POSTING_ENABLED", false);
  if (postingEnabled && !executionEnabled) {
    throw new Error("POSTING_ENABLED=true requires EXECUTION_ENABLED=true");
  }

  const workspaceRoot = existingAbsolutePath(env, "WORKSPACE_ROOT");
  if (!statSync(workspaceRoot).isDirectory()) throw new Error("WORKSPACE_ROOT must be a directory");

  return {
    slackBotToken: required(env, "SLACK_BOT_TOKEN"),
    slackAppToken: required(env, "SLACK_APP_TOKEN"),
    slackTeamId: requiredSlackId(env, "SLACK_TEAM_ID", "T"),
    allowedUserIds: parseIds(env, "ALLOWED_USER_IDS", "U"),
    allowedChannelIds: parseIds(env, "ALLOWED_CHANNEL_IDS", "C"),
    workspaceRoot,
    codexBin: existingAbsolutePath(env, "CODEX_BIN", true),
    agyBin: existingAbsolutePath(env, "AGY_BIN", true),
    executionEnabled,
    postingEnabled,
    commandTimeoutMs: parseInteger(env, "COMMAND_TIMEOUT_MS", 300_000, 10_000, 900_000),
    rateLimitMs: parseInteger(env, "RATE_LIMIT_SECONDS", 30, 1, 3600) * 1000,
    maxMediaFiles: parseInteger(env, "MAX_MEDIA_FILES", 3, 1, 5),
    maxFileBytes: parseInteger(env, "MAX_FILE_BYTES", 52_428_800, 1_024, 200_000_000),
    maxOutputChars: parseInteger(env, "MAX_OUTPUT_CHARS", 12_000, 500, 30_000),
  };
}
