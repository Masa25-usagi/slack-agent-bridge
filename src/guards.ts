export type AgentRoute = "codex" | "antigravity";

export type MentionIdentity = {
  teamId?: string;
  userId?: string;
  channelId?: string;
  botId?: string;
  subtype?: string;
};

export function isAuthorized(
  identity: MentionIdentity,
  expectedTeamId: string,
  allowedUserIds: ReadonlySet<string>,
  allowedChannelIds: ReadonlySet<string>,
): boolean {
  if (identity.botId || identity.subtype) return false;
  return (
    identity.teamId === expectedTeamId &&
    Boolean(identity.userId && allowedUserIds.has(identity.userId)) &&
    Boolean(identity.channelId && allowedChannelIds.has(identity.channelId))
  );
}

export function stripBotMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/gi, " ").replace(/\s+/g, " ").trim();
}

export function chooseRoute(text: string, hasMedia: boolean): { route: AgentRoute; prompt: string } {
  const cleaned = stripBotMentions(text);
  if (hasMedia) {
    return {
      route: "antigravity",
      prompt: cleaned || "添付された画像または動画を詳しく解析し、重要点を日本語で説明してください。",
    };
  }

  const explicit = cleaned.match(/^(codex|agy|antigravity)\s*[:：]?\s*(.*)$/i);
  if (!explicit) return { route: "codex", prompt: cleaned };
  const name = explicit[1]?.toLowerCase();
  return {
    route: name === "codex" ? "codex" : "antigravity",
    prompt: explicit[2]?.trim() ?? "",
  };
}

export function splitSlackText(text: string, limit = 3_500): string[] {
  const normalized = text.trim();
  if (!normalized) return ["（応答が空でした）"];

  const chunks: string[] = [];
  let rest = normalized;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < Math.floor(limit * 0.6)) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
