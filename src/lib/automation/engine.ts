/**
 * Automation Factory — rule engine.
 *
 * A rule selects marketplace offers (conditions) and turns them into video projects (actions).
 * Guarantees:
 *  - daily quota per rule (Asia/Bangkok day) is enforced
 *  - AI budget (daily/monthly) and per-video cost ceiling are checked BEFORE anything is dispatched
 *  - publishing always requires human approval (rules can never publish)
 *  - every run (dry or real) is recorded in automation_runs; real runs are audited
 */
import crypto from "node:crypto";
import { and, count, eq, gte, inArray, notInArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { automationRules, automationRuns, videoProjects, type RuleActions, type RuleConditions } from "@/db/schema";
import { listOffers, type OfferFilters, type OfferRow } from "@/lib/catalog/service";
import { getAiContext, type AiContext } from "@/lib/ai/context";
import { checkBudget } from "@/lib/ai/usage";
import { audit } from "@/lib/audit";
import { enqueueJob } from "@/lib/jobs/queue";
import { PermanentJobError, type JobHandler } from "@/lib/jobs/types";
import { logger } from "@/lib/logger";
import { bangkokDateString, bangkokTimeString, startOfBangkokDay } from "@/lib/time";
import { createVideoProject, enqueueScriptGeneration } from "@/lib/video/projects";

export type AutomationRule = typeof automationRules.$inferSelect;

export type MatchedOffer = {
  offerId: string;
  productId: string;
  title: string;
  platform: string;
  categoryName: string | null;
  price: number;
  commissionRate: number | null;
  estCommission: number | null;
  score: number | null;
  confidence: number | null;
  dataOrigin: string;
  reasons: string[];
};

export type RejectedOffer = { offerId: string; title: string; reason: string };

// ---------------------------------------------------------------- pure helpers (unit tested)

/** Translate rule conditions to SQL-side listOffers filters (single-valued filters only). */
export function conditionsToFilters(c: RuleConditions): OfferFilters {
  const f: OfferFilters = { sort: "commission_amount", pageSize: 200 };
  if (c.minCommissionAmount != null) f.minCommission = c.minCommissionAmount;
  if (c.minCommissionRate != null) f.minRate = c.minCommissionRate;
  if (c.minScore != null) f.minScore = c.minScore;
  if (c.marketplaces?.length === 1) f.marketplace = c.marketplaces[0];
  if (c.categoryIds?.length === 1) f.categoryId = c.categoryIds[0];
  return f;
}

/** Post-filters that SQL filters cannot express; returns matches (in input order) and rejections. */
export function applyPostFilters(
  offers: OfferRow[],
  c: RuleConditions,
  producedProductIds: Set<string>,
): { matches: MatchedOffer[]; rejected: RejectedOffer[] } {
  const matches: MatchedOffer[] = [];
  const rejected: RejectedOffer[] = [];
  const seenProducts = new Set<string>();
  for (const o of offers) {
    const reject = (reason: string) => rejected.push({ offerId: o.offer_id, title: o.title, reason });
    if (c.marketplaces?.length && !c.marketplaces.includes(o.platform)) {
      reject("Marketplace ไม่ตรงเงื่อนไข");
      continue;
    }
    if (c.categoryIds?.length && (!o.category_id || !c.categoryIds.includes(o.category_id))) {
      reject("หมวดหมู่ไม่ตรงเงื่อนไข");
      continue;
    }
    if (c.minCommissionAmount != null && (o.est_commission == null || o.est_commission < c.minCommissionAmount)) {
      reject(o.est_commission == null ? "ไม่มีข้อมูลค่าคอม" : "ค่าคอมต่อออเดอร์ต่ำกว่าเกณฑ์");
      continue;
    }
    if (c.minCommissionRate != null && (o.rate_total == null || o.rate_total < c.minCommissionRate)) {
      reject("อัตราค่าคอมต่ำกว่าเกณฑ์");
      continue;
    }
    if (c.minScore != null && (o.score == null || o.score < c.minScore)) {
      reject(o.score == null ? "ยังไม่มี Opportunity Score" : "Opportunity Score ต่ำกว่าเกณฑ์");
      continue;
    }
    if (c.minConfidence != null && (o.score_confidence == null || o.score_confidence < c.minConfidence)) {
      reject("ความเชื่อมั่นของข้อมูลต่ำกว่าเกณฑ์ (ควรตรวจสอบโดยคน)");
      continue;
    }
    if (c.requireAuthorizedImage && o.image_rights !== "authorized") {
      reject("ภาพสินค้ายังไม่ยืนยันสิทธิ์การใช้งาน");
      continue;
    }
    if (c.excludeAlreadyProduced && producedProductIds.has(o.product_id)) {
      reject("มีวิดีโอของสินค้านี้แล้ว");
      continue;
    }
    if (seenProducts.has(o.product_id)) {
      reject("สินค้าเดียวกันจากอีก Offer (เลือก Offer ที่ค่าคอมสูงกว่าแล้ว)");
      continue;
    }
    seenProducts.add(o.product_id);
    const reasons: string[] = [];
    if (o.est_commission != null) reasons.push(`ค่าคอม ~฿${o.est_commission.toFixed(2)}/ออเดอร์`);
    if (o.rate_total != null) reasons.push(`อัตรา ${o.rate_total}%`);
    if (o.score != null) reasons.push(`Score ${Math.round(o.score)}`);
    if (o.data_origin === "demo") reasons.push("DEMO data");
    matches.push({
      offerId: o.offer_id,
      productId: o.product_id,
      title: o.title,
      platform: o.platform,
      categoryName: o.category_name,
      price: o.price,
      commissionRate: o.rate_total,
      estCommission: o.est_commission,
      score: o.score,
      confidence: o.score_confidence,
      dataOrigin: o.data_origin,
      reasons,
    });
  }
  return { matches, rejected };
}

export function remainingQuota(videosPerDay: number, createdToday: number): number {
  return Math.max(0, Math.floor(videosPerDay) - createdToday);
}

/** Rough per-video cost estimate (USD) used BEFORE projects exist. Demo mode costs nothing. */
export function estimatePerVideoUsd(ai: Pick<AiContext, "mode" | "pricing">, actions: Pick<RuleActions, "autoGenerateScript" | "autoRender" | "renderMode">, sceneCount = 4, durationSec = 20): number {
  if (ai.mode !== "live") return 0;
  const p = ai.pricing;
  let usd = 0;
  if (actions.autoGenerateScript) usd += (3000 / 1e6) * p.textInputPer1M + (1500 / 1e6) * p.textOutputPer1M;
  if (actions.autoRender) {
    usd += sceneCount * p.imagePerImage;
    usd += (400 / 1e6) * p.ttsPer1MChars;
    if (actions.renderMode === "generative") usd += durationSec * p.videoPerSecond;
  }
  return Math.round(usd * 10000) / 10000;
}

/** Is a daily-scheduled rule due now? (once per Bangkok day, at/after scheduleTime) */
export function isScheduleDue(rule: Pick<AutomationRule, "enabled" | "schedule" | "scheduleTime" | "lastRunAt">, now = new Date()): boolean {
  if (!rule.enabled || rule.schedule !== "daily") return false;
  if (bangkokTimeString(now) < (rule.scheduleTime || "09:00")) return false;
  return !rule.lastRunAt || rule.lastRunAt < startOfBangkokDay(now);
}

// ---------------------------------------------------------------- DB-backed operations

async function producedProductIds(db: Db, workspaceId: string): Promise<Set<string>> {
  const rows = await db
    .select({ productId: videoProjects.productId })
    .from(videoProjects)
    .where(and(eq(videoProjects.workspaceId, workspaceId), notInArray(videoProjects.status, ["failed", "canceled"])));
  return new Set(rows.map((r) => r.productId));
}

export async function createdTodayByRule(db: Db, ruleId: string, now = new Date()): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(videoProjects)
    .where(and(eq(videoProjects.automationRuleId, ruleId), gte(videoProjects.createdAt, startOfBangkokDay(now))));
  return r?.n ?? 0;
}

export async function evaluateRule(db: Db, workspaceId: string, conditions: RuleConditions) {
  const { items } = await listOffers(db, workspaceId, conditionsToFilters(conditions));
  const produced = conditions.excludeAlreadyProduced ? await producedProductIds(db, workspaceId) : new Set<string>();
  return applyPostFilters(items, conditions, produced);
}

export type RunResult = {
  runId: string;
  dryRun: boolean;
  status: "succeeded" | "partial" | "failed" | "skipped";
  message: string;
  matched: number;
  quotaRemaining: number;
  planned: MatchedOffer[];
  rejected: RejectedOffer[];
  createdProjectIds: string[];
  estimatePerVideoUsd: number;
  estimateTotalUsd: number;
  aiMode: "demo" | "live";
  budget?: { ok: boolean; reason: string | null; spentTodayUsd: number; spentMonthUsd: number };
  errors: { offerId: string; error: string }[];
};

export async function getRule(db: Db, workspaceId: string, ruleId: string): Promise<AutomationRule | null> {
  const [r] = await db.select().from(automationRules).where(and(eq(automationRules.id, ruleId), eq(automationRules.workspaceId, workspaceId)));
  return r ?? null;
}

/**
 * Dry-run or execute a rule. Dry-runs never create projects or spend money.
 */
export async function runRule(
  db: Db,
  workspaceId: string,
  ruleId: string,
  opts: { dryRun: boolean; trigger?: "manual" | "schedule"; userId?: string | null; now?: Date },
): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const rule = await getRule(db, workspaceId, ruleId);
  if (!rule) throw new Error("ไม่พบกฎอัตโนมัติ");
  const actions = rule.actions;
  const ai = await getAiContext(db, workspaceId);
  const { matches, rejected } = await evaluateRule(db, workspaceId, rule.conditions);
  const createdToday = await createdTodayByRule(db, rule.id, now);
  const quota = remainingQuota(actions.videosPerDay, createdToday);
  const planned = matches.slice(0, quota);
  const perVideo = estimatePerVideoUsd(ai, actions);
  const result: RunResult = {
    runId: "",
    dryRun: opts.dryRun,
    status: "succeeded",
    message: "",
    matched: matches.length,
    quotaRemaining: quota,
    planned,
    rejected: rejected.slice(0, 100),
    createdProjectIds: [],
    estimatePerVideoUsd: perVideo,
    estimateTotalUsd: Math.round(perVideo * planned.length * 10000) / 10000,
    aiMode: ai.mode,
    errors: [],
  };

  // Guards — evaluated for dry runs too so the operator sees what would happen.
  const ceiling = actions.maxCostPerVideoUsd;
  const budget = await checkBudget(db, workspaceId, result.estimateTotalUsd);
  result.budget = { ok: budget.ok, reason: budget.reason, spentTodayUsd: budget.spentTodayUsd, spentMonthUsd: budget.spentMonthUsd };

  if (!matches.length) {
    result.status = "skipped";
    result.message = "ไม่มีสินค้าที่ผ่านเงื่อนไข";
  } else if (quota === 0) {
    result.status = "skipped";
    result.message = `ครบโควตาวันนี้แล้ว (${actions.videosPerDay} วิดีโอ/วัน)`;
  } else if (ceiling != null && perVideo > ceiling) {
    result.status = "failed";
    result.message = `ค่าใช้จ่ายประมาณการต่อคลิป $${perVideo.toFixed(3)} เกินเพดาน $${ceiling}`;
  } else if (!budget.ok) {
    result.status = "failed";
    result.message = `งบ AI ไม่พอ: ${budget.reason}`;
  } else {
    result.message = opts.dryRun
      ? `Dry-run: จะสร้าง ${planned.length} วิดีโอ จาก ${matches.length} สินค้าที่ผ่านเกณฑ์`
      : `สร้าง ${planned.length} วิดีโอ`;
  }

  const blocked = result.status === "failed" || result.status === "skipped";
  if (!opts.dryRun && !blocked) {
    const batchId = crypto.randomUUID();
    for (const m of planned) {
      try {
        const project = await createVideoProject(db, workspaceId, {
          offerId: m.offerId,
          templateKey: actions.templateKey,
          language: actions.language,
          renderMode: actions.renderMode,
          createdBy: opts.userId ?? null,
          automationRuleId: rule.id,
          batchId,
        });
        result.createdProjectIds.push(project.id);
        if (actions.autoGenerateScript) await enqueueScriptGeneration(db, workspaceId, project.id, opts.userId ?? null);
      } catch (e) {
        result.errors.push({ offerId: m.offerId, error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (result.errors.length) {
      result.status = result.createdProjectIds.length ? "partial" : "failed";
      result.message = `สร้าง ${result.createdProjectIds.length}/${planned.length} วิดีโอ (ผิดพลาด ${result.errors.length})`;
    }
    if (actions.autoRender) {
      result.message += " · การเรนเดอร์จะเริ่มหลังสคริปต์ได้รับอนุมัติโดยคน";
    }
    result.message += " · การเผยแพร่ต้องได้รับอนุมัติจาก Approver เสมอ";
  }

  const [run] = await db
    .insert(automationRuns)
    .values({
      workspaceId,
      ruleId: rule.id,
      dryRun: opts.dryRun,
      trigger: opts.trigger ?? "manual",
      matched: matches.length,
      createdProjects: result.createdProjectIds.length,
      status: result.status,
      message: result.message,
      details: {
        planned: planned.map((p) => ({ offerId: p.offerId, title: p.title, estCommission: p.estCommission, score: p.score })),
        createdProjectIds: result.createdProjectIds,
        errors: result.errors,
        estimateTotalUsd: result.estimateTotalUsd,
        aiMode: ai.mode,
        quotaRemaining: quota,
      },
    })
    .returning({ id: automationRuns.id });
  result.runId = run.id;

  if (!opts.dryRun) {
    await db.update(automationRules).set({ lastRunAt: now, updatedAt: now }).where(eq(automationRules.id, rule.id));
    await audit(db, {
      workspaceId,
      userId: opts.userId ?? null,
      action: "automation.run",
      entityType: "automation_rule",
      entityId: rule.id,
      metadata: { trigger: opts.trigger ?? "manual", status: result.status, created: result.createdProjectIds.length, matched: matches.length },
    });
  }
  return result;
}

// ---------------------------------------------------------------- jobs & scheduler

export const handleAutomationJob: JobHandler = async (ctx) => {
  const ruleId = String(ctx.job.payload.ruleId ?? "");
  const trigger = ctx.job.payload.trigger === "schedule" ? "schedule" : "manual";
  const rule = ruleId ? await getRule(ctx.db, ctx.job.workspaceId, ruleId) : null;
  if (!rule) throw new PermanentJobError("ไม่พบกฎอัตโนมัติ");
  if (trigger === "schedule" && !rule.enabled) return { skipped: true, reason: "rule disabled" };
  await ctx.progress(20, "ประเมินกฎ");
  const r = await runRule(ctx.db, ctx.job.workspaceId, ruleId, { dryRun: false, trigger, userId: ctx.job.createdBy });
  await ctx.log(r.status === "failed" ? "warn" : "info", r.message, { runId: r.runId, created: r.createdProjectIds.length });
  return { runId: r.runId, status: r.status, created: r.createdProjectIds.length, message: r.message };
};

/** Called by the worker every minute. Enqueues each due daily rule once per Bangkok day. */
export async function runDueSchedules(db: Db, now = new Date()): Promise<number> {
  const rules = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.enabled, true), inArray(automationRules.schedule, ["daily"])));
  let n = 0;
  for (const r of rules) {
    if (!isScheduleDue(r, now)) continue;
    const { created } = await enqueueJob(db, {
      workspaceId: r.workspaceId,
      type: "automation.run",
      payload: { ruleId: r.id, trigger: "schedule" },
      idempotencyKey: `automation:${r.id}:${bangkokDateString(now)}`,
      maxAttempts: 2,
    });
    if (created) {
      n++;
      logger.info("automation.scheduled", { ruleId: r.id });
    }
  }
  return n;
}

