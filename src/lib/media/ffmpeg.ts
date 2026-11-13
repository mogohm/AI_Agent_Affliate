import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { env } from "@/lib/env";

/** Resolve the FFmpeg binary: FFMPEG_PATH env → ffmpeg-static → "ffmpeg" on PATH. */
export function ffmpegPath(): string {
  const fromEnv = env().FFMPEG_PATH;
  if (fromEnv) return fromEnv;
  try {
    const req = createRequire(process.cwd() + "/package.json");
    const p = req("ffmpeg-static") as string | null;
    if (p && fs.existsSync(p)) return p;
  } catch {
    // fall through
  }
  return "ffmpeg";
}

export function ffmpegAvailable(): boolean {
  const p = ffmpegPath();
  return p === "ffmpeg" ? false : fs.existsSync(p);
}

export type RunResult = { code: number; stderr: string };

/** Run ffmpeg with args (no shell). Rejects with the stderr tail on failure or timeout. */
export function runFfmpeg(args: string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ["-hide_banner", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 10 * 60_000);
    opts.signal?.addEventListener("abort", () => child.kill("SIGKILL"));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`ไม่สามารถเรียก FFmpeg ได้: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ code: 0, stderr });
      else reject(new Error(`FFmpeg ล้มเหลว (code ${code}): ${stderr.split("\n").slice(-8).join(" ").slice(-600)}`));
    });
  });
}

export type ProbeInfo = { durationSec: number | null; width: number | null; height: number | null; hasAudio: boolean; videoCodec: string | null };

/** Lightweight probe by parsing `ffmpeg -i` output (ffprobe is not bundled with ffmpeg-static). */
export async function probeMedia(file: string): Promise<ProbeInfo> {
  const out = await new Promise<string>((resolve) => {
    const child = spawn(ffmpegPath(), ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let s = "";
    child.stderr.on("data", (d: Buffer) => (s += d.toString()));
    child.on("close", () => resolve(s));
    child.on("error", () => resolve(s));
  });
  const d = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const v = out.match(/Video:\s*([a-z0-9]+)[^\n]*?,\s*(\d{2,5})x(\d{2,5})/);
  return {
    durationSec: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
    width: v ? Number(v[2]) : null,
    height: v ? Number(v[3]) : null,
    hasAudio: /Audio:/.test(out),
    videoCodec: v ? v[1] : null,
  };
}
