import { access, constants } from "node:fs/promises";
import { spawn } from "node:child_process";
import dotenv from "dotenv";
import { App, LogLevel } from "@slack/bolt";
import { loadConfig } from "./config.js";
import { chooseRoute, isAuthorized, splitSlackText } from "./guards.js";
import { downloadMedia, supportedMedia, type SlackMediaFile } from "./media.js";
import { runAntiGravity, runCodex } from "./runner.js";

dotenv.config({ path: process.env.ENV_FILE ?? ".env", quiet: true });
const config = loadConfig();

type MentionEvent = {
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  team?: string;
  bot_id?: string;
  subtype?: string;
  files?: SlackMediaFile[];
};

function gitRepositoryCheck(root: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      code === 0 && output.trim() === "true"
        ? resolve()
        : reject(new Error("WORKSPACE_ROOT must be inside a Git repository"));
    });
  });
}

await Promise.all([
  access(config.codexBin, constants.X_OK),
  access(config.agyBin, constants.X_OK),
  gitRepositoryCheck(config.workspaceRoot),
]);

const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

const seen = new Set<string>();
const lastRunByUser = new Map<string, number>();
let queue: Promise<void> = Promise.resolve();

function remember(key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  if (seen.size > 1_000) {
    const oldest = seen.values().next().value as string | undefined;
    if (oldest) seen.delete(oldest);
  }
  return true;
}

app.event("app_mention", async ({ event, body, client, logger }) => {
  const mention = event as unknown as MentionEvent;
  const teamId = mention.team ?? (body as { team_id?: string }).team_id;
  const channelId = mention.channel;
  const userId = mention.user;
  const eventTs = mention.ts;

  if (
    !isAuthorized(
      {
        teamId,
        userId,
        channelId,
        botId: mention.bot_id,
        subtype: mention.subtype,
      },
      config.slackTeamId,
      config.allowedUserIds,
      config.allowedChannelIds,
    ) ||
    !channelId ||
    !userId ||
    !eventTs ||
    !remember(`${teamId}:${channelId}:${eventTs}`)
  ) {
    return;
  }

  const mediaFiles = supportedMedia(mention.files ?? []);
  const selection = chooseRoute(mention.text ?? "", mediaFiles.length > 0);
  if (!selection.prompt) return;

  logger.info(
    `accepted request team=${teamId} channel=${channelId} user=${userId} route=${selection.route} media=${mediaFiles.length}`,
  );
  if (!config.executionEnabled) {
    logger.info("execution is disabled; no agent was invoked and no Slack message was sent");
    return;
  }

  const now = Date.now();
  const previous = lastRunByUser.get(userId) ?? 0;
  if (now - previous < config.rateLimitMs) {
    logger.warn(`rate-limited request user=${userId}`);
    return;
  }
  lastRunByUser.set(userId, now);

  const threadTs = mention.thread_ts ?? eventTs;
  queue = queue
    .then(async () => {
      let cleanup: (() => Promise<void>) | undefined;
      try {
        let result: string;
        if (selection.route === "antigravity") {
          const downloaded = mediaFiles.length
            ? await downloadMedia(
                mediaFiles,
                config.slackBotToken,
                config.maxMediaFiles,
                config.maxFileBytes,
              )
            : undefined;
          cleanup = downloaded?.cleanup;
          result = await runAntiGravity(
            selection.prompt,
            downloaded?.paths ?? [],
            downloaded?.directory,
            config,
          );
          result = `*AntiGravity / Gemini 3.7 Flash High*\n${result}`;
        } else {
          result = `*Codex*\n${await runCodex(selection.prompt, config)}`;
        }

        result = result.slice(0, config.maxOutputChars);
        if (!config.postingEnabled) {
          logger.info(`posting is disabled; generated ${result.length} characters locally`);
          return;
        }
        for (const chunk of splitSlackText(result)) {
          await client.chat.postMessage({ channel: channelId, thread_ts: threadTs, text: chunk });
        }
      } catch (error) {
        logger.error(error instanceof Error ? error.message : "unknown agent error");
        if (config.postingEnabled) {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: "処理に失敗しました。詳細はローカルログを確認してください。",
          });
        }
      } finally {
        await cleanup?.();
      }
    })
    .catch((error) => logger.error(error));
});

await app.start();
console.log(
  `Masa Agent Bridge started (execution=${config.executionEnabled}, posting=${config.postingEnabled})`,
);

async function shutdown(): Promise<void> {
  await app.stop();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
