import crypto from "node:crypto";
import fsp from "node:fs/promises";
import type { Db } from "@/db/client";
import { mediaAssets } from "@/db/schema";
import { getStorage } from "@/lib/storage";

export type AssetKind = (typeof mediaAssets.$inferInsert)["kind"];
export type AssetSource = (typeof mediaAssets.$inferInsert)["source"];

const EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "image/png": "png",
  "image/jpeg": "jpg",
  "audio/mpeg": "mp3",
  "application/x-subrip": "srt",
  "text/plain": "txt",
};

/** Store bytes (or a file) in object storage and register a media_assets row. */
export async function saveAsset(
  db: Db,
  a: {
    workspaceId: string;
    kind: AssetKind;
    mime: string;
    source: AssetSource;
    data?: Buffer;
    filePath?: string;
    fileName?: string;
    projectId?: string | null;
    productId?: string | null;
    rightsNote?: string | null;
    provider?: string | null;
    model?: string | null;
    prompt?: string | null;
    width?: number | null;
    height?: number | null;
    durationSec?: number | null;
  },
) {
  const id = crypto.randomUUID();
  const ext = EXT[a.mime] ?? "bin";
  const key = `ws/${a.workspaceId}/${a.projectId ? `projects/${a.projectId}` : "assets"}/${a.kind}-${id}.${ext}`;
  const storage = getStorage();
  let bytes = 0;
  if (a.data) {
    await storage.put(key, a.data, a.mime);
    bytes = a.data.length;
  } else if (a.filePath) {
    await storage.putFile(key, a.filePath, a.mime);
    bytes = (await fsp.stat(a.filePath)).size;
  } else throw new Error("saveAsset requires data or filePath");
  const [row] = await db
    .insert(mediaAssets)
    .values({
      id,
      workspaceId: a.workspaceId,
      kind: a.kind,
      storageKey: key,
      fileName: a.fileName ?? `${a.kind}.${ext}`,
      mime: a.mime,
      bytes,
      width: a.width ?? null,
      height: a.height ?? null,
      durationSec: a.durationSec ?? null,
      source: a.source,
      rightsNote: a.rightsNote ?? null,
      provider: a.provider ?? null,
      model: a.model ?? null,
      prompt: a.prompt ?? null,
      projectId: a.projectId ?? null,
      productId: a.productId ?? null,
    })
    .returning();
  return row;
}
