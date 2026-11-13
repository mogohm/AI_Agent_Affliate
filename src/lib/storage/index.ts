/**
 * Object storage abstraction. `local` writes under LOCAL_STORAGE_DIR (dev / single host);
 * `s3` targets any S3-compatible service (Cloudflare R2, AWS S3, MinIO). Objects are private;
 * browsers receive authenticated proxy URLs (/api/files/...) or short-lived signed URLs.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { env, isTrue } from "@/lib/env";

export interface StorageProvider {
  readonly driver: "local" | "s3";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  putFile(key: string, filePath: string, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Stream for HTTP responses; supports byte ranges for video seeking. */
  stream(key: string, range?: { start: number; end?: number }): Promise<{ body: ReadableStream; size: number }>;
  size(key: string): Promise<number>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Pre-signed download URL (s3) or null (local → use /api/files proxy). */
  signedUrl(key: string, expiresInSec?: number, downloadName?: string): Promise<string | null>;
}

function safeKey(key: string) {
  const k = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (k.split("/").some((p) => p === ".." || p === "")) throw new Error("Invalid storage key");
  return k;
}

class LocalStorage implements StorageProvider {
  readonly driver = "local" as const;
  constructor(private root: string) {}
  private p(key: string) {
    return path.join(this.root, ...safeKey(key).split("/"));
  }
  async put(key: string, body: Buffer) {
    const f = this.p(key);
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, body);
  }
  async putFile(key: string, filePath: string) {
    const f = this.p(key);
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.copyFile(filePath, f);
  }
  get(key: string) {
    return fsp.readFile(this.p(key));
  }
  async size(key: string) {
    return (await fsp.stat(this.p(key))).size;
  }
  async stream(key: string, range?: { start: number; end?: number }) {
    const size = await this.size(key);
    const node = fs.createReadStream(this.p(key), range ? { start: range.start, end: range.end ?? size - 1 } : undefined);
    return { body: Readable.toWeb(node) as ReadableStream, size };
  }
  async exists(key: string) {
    try {
      await fsp.access(this.p(key));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    await fsp.rm(this.p(key), { force: true });
  }
  async signedUrl() {
    return null;
  }
}

class S3Storage implements StorageProvider {
  readonly driver = "s3" as const;
  private clientP: Promise<import("@aws-sdk/client-s3").S3Client>;
  constructor(private bucket: string) {
    const e = env();
    this.clientP = import("@aws-sdk/client-s3").then(
      ({ S3Client }) =>
        new S3Client({
          region: e.S3_REGION,
          endpoint: e.S3_ENDPOINT || undefined,
          forcePathStyle: isTrue(e.S3_FORCE_PATH_STYLE),
          credentials: e.S3_ACCESS_KEY_ID ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? "" } : undefined,
        }),
    );
  }
  async put(key: string, body: Buffer, contentType: string) {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientP).send(new PutObjectCommand({ Bucket: this.bucket, Key: safeKey(key), Body: body, ContentType: contentType }));
  }
  async putFile(key: string, filePath: string, contentType: string) {
    await this.put(key, await fsp.readFile(filePath), contentType);
  }
  async get(key: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const r = await (await this.clientP).send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async size(key: string) {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const r = await (await this.clientP).send(new HeadObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    return Number(r.ContentLength ?? 0);
  }
  async stream(key: string, range?: { start: number; end?: number }) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const size = await this.size(key);
    const r = await (await this.clientP).send(
      new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key), Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined }),
    );
    return { body: r.Body!.transformToWebStream() as ReadableStream, size };
  }
  async exists(key: string) {
    try {
      await this.size(key);
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.clientP).send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
  }
  async signedUrl(key: string, expiresInSec = 600, downloadName?: string) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return getSignedUrl(
      await this.clientP,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        ResponseContentDisposition: downloadName ? `attachment; filename="${downloadName.replace(/"/g, "")}"` : undefined,
      }),
      { expiresIn: expiresInSec },
    );
  }
}

const g = globalThis as unknown as { __storage?: StorageProvider };

export function getStorage(): StorageProvider {
  if (!g.__storage) {
    const e = env();
    if (e.STORAGE_DRIVER === "s3") {
      if (!e.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
      g.__storage = new S3Storage(e.S3_BUCKET);
    } else {
      g.__storage = new LocalStorage(path.resolve(e.LOCAL_STORAGE_DIR));
    }
  }
  return g.__storage;
}

export function __setStorageForTests(s: StorageProvider | undefined) {
  g.__storage = s;
}

/** Public (authenticated) URL for an asset. */
export function assetUrl(assetId: string, download = false) {
  return `/api/files/${assetId}${download ? "?download=1" : ""}`;
}
