import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type SlackMediaFile = {
  id?: string;
  mimetype?: string;
  size?: number;
  url_private_download?: string;
  url_private?: string;
};

export type DownloadedMedia = {
  directory: string;
  paths: string[];
  cleanup: () => Promise<void>;
};

const extensions: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

export function supportedMedia(files: readonly SlackMediaFile[]): SlackMediaFile[] {
  return files.filter((file) => Boolean(file.mimetype && extensions[file.mimetype]));
}

export async function downloadMedia(
  files: readonly SlackMediaFile[],
  botToken: string,
  maxFiles: number,
  maxBytes: number,
): Promise<DownloadedMedia> {
  const selected = supportedMedia(files);
  if (selected.length === 0) throw new Error("対応する画像または動画がありません");
  if (selected.length > maxFiles) throw new Error(`添付は最大 ${maxFiles} 件までです`);

  const directory = await mkdtemp(join(tmpdir(), "slack-agent-media-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });

  try {
    const paths: string[] = [];
    for (const [index, file] of selected.entries()) {
      if (typeof file.size === "number" && file.size > maxBytes) {
        throw new Error(`添付 ${index + 1} はサイズ上限を超えています`);
      }
      const url = file.url_private_download ?? file.url_private;
      if (!url?.startsWith("https://")) throw new Error(`添付 ${index + 1} のURLが不正です`);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${botToken}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`添付 ${index + 1} の取得に失敗しました (${response.status})`);

      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > maxBytes) throw new Error(`添付 ${index + 1} はサイズ上限を超えています`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new Error(`添付 ${index + 1} はサイズ上限を超えています`);

      const slackMime = file.mimetype ?? "";
      const responseMime = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
      if (!extensions[slackMime] || (responseMime && responseMime !== slackMime)) {
        throw new Error(`添付 ${index + 1} のメディア形式を確認できませんでした`);
      }
      const extension = extensions[slackMime];
      if (!extension) throw new Error(`添付 ${index + 1} のメディア形式は未対応です`);
      const destination = join(directory, `media-${index + 1}${extension}`);
      await writeFile(destination, bytes, { mode: 0o600 });
      paths.push(destination);
    }
    return { directory, paths, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
