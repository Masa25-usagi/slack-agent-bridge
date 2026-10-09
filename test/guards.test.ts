import assert from "node:assert/strict";
import test from "node:test";
import { chooseRoute, isAuthorized, splitSlackText, stripBotMentions } from "../src/guards.js";
import { supportedMedia } from "../src/media.js";

test("authorization requires exact team, user and channel IDs", () => {
  const users = new Set(["U123"]);
  const channels = new Set(["C123"]);
  assert.equal(
    isAuthorized({ teamId: "T123", userId: "U123", channelId: "C123" }, "T123", users, channels),
    true,
  );
  assert.equal(
    isAuthorized({ teamId: "T999", userId: "U123", channelId: "C123" }, "T123", users, channels),
    false,
  );
  assert.equal(
    isAuthorized(
      { teamId: "T123", userId: "U123", channelId: "C123", botId: "B123" },
      "T123",
      users,
      channels,
    ),
    false,
  );
});

test("media always routes to AntiGravity", () => {
  assert.deepEqual(chooseRoute("<@B123> codex この画像は何？", true), {
    route: "antigravity",
    prompt: "codex この画像は何？",
  });
});

test("explicit text routes are parsed without shell interpolation", () => {
  assert.deepEqual(chooseRoute("<@B123> agy: 要約して", false), {
    route: "antigravity",
    prompt: "要約して",
  });
  assert.deepEqual(chooseRoute("<@B123> codex 調べて", false), {
    route: "codex",
    prompt: "調べて",
  });
  assert.equal(stripBotMentions("<@B123>   hello"), "hello");
});

test("long Slack output is split within the limit", () => {
  const chunks = splitSlackText("a".repeat(9_000), 3_500);
  assert.equal(chunks.length, 3);
  assert.equal(chunks.every((chunk) => chunk.length <= 3_500), true);
});

test("only explicitly supported media types are accepted", () => {
  const files = supportedMedia([
    { mimetype: "image/png" },
    { mimetype: "video/mp4" },
    { mimetype: "image/svg+xml" },
    { mimetype: "application/pdf" },
  ]);
  assert.deepEqual(files.map((file) => file.mimetype), ["image/png", "video/mp4"]);
});
