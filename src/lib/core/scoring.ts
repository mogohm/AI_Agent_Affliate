/**
 * Opportunity Score — transparent, configurable, and honest about missing data.
 *
 * - Each component is normalised to 0..1 from REAL input fields only. Missing input → value null.
 * - Score = 100 × Σ(wᵢ·vᵢ) / Σ(wᵢ over available components). Missing components are NOT imputed.
 * - Confidence = (available weight share) × (data reliability: origin, freshness, estimated rate).
 * - needsReview when confidence < 0.5 or the commission itself is unknown.
 */
import type { ScoreComponent } from "@/db/schema";
import { freshness, type Freshness } from "./commission";

export type ScoringWeights = {
  commissionAmount: number;
  sales: number;
  rating: number;
  commissionRate: number;
  trend: number;
  content: number;
};

export const DEFAULT_WEIGHTS: ScoringWeights = {
  commissionAmount: 30,
  sales: 20,
  rating: 15,
  commissionRate: 10,
  trend: 10,
  content: 15,
};

export const SCORE_VERSION = "opp-v1";

export type ScoringInput = {
  price: number | null;
  commissionRate: number | null;
  commissionAmount: number | null;
  commissionIsEstimated: boolean;
  soldCount: number | null;
  rating: number | null;
  ratingCount: number | null;
  /** 0..100 trend/demand index from an authorised source (feed column, API) — null when unknown. */
  trendScore: number | null;
  /** 0..1 content suitability from analyzer (rules or AI). */
  contentPotential: number | null;
  contentEvidence?: string;
  dataOrigin: "demo" | "csv" | "feed" | "manual" | "api";
  fetchedAt: Date | string | null;
};

export type ScoringResult = {
  score: number | null;
  confidence: number;
  components: ScoreComponent[];
  missingFields: string[];
  needsReview: boolean;
  reliability: number;
  freshness: Freshness;
  explanation: string;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const ORIGIN_RELIABILITY = { api: 1, feed: 0.9, csv: 0.85, manual: 0.7, demo: 0.5 } as const;
const FRESHNESS_RELIABILITY: Record<Freshness, number> = { fresh: 1, aging: 0.85, stale: 0.6, unknown: 0.7 };

/** Reference points for normalisation (THB). */
export const SCORING_REFERENCE = { commissionAmountTarget: 150, commissionRateTarget: 20, soldLog10Target: 4 };

export function computeOpportunityScore(input: ScoringInput, weights: ScoringWeights = DEFAULT_WEIGHTS, now = new Date()): ScoringResult {
  const fmt = (n: number) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
  const comps: ScoreComponent[] = [];

  comps.push({
    key: "commissionAmount",
    label: "ค่าคอมต่อออเดอร์ (ประมาณการ)",
    weight: weights.commissionAmount,
    value: input.commissionAmount === null ? null : clamp01(input.commissionAmount / SCORING_REFERENCE.commissionAmountTarget),
    evidence: input.commissionAmount === null ? "ไม่มีราคา/อัตราค่าคอม" : `฿${fmt(input.commissionAmount)} ต่อออเดอร์ (เป้าอ้างอิง ฿${SCORING_REFERENCE.commissionAmountTarget})`,
  });
  comps.push({
    key: "sales",
    label: "หลักฐานยอดขาย",
    weight: weights.sales,
    value: input.soldCount === null ? null : clamp01(Math.log10(Math.max(0, input.soldCount) + 1) / SCORING_REFERENCE.soldLog10Target),
    evidence: input.soldCount === null ? "ไม่มีข้อมูลยอดขาย" : `ขายแล้ว ${fmt(input.soldCount)} ชิ้น (จากแหล่งข้อมูล)`,
  });
  let ratingValue: number | null = null;
  if (input.rating !== null) {
    const base = clamp01((input.rating - 3) / 2);
    // shrink towards neutral when there are few reviews
    const n = input.ratingCount ?? 0;
    const shrink = n > 0 ? Math.min(1, Math.log10(n + 1) / 2) : 0.5;
    ratingValue = clamp01(0.5 + (base - 0.5) * shrink);
  }
  comps.push({
    key: "rating",
    label: "คะแนนรีวิวสินค้า",
    weight: weights.rating,
    value: ratingValue,
    evidence: input.rating === null ? "ไม่มีคะแนนรีวิว" : `${input.rating.toFixed(1)}/5 จาก ${input.ratingCount ?? "ไม่ทราบจำนวน"} รีวิว`,
  });
  comps.push({
    key: "commissionRate",
    label: "อัตราค่าคอม %",
    weight: weights.commissionRate,
    value: input.commissionRate === null ? null : clamp01(input.commissionRate / SCORING_REFERENCE.commissionRateTarget),
    evidence: input.commissionRate === null ? "ไม่มีอัตราค่าคอม" : `${fmt(input.commissionRate)}%${input.commissionIsEstimated ? " (ค่าประมาณ)" : ""}`,
  });
  comps.push({
    key: "trend",
    label: "Demand / Trend",
    weight: weights.trend,
    value: input.trendScore === null ? null : clamp01(input.trendScore / 100),
    evidence: input.trendScore === null ? "ยังไม่มีข้อมูลเทรนด์จากแหล่งที่ได้รับอนุญาต" : `ดัชนีเทรนด์ ${fmt(input.trendScore)}/100`,
  });
  comps.push({
    key: "content",
    label: "ศักยภาพทำวิดีโอ",
    weight: weights.content,
    value: input.contentPotential === null ? null : clamp01(input.contentPotential),
    evidence: input.contentEvidence ?? (input.contentPotential === null ? "ยังไม่ได้วิเคราะห์" : "ประเมินจากหมวดหมู่และข้อมูลสินค้า"),
  });

  const totalW = comps.reduce((a, c) => a + c.weight, 0) || 1;
  const avail = comps.filter((c) => c.value !== null && c.weight > 0);
  const availW = avail.reduce((a, c) => a + c.weight, 0);
  const score = availW > 0 ? Math.round((100 * avail.reduce((a, c) => a + c.weight * (c.value as number), 0)) / availW) : null;

  const fresh = freshness(input.fetchedAt, now);
  const reliability =
    ORIGIN_RELIABILITY[input.dataOrigin] * FRESHNESS_RELIABILITY[fresh] * (input.commissionIsEstimated ? 0.8 : 1);
  const coverage = availW / totalW;
  const confidence = Math.round(coverage * reliability * 100) / 100;

  const missingFields: string[] = [];
  if (input.price === null) missingFields.push("price");
  if (input.commissionRate === null) missingFields.push("commission_rate");
  if (input.soldCount === null) missingFields.push("sold_count");
  if (input.rating === null) missingFields.push("rating");
  if (input.trendScore === null) missingFields.push("trend_score");
  if (input.contentPotential === null) missingFields.push("content_potential");

  const needsReview = confidence < 0.5 || input.commissionAmount === null;

  const top = [...avail].sort((a, b) => b.weight * (b.value ?? 0) - a.weight * (a.value ?? 0)).slice(0, 2);
  const parts: string[] = [];
  if (score === null) parts.push("ยังคำนวณคะแนนไม่ได้เพราะไม่มีข้อมูลที่ใช้ให้คะแนน");
  else parts.push(`คะแนน ${score}/100 คำนวณจาก ${avail.length}/${comps.length} ปัจจัยที่มีข้อมูลจริง`);
  if (top.length) parts.push(`จุดแข็ง: ${top.map((c) => c.label).join(", ")}`);
  if (missingFields.length) parts.push(`ข้อมูลที่ขาด: ${missingFields.join(", ")} (ไม่ได้นำมาคิดและลดความเชื่อมั่น)`);
  if (input.dataOrigin === "demo") parts.push("⚠ เป็นข้อมูลตัวอย่าง (DEMO) ไม่ใช่ข้อมูลจริงจาก Marketplace");
  if (fresh === "stale") parts.push("ข้อมูลเก่ากว่า 30 วัน ควรซิงก์ใหม่");
  if (needsReview) parts.push("ควรตรวจสอบโดยคนก่อนนำไปผลิต");

  return { score, confidence, components: comps, missingFields, needsReview, reliability: Math.round(reliability * 100) / 100, freshness: fresh, explanation: parts.join(" · ") };
}
