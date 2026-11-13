/**
 * Video render pipeline (runs in the worker, never in a web request).
 *  Hybrid (default): background plate (self-generated or AI image) with Ken Burns motion
 *    + deterministic overlay (faithful product layer, Thai captions, price, disclosure)
 *    + xfade transitions + synthesized music (+ optional TTS) → H.264/AAC MP4 (9:16).
 *  Generative: Sora B-roll per scene replaces the background plate; overlay stays deterministic.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { creativeTemplates, products, videoProjects, videoScenes, mediaAssets } from "@/db/schema";
import type { Db } from "@/db/client";
import { env } from "@/lib/env";
import { getAiContext } from "@/lib/ai/context";
import { recordUsage } from "@/lib/ai/usage";
import { getStorage } from "@/lib/storage";
import { JobCanceledError, type JobContext } from "@/lib/jobs/types";
import { backgroundSvg, dataUri, overlaySvg, sniffImageMime, svgToPng, type Palette } from "@/lib/media/frames";
import { probeMedia, runFfmpeg } from "@/lib/media/ffmpeg";
import { musicFilter } from "@/lib/media/music";
import { buildSrt, cuesFromScenes } from "@/lib/media/srt";
import { saveAsset } from "./assets";
import { generateOpenAIBackground, generateOpenAISpeech, generateSoraClip, soraSeconds, type UsageCost } from "./openai-providers";
import { getProject, getScenes } from "./projects";

const DEFAULT_PALETTE: Palette = { from: "#38347a", to: "#14546f", accent: "#8d7dfb" };
const TRANSITIONS = ["fade", "slideleft", "smoothup", "circleopen", "fadeblack", "wipeleft"];
const XFADE = 0.4;

export type SceneMedia = {
  durationSec: number;
  bgPng?: string; // file path (image plate)
  clipMp4?: string; // file path (generative B-roll)
  overlayPng: string;
  voiceMp3?: string;
};

/** Build the ffmpeg argument list for the composed video. Exported for tests. */
export function buildFfmpegArgs(o: { scenes: SceneMedia[]; width: number; height: number; fps: number; music: "none" | "calm" | "upbeat"; out: string }): string[] {
  const { width: W, height: H, fps } = o;
  const args: string[] = [];
  const filters: string[] = [];
  const n = o.scenes.length;
  const total = o.scenes.reduce((a, s) => a + s.durationSec, 0);
  let input = 0;
  o.scenes.forEach((s, i) => {
    const segDur = s.durationSec + (i < n - 1 ? XFADE : 0);
    const frames = Math.max(1, Math.round(segDur * fps));
    const bgIdx = input++;
    if (s.clipMp4) {
      args.push("-stream_loop", "-1", "-i", s.clipMp4);
      filters.push(
        `[${bgIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},setsar=1,trim=duration=${segDur.toFixed(3)},setpts=PTS-STARTPTS[b${i}]`,
      );
    } else {
      args.push("-i", s.bgPng!);
      const zmax = 1.12;
      const inc = ((zmax - 1) / frames).toFixed(6);
      const z = i % 2 === 0 ? `1+${inc}*on` : `${zmax}-${inc}*on`;
      filters.push(`[${bgIdx}:v]zoompan=z='${z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${W}x${H}:fps=${fps},setsar=1[b${i}]`);
    }
    const ovIdx = input++;
    args.push("-loop", "1", "-framerate", String(fps), "-t", segDur.toFixed(3), "-i", s.overlayPng);
    filters.push(`[b${i}][${ovIdx}:v]overlay=0:0:shortest=1,format=yuv420p,trim=duration=${segDur.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
  });
  // transitions
  if (n === 1) filters.push(`[v0]null[vout]`);
  else {
    let prev = "v0";
    let offset = 0;
    for (let i = 1; i < n; i++) {
      offset += o.scenes[i - 1].durationSec;
      const label = i === n - 1 ? "vout" : `x${i}`;
      filters.push(`[${prev}][v${i}]xfade=transition=${TRANSITIONS[(i - 1) % TRANSITIONS.length]}:duration=${XFADE}:offset=${offset.toFixed(3)}[${label}]`);
      prev = label;
    }
  }
  // audio: music bed (or silence) + optional per-scene voiceover
  const voices: { idx: number; startMs: number }[] = [];
  let t = 0;
  o.scenes.forEach((s) => {
    if (s.voiceMp3) {
      voices.push({ idx: input++, startMs: Math.round(t * 1000) });
      args.push("-i", s.voiceMp3);
    }
    t += s.durationSec;
  });
  if (o.music === "none") filters.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${total.toFixed(3)}[bed]`);
  else filters.push(musicFilter(o.music, total, "bed0"), `[bed0]volume=${voices.length ? "0.45" : "1.0"}[bed]`);
  if (voices.length) {
    voices.forEach((v, k) => filters.push(`[${v.idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${v.startMs}|${v.startMs}[vo${k}]`));
    filters.push(`[bed]${voices.map((_, k) => `[vo${k}]`).join("")}amix=inputs=${voices.length + 1}:duration=first:normalize=0[aout]`);
  } else filters.push(`[bed]anull[aout]`);

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-t",
    total.toFixed(3),
    "-y",
    o.out,
  );
  return args;
}

async function loadAuthorizedProductImage(db: Db, product: typeof products.$inferSelect): Promise<string | null> {
  if (product.imageRights !== "authorized") return null;
  try {
    let buf: Buffer | null = null;
    if (product.imageAssetId) {
      const [a] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, product.imageAssetId));
      if (a) buf = await getStorage().get(a.storageKey);
    } else if (product.imageUrl && /^https?:\/\//i.test(product.imageUrl)) {
      const res = await fetch(product.imageUrl, { signal: AbortSignal.timeout(15_000) });
      if (res.ok && Number(res.headers.get("content-length") ?? 0) < 8_000_000) buf = Buffer.from(await res.arrayBuffer());
    }
    if (!buf || buf.length > 8_000_000) return null;
    const mime = sniffImageMime(buf);
    return mime ? dataUri(buf, mime) : null;
  } catch {
    return null;
  }
}

function thaiDate(d: Date, lang: "th" | "en") {
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" }).format(d);
}

export async function renderProject(ctx: JobContext, projectId: string) {
  const { db, job } = ctx;
  const p = await getProject(db, job.workspaceId, projectId);
  const scenes = await getScenes(db, projectId);
  if (!p.script || !scenes.length || !p.facts) throw Object.assign(new Error("ไม่มีสคริปต์/Storyboard สำหรับเรนเดอร์"), { permanent: true });
  const facts = p.facts;
  const [product] = await db.select().from(products).where(eq(products.id, p.productId));
  const [tpl] = p.templateId ? await db.select().from(creativeTemplates).where(eq(creativeTemplates.id, p.templateId)) : [];
  const palette = tpl?.config.palette ?? DEFAULT_PALETTE;
  const ai = await getAiContext(db, job.workspaceId);
  const e = env();
  const W = e.RENDER_WIDTH;
  const H = e.RENDER_HEIGHT;
  const FPS = e.RENDER_FPS;
  const live = ai.mode === "live";
  const generative = p.renderMode === "generative";
  if (generative && (!live || !ai.videoProviders.generativeEnabled)) {
    throw Object.assign(new Error("โหมด Generative ต้องเปิด Live AI และเปิดใช้ Video Provider ในตั้งค่า"), { permanent: true });
  }

  const checkCancel = async () => {
    if (await ctx.isCanceled()) throw new JobCanceledError("canceled");
  };
  const usage = async (u: UsageCost) => recordUsage(db, { workspaceId: job.workspaceId, provider: "openai", model: u.model, operation: u.operation, units: u.units, unit: u.unit, costUsd: u.costUsd, isEstimate: true, projectId, jobId: job.id });

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "aas-render-"));
  const startedAt = Date.now();
  try {
    await db.update(videoProjects).set({ status: "asset_generation", updatedAt: new Date() }).where(eq(videoProjects.id, projectId));
    await ctx.progress(5, "เตรียมภาพสินค้า");
    const productImage = await loadAuthorizedProductImage(db, product);
    await ctx.log("info", productImage ? "ใช้ภาพสินค้าที่ได้รับอนุญาต" : "ไม่มีภาพที่ยืนยันสิทธิ์ — ใช้ภาพประกอบ placeholder (ไม่ใช่ภาพสินค้าจริง)");

    const priceText = facts.price !== null ? `฿${new Intl.NumberFormat("th-TH").format(facts.price)}` : null;
    const priceNote =
      priceText !== null
        ? p.language === "th"
          ? `ราคา ณ ${thaiDate(new Date(facts.capturedAt), "th")} · ตรวจสอบราคาปัจจุบันที่ลิงก์`
          : `Price as of ${thaiDate(new Date(facts.capturedAt), "en")} · check the link for current price`
        : null;
    const disclosureLabel = p.disclosure ? (p.language === "th" ? "#โฆษณา · ลิงก์ Affiliate" : "#ad · Affiliate link") : null;

    const media: SceneMedia[] = [];
    for (let i = 0; i < scenes.length; i++) {
      await checkCancel();
      const s = scenes[i];
      await ctx.progress(8 + Math.round((i / scenes.length) * 52), `สร้างภาพ/เสียงฉากที่ ${i + 1}/${scenes.length}`);
      const m: SceneMedia = { durationSec: Number(s.durationSec), overlayPng: path.join(tmp, `ov${i}.png`) };

      if (generative) {
        const clip = await generateSoraClip(ai, s.visualPrompt || "soft abstract product commercial background", soraSeconds(Number(s.durationSec), ai.videoProviders.maxClipSeconds), { isCanceled: ctx.isCanceled });
        await usage(clip.usage);
        m.clipMp4 = path.join(tmp, `clip${i}.mp4`);
        await fsp.writeFile(m.clipMp4, clip.mp4);
        const a = await saveAsset(db, { workspaceId: job.workspaceId, kind: "video", mime: "video/mp4", source: "ai_generated", data: clip.mp4, projectId, provider: "openai", model: clip.usage.model, prompt: s.visualPrompt, rightsNote: "AI-generated B-roll (Sora) — background only; QA required: may distort shapes/text" });
        await db.update(videoScenes).set({ videoAssetId: a.id }).where(eq(videoScenes.id, s.id));
      } else {
        let imageUri: string | null = null;
        let source: "ai_generated" | "synthesized" = "synthesized";
        if (live) {
          const img = await generateOpenAIBackground(ai, s.visualPrompt || "soft studio background");
          await usage(img.usage);
          imageUri = dataUri(img.png, "image/png");
          source = "ai_generated";
        }
        const bgW = Math.round((W * 1.2) / 2) * 2;
        const bgH = Math.round((H * 1.2) / 2) * 2;
        const png = svgToPng(backgroundSvg({ width: bgW, height: bgH, palette, seed: `${projectId}:${i}`, imageDataUri: imageUri }), bgW);
        m.bgPng = path.join(tmp, `bg${i}.png`);
        await fsp.writeFile(m.bgPng, png);
        const a = await saveAsset(db, {
          workspaceId: job.workspaceId,
          kind: "image",
          mime: "image/png",
          source,
          data: png,
          projectId,
          width: bgW,
          height: bgH,
          provider: live ? "openai" : "builtin",
          model: live ? ai.models.image : null,
          prompt: s.visualPrompt,
          rightsNote: live ? "AI-generated lifestyle background scene (not a product photograph)" : "Self-generated gradient background by AI Affiliate Studio — no third-party rights",
        });
        await db.update(videoScenes).set({ imageAssetId: a.id }).where(eq(videoScenes.id, s.id));
      }

      if (live && p.voice !== "none" && s.voiceover.trim()) {
        const v = await generateOpenAISpeech(ai, s.voiceover, p.voice, p.language);
        await usage(v.usage);
        m.voiceMp3 = path.join(tmp, `vo${i}.mp3`);
        await fsp.writeFile(m.voiceMp3, v.mp3);
        await saveAsset(db, { workspaceId: job.workspaceId, kind: "audio", mime: "audio/mpeg", source: "ai_generated", data: v.mp3, projectId, provider: "openai", model: v.usage.model, rightsNote: "AI voiceover (TTS) — disclose AI voice where required" });
      }

      const ov = overlaySvg({
        width: W,
        height: H,
        palette,
        language: p.language,
        shotType: s.shotType,
        caption: s.caption,
        subtitle: p.subtitles ? s.voiceover || null : null,
        disclosure: disclosureLabel,
        productTitle: facts.title,
        brand: facts.brand,
        productImageDataUri: productImage,
        priceText,
        priceNote,
        sceneIndex: i,
        sceneCount: scenes.length,
      });
      await fsp.writeFile(m.overlayPng, svgToPng(ov, W));
      media.push(m);
    }

    await checkCancel();
    await db.update(videoProjects).set({ status: "rendering", updatedAt: new Date() }).where(eq(videoProjects.id, projectId));
    await ctx.progress(65, "เรนเดอร์วิดีโอด้วย FFmpeg");
    const out = path.join(tmp, "out.mp4");
    await runFfmpeg(buildFfmpegArgs({ scenes: media, width: W, height: H, fps: FPS, music: p.music, out }));
    await checkCancel();
    await ctx.progress(88, "สร้าง Thumbnail และซับไตเติล");
    const info = await probeMedia(out);
    const thumb = path.join(tmp, "thumb.jpg");
    await runFfmpeg(["-ss", String(Math.min(1.5, (info.durationSec ?? 2) / 2)), "-i", out, "-frames:v", "1", "-q:v", "3", "-y", thumb]);
    const srt = buildSrt(cuesFromScenes(scenes.map((s) => ({ durationSec: Number(s.durationSec), text: s.voiceover || s.caption }))));

    const safeName = (facts.title.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) || "video").replace(/^-|-$/g, "");
    const video = await saveAsset(db, {
      workspaceId: job.workspaceId,
      kind: "video",
      mime: "video/mp4",
      source: "render",
      filePath: out,
      fileName: `${safeName}-${p.aspectRatio.replace(":", "x")}.mp4`,
      projectId,
      productId: p.productId,
      width: info.width,
      height: info.height,
      durationSec: info.durationSec,
      provider: generative ? "openai+ffmpeg" : "ffmpeg",
      rightsNote: productImage ? "Final render with authorized product image" : "Final render with placeholder illustration (no product photograph)",
    });
    const thumbAsset = await saveAsset(db, { workspaceId: job.workspaceId, kind: "thumbnail", mime: "image/jpeg", source: "render", filePath: thumb, fileName: `${safeName}.jpg`, projectId, width: info.width, height: info.height });
    const subAsset = await saveAsset(db, { workspaceId: job.workspaceId, kind: "subtitle", mime: "application/x-subrip", source: "render", data: Buffer.from(srt, "utf8"), fileName: `${safeName}.srt`, projectId });
    await db
      .update(videoProjects)
      .set({ status: "quality_review", outputAssetId: video.id, thumbnailAssetId: thumbAsset.id, subtitleAssetId: subAsset.id, error: null, updatedAt: new Date() })
      .where(eq(videoProjects.id, projectId));
    const ms = Date.now() - startedAt;
    await ctx.log("info", `เรนเดอร์เสร็จใน ${(ms / 1000).toFixed(1)}s`, { width: info.width, height: info.height, duration: info.durationSec, bytes: video.bytes });
    return { outputAssetId: video.id, durationSec: info.durationSec, width: info.width, height: info.height, bytes: video.bytes, renderMs: ms, voiceover: media.some((m) => m.voiceMp3), placeholderImage: !productImage };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    if (fs.existsSync(tmp)) await new Promise((r) => setTimeout(r, 200)).then(() => fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined));
  }
}
