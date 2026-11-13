/**
 * Video project service. CONTRACT (consumed by Products bulk actions and Automation):
 * createVideoProject / enqueueScriptGeneration / estimateProjectCostUsd / enqueueRender — keep stable.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { creativeTemplates, marketplaceOffers, products, videoProjects, videoScenes, type ProductFacts } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { getAiContext } from "@/lib/ai/context";
import { checkBudget } from "@/lib/ai/usage";
import { enqueueJob } from "@/lib/jobs/queue";
import { soraSeconds } from "./openai-providers";

export type VideoProject = typeof videoProjects.$inferSelect;
export type VideoScene = typeof videoScenes.$inferSelect;
export type Template = typeof creativeTemplates.$inferSelect;

export type CreateVideoProjectInput = {
  offerId: string;
  templateKey?: string;
  language?: "th" | "en";
  renderMode?: "hybrid" | "generative";
  durationSec?: number;
  voice?: "none" | "female" | "male";
  music?: "none" | "calm" | "upbeat";
  subtitles?: boolean;
  disclosure?: boolean;
  visualStyle?: string;
  createdBy?: string | null;
  automationRuleId?: string | null;
  batchId?: string | null;
};

/** Latest active version of a template by key (falls back to any template). */
export async function getTemplate(db: Db, workspaceId: string, key?: string | null): Promise<Template> {
  const rows = await db
    .select()
    .from(creativeTemplates)
    .where(and(eq(creativeTemplates.workspaceId, workspaceId), eq(creativeTemplates.isActive, true)))
    .orderBy(desc(creativeTemplates.version));
  const t = (key && rows.find((r) => r.key === key)) || rows.find((r) => r.key === "product-showcase") || rows[0];
  if (!t) throw new ApiError(409, "ยังไม่มี Template วิดีโอในระบบ", "no_template");
  return t;
}

export async function getTemplateById(db: Db, id: string): Promise<Template | null> {
  const [t] = await db.select().from(creativeTemplates).where(eq(creativeTemplates.id, id));
  return t ?? null;
}

/** Immutable snapshot of the facts a script may use (from the selected offer + its product). */
export async function buildFacts(db: Db, workspaceId: string, offerId: string): Promise<{ facts: ProductFacts; productId: string }> {
  const [row] = await db
    .select({ o: marketplaceOffers, p: products })
    .from(marketplaceOffers)
    .innerJoin(products, eq(products.id, marketplaceOffers.productId))
    .where(and(eq(marketplaceOffers.id, offerId), eq(marketplaceOffers.workspaceId, workspaceId)))
    .limit(1);
  if (!row || row.p.deletedAt) throw new ApiError(404, "ไม่พบสินค้า/ข้อเสนอที่เลือก", "not_found");
  const { o, p } = row;
  const attributes = Object.fromEntries(Object.entries(p.attributes ?? {}).filter(([k]) => !k.startsWith("demo_") && k !== "trend_score"));
  return {
    productId: p.id,
    facts: {
      title: p.title,
      brand: p.brand,
      price: o.price,
      currency: o.currency,
      platform: o.platform,
      rating: o.rating,
      ratingCount: o.ratingCount,
      soldCount: o.soldCount,
      attributes,
      description: p.description,
      productUrl: o.productUrl,
      affiliateUrl: o.affiliateUrl,
      dataOrigin: o.dataOrigin,
      capturedAt: new Date().toISOString(),
    },
  };
}

export async function createVideoProject(db: Db, workspaceId: string, input: CreateVideoProjectInput): Promise<VideoProject> {
  const { facts, productId } = await buildFacts(db, workspaceId, input.offerId);
  const t = await getTemplate(db, workspaceId, input.templateKey);
  const short = facts.title.length > 48 ? facts.title.slice(0, 48) + "…" : facts.title;
  const [p] = await db
    .insert(videoProjects)
    .values({
      workspaceId,
      productId,
      offerId: input.offerId,
      templateId: t.id,
      title: `${short} · ${t.name}`,
      language: input.language ?? "th",
      renderMode: input.renderMode ?? "hybrid",
      durationSec: Math.max(8, Math.min(60, Math.round(input.durationSec ?? t.config.durationSec))),
      voice: input.voice ?? "none",
      subtitles: input.subtitles ?? true,
      disclosure: input.disclosure ?? true,
      music: input.music ?? t.config.music,
      visualStyle: input.visualStyle ?? "premium",
      facts,
      status: "created",
      createdBy: input.createdBy ?? null,
      automationRuleId: input.automationRuleId ?? null,
      batchId: input.batchId ?? null,
    })
    .returning();
  return p;
}

export async function getProject(db: Db, workspaceId: string, projectId: string): Promise<VideoProject> {
  const [p] = await db
    .select()
    .from(videoProjects)
    .where(and(eq(videoProjects.id, projectId), eq(videoProjects.workspaceId, workspaceId)));
  if (!p) throw new ApiError(404, "ไม่พบโปรเจกต์วิดีโอ", "not_found");
  return p;
}

export async function getScenes(db: Db, projectId: string): Promise<VideoScene[]> {
  return db.select().from(videoScenes).where(eq(videoScenes.projectId, projectId)).orderBy(asc(videoScenes.idx));
}

export const PROCESSING_STATUSES = ["script_generating", "queued_render", "asset_generation", "rendering"] as const;

export async function enqueueScriptGeneration(db: Db, workspaceId: string, projectId: string, userId?: string | null): Promise<{ jobId: string }> {
  const p = await getProject(db, workspaceId, projectId);
  if ((PROCESSING_STATUSES as readonly string[]).includes(p.status)) {
    throw new ApiError(409, "โปรเจกต์นี้กำลังประมวลผลอยู่", "busy");
  }
  if (p.status === "published") throw new ApiError(409, "โปรเจกต์เผยแพร่แล้ว ไม่สามารถสร้างสคริปต์ใหม่ได้", "locked");
  const ai = await getAiContext(db, workspaceId);
  if (ai.mode === "live") {
    const est = (2500 / 1e6) * ai.pricing.textInputPer1M + (1500 / 1e6) * ai.pricing.textOutputPer1M;
    const b = await checkBudget(db, workspaceId, est);
    if (!b.ok) throw new ApiError(402, b.reason ?? "เกินงบประมาณ", "budget_exceeded", b);
  }
  const { job } = await enqueueJob(db, {
    workspaceId,
    type: "video.generate_script",
    payload: { projectId },
    idempotencyKey: `script:${projectId}:${p.updatedAt.getTime()}`,
    priority: 5,
    projectId,
    createdBy: userId ?? null,
  });
  await db.update(videoProjects).set({ status: "script_generating", error: null, updatedAt: new Date() }).where(eq(videoProjects.id, projectId));
  return { jobId: job.id };
}

export async function estimateProjectCostUsd(db: Db, workspaceId: string, projectId: string): Promise<{ totalUsd: number; lines: { label: string; usd: number }[] }> {
  const p = await getProject(db, workspaceId, projectId);
  const scenes = await getScenes(db, projectId);
  const ai = await getAiContext(db, workspaceId);
  const sceneCount = scenes.length || 4;
  if (ai.mode !== "live") {
    return {
      totalUsd: 0,
      lines: [
        { label: "Demo generator: สคริปต์ / ภาพพื้นหลัง (ไม่เรียก API)", usd: 0 },
        { label: "Hybrid render ด้วย FFmpeg บน Worker", usd: 0 },
      ],
    };
  }
  const r = (n: number) => Math.round(n * 10000) / 10000;
  const lines: { label: string; usd: number }[] = [];
  if (!p.script) lines.push({ label: `สคริปต์ (${ai.models.text}) ~4k tokens`, usd: r((2500 / 1e6) * ai.pricing.textInputPer1M + (1500 / 1e6) * ai.pricing.textOutputPer1M) });
  if (p.renderMode === "generative") {
    const secs = (scenes.length ? scenes.map((s) => s.durationSec) : Array(sceneCount).fill(p.durationSec / sceneCount)).reduce(
      (a: number, d: number) => a + Number(soraSeconds(d, ai.videoProviders.maxClipSeconds)),
      0,
    );
    lines.push({ label: `AI Video B-roll (${ai.models.video}) ${secs}s`, usd: r(secs * ai.pricing.videoPerSecond) });
  } else {
    lines.push({ label: `ภาพพื้นหลัง AI (${ai.models.image}) × ${sceneCount}`, usd: r(sceneCount * ai.pricing.imagePerImage) });
  }
  if (p.voice !== "none") {
    const chars = scenes.length ? scenes.reduce((a, s) => a + s.voiceover.length, 0) : p.durationSec * 14;
    lines.push({ label: `เสียงพากย์ (${ai.models.tts}) ~${chars} ตัวอักษร`, usd: r((chars / 1e6) * ai.pricing.ttsPer1MChars) });
  }
  lines.push({ label: "Render FFmpeg บน Worker", usd: 0 });
  return { totalUsd: r(lines.reduce((a, l) => a + l.usd, 0)), lines };
}

const RENDERABLE = ["awaiting_approval", "quality_review", "approved", "exported", "failed", "canceled"];

export async function enqueueRender(db: Db, workspaceId: string, projectId: string, userId?: string | null): Promise<{ jobId: string }> {
  const p = await getProject(db, workspaceId, projectId);
  if (!RENDERABLE.includes(p.status)) {
    throw new ApiError(409, p.status === "published" ? "โปรเจกต์เผยแพร่แล้ว" : "สถานะปัจจุบันยังเรนเดอร์ไม่ได้ (ต้องมีสคริปต์ที่พร้อม และไม่อยู่ระหว่างประมวลผล)", "invalid_status");
  }
  const scenes = await getScenes(db, projectId);
  if (!p.script || scenes.length === 0) throw new ApiError(409, "ต้องสร้างสคริปต์และ Storyboard ก่อนเรนเดอร์", "no_script");
  const ai = await getAiContext(db, workspaceId);
  if (p.renderMode === "generative") {
    if (ai.mode !== "live") throw new ApiError(409, "โหมด Generative AI Video ต้องเปิด Live AI และกำหนด OpenAI API Key ก่อน (ตั้งค่า > AI Providers)", "generative_unavailable");
    if (!ai.videoProviders.generativeEnabled) throw new ApiError(409, "ยังไม่ได้เปิดใช้ Video Provider แบบ Generative (ตั้งค่า > Video Providers)", "generative_disabled");
  }
  const est = await estimateProjectCostUsd(db, workspaceId, projectId);
  const budget = await checkBudget(db, workspaceId, est.totalUsd, { perVideo: true });
  if (!budget.ok) throw new ApiError(402, budget.reason ?? "เกินงบประมาณ", "budget_exceeded", budget);
  const { job } = await enqueueJob(db, {
    workspaceId,
    type: "video.render",
    payload: { projectId, estimateUsd: est.totalUsd },
    idempotencyKey: `render:${projectId}:${p.updatedAt.getTime()}:${p.outputAssetId ?? "none"}`,
    priority: 3,
    maxAttempts: 2,
    projectId,
    createdBy: userId ?? null,
  });
  await db
    .update(videoProjects)
    .set({ status: "queued_render", error: null, estimatedCostUsd: est.totalUsd, updatedAt: new Date() })
    .where(eq(videoProjects.id, projectId));
  return { jobId: job.id };
}

export async function deleteProjects(db: Db, workspaceId: string, ids: string[]) {
  await db.delete(videoProjects).where(and(eq(videoProjects.workspaceId, workspaceId), inArray(videoProjects.id, ids)));
}
