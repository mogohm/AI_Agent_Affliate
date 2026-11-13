import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { env, isTrue } from "@/lib/env";
import { getDbDriver } from "@/db/client";

export function resolveFfmpegPath(): string {
  const p = env().FFMPEG_PATH;
  if (p) return p;
  return path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
}

function ffmpegVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ["-hide_banner", "-version"], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.split("\n")[0]?.trim() || "unknown");
    });
  });
}

const FONT_FILES = ["IBMPlexSansThai-Regular.ttf", "IBMPlexSansThai-Bold.ttf", "Kanit-Bold.ttf", "Kanit-ExtraBold.ttf"];

/** Media pipeline readiness for the Hybrid renderer. No secrets. */
export async function mediaStatus() {
  const bin = resolveFfmpegPath();
  const exists = fs.existsSync(bin);
  const version = exists ? await ffmpegVersion(bin) : null;
  const fontDir = path.join(process.cwd(), "assets", "fonts");
  const fonts = FONT_FILES.map((f) => ({ file: f, present: fs.existsSync(path.join(fontDir, f)) }));
  return {
    ffmpeg: { found: !!version, path: exists ? (env().FFMPEG_PATH ? "FFMPEG_PATH" : "ffmpeg-static") : null, version },
    fonts,
    fontsReady: fonts.every((f) => f.present),
    render: { width: env().RENDER_WIDTH, height: env().RENDER_HEIGHT, fps: env().RENDER_FPS },
  };
}

export async function systemStatus() {
  const e = env();
  const inline = e.WORKER_INLINE ? isTrue(e.WORKER_INLINE) : e.DATABASE_URL.startsWith("pglite://");
  return {
    nodeEnv: e.NODE_ENV,
    db: { driver: await getDbDriver() },
    queue: { driver: e.QUEUE_DRIVER, redisConfigured: !!e.REDIS_URL, inlineWorker: inline, concurrency: e.WORKER_CONCURRENCY },
    storage: { driver: e.STORAGE_DRIVER, s3Configured: !!e.S3_BUCKET },
    secrets: { authSecretSet: !!e.AUTH_SECRET && e.AUTH_SECRET.length >= 32, encryptionKeySet: !!e.APP_ENCRYPTION_KEY },
    media: await mediaStatus(),
  };
}
