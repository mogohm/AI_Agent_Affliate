/**
 * AI Product Intelligence.
 * - Demo / no-key: deterministic rule-based content assessment (labelled "rules", NOT AI).
 * - Live: OpenAI Responses API with a strict JSON schema; the model may only *judge* content
 *   suitability, audience and risks from the supplied facts — it never supplies sales,
 *   commission, rating or price numbers. Budget is checked before each call and actual token
 *   usage is recorded. API failures fail the job (no silent fallback to invented data).
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categories, marketplaceOffers, products } from "@/db/schema";
import { getAiContext, type AiContext } from "@/lib/ai/context";
import { checkBudget, recordUsage } from "@/lib/ai/usage";
import { enqueueJob } from "@/lib/jobs/queue";
import { PermanentJobError, type JobHandler } from "@/lib/jobs/types";
import { rescoreProduct, type AnalyzerOutput } from "./scoring-service";

export const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["categorySlug", "categoryConfidence", "audience", "contentAngles", "riskFlags", "contentPotential", "contentEvidence", "summary"],
  properties: {
    categorySlug: { type: ["string", "null"], description: "slug from the provided category list, or null if none fits" },
    categoryConfidence: { type: "number", minimum: 0, maximum: 1 },
    audience: { type: "string", description: "Thai: who the product is for, inferred only from the facts" },
    contentAngles: { type: "array", items: { type: "string" }, maxItems: 5 },
    riskFlags: { type: "array", items: { type: "string" }, maxItems: 6, description: "claims/compliance/rights risks; mention missing facts" },
    contentPotential: { type: "number", minimum: 0, maximum: 1, description: "suitability for a 15-30s vertical affiliate video" },
    contentEvidence: { type: "string", description: "Thai; cite the source field names used, e.g. (title, attributes.ขนาด)" },
    summary: { type: "string", description: "Thai one-sentence assessment; no invented numbers" },
  },
} as const;

export type AiAnalysis = {
  categorySlug: string | null;
  categoryConfidence: number;
  audience: string;
  contentAngles: string[];
  riskFlags: string[];
  contentPotential: number;
  contentEvidence: string;
  summary: string;
};

/** Rough token estimate for budget checks before calling (≈ 1 token / 3 chars for mixed Thai/English). */
export function estimateAnalysisCostUsd(ai: Pick<AiContext, "pricing">, promptChars: number) {
  const inTok = Math.ceil(promptChars / 3) + 400;
  const outTok = 600;
  return (inTok * ai.pricing.textInputPer1M + outTok * ai.pricing.textOutputPer1M) / 1_000_000;
}

async function productFacts(db: Db, workspaceId: string, productId: string) {
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.workspaceId, workspaceId), isNull(products.deletedAt)));
  if (!p) return null;
  const offers = await db.select().from(marketplaceOffers).where(eq(marketplaceOffers.productId, productId)).orderBy(desc(marketplaceOffers.fetchedAt)).limit(3);
  return {
    product: p,
    facts: {
      title: p.title,
      brand: p.brand,
      model: p.model,
      sourceCategory: p.sourceCategory,
      description: p.description,
      attributes: Object.fromEntries(Object.entries(p.attributes ?? {}).filter(([k]) => !k.startsWith("demo_") && k !== "trend_score")),
      hasAuthorizedImage: p.imageRights === "authorized" && !!(p.imageUrl || p.imageAssetId),
      offers: offers.map((o) => ({ platform: o.platform, price: o.price, rating: o.rating, ratingCount: o.ratingCount, soldCount: o.soldCount })),
      dataOrigin: p.dataOrigin,
    },
  };
}

/** Analyze one product with the live LLM. Throws on API errors or budget block. */
export async function analyzeWithOpenAI(db: Db, workspaceId: string, productId: string, ai: AiContext, jobId?: string | null): Promise<AnalyzerOutput> {
  if (!ai.client) throw new PermanentJobError("OpenAI client is not configured");
  const loaded = await productFacts(db, workspaceId, productId);
  if (!loaded) throw new PermanentJobError(`Product ${productId} not found`);
  const cats = await db.select({ slug: categories.slug, name: categories.name }).from(categories).where(eq(categories.workspaceId, workspaceId));
  const system = [
    "คุณคือนักวิเคราะห์สินค้า Affiliate สำหรับตลาดไทย ประเมินความเหมาะสมในการทำวิดีโอแนวตั้งสั้น",
    "ใช้เฉพาะข้อมูลใน PRODUCT_FACTS ห้ามเดาหรือสร้างตัวเลขยอดขาย ค่าคอม คะแนนรีวิว หรือราคา",
    "ถ้าข้อมูลไม่พอ ให้ระบุใน riskFlags และลด contentPotential/categoryConfidence",
    "contentEvidence ต้องอ้างชื่อฟิลด์ต้นทางที่ใช้ เช่น (title, description, attributes.xxx)",
    "เลือก categorySlug จากรายการ CATEGORIES เท่านั้น หรือ null",
  ].join("\n");
  const user = `CATEGORIES: ${JSON.stringify(cats)}\nPRODUCT_FACTS: ${JSON.stringify(loaded.facts)}`;
  const estimate = estimateAnalysisCostUsd(ai, system.length + user.length);
  const budget = await checkBudget(db, workspaceId, estimate);
  if (!budget.ok) throw new PermanentJobError(`งบประมาณไม่พอ: ${budget.reason}`);

  const resp = await ai.client.responses.create({
    model: ai.models.text,
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    text: { format: { type: "json_schema", name: "product_analysis", schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>, strict: true } },
  });
  const usage = (resp as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  const inTok = usage?.input_tokens ?? 0;
  const outTok = usage?.output_tokens ?? 0;
  await recordUsage(db, {
    workspaceId,
    provider: "openai",
    model: ai.models.text,
    operation: "product.analyze",
    units: inTok + outTok,
    unit: "tokens",
    costUsd: (inTok * ai.pricing.textInputPer1M + outTok * ai.pricing.textOutputPer1M) / 1_000_000,
    isEstimate: true,
    jobId: jobId ?? null,
  });

  let parsed: AiAnalysis;
  try {
    parsed = JSON.parse(resp.output_text) as AiAnalysis;
  } catch {
    throw new Error("OpenAI ตอบกลับไม่ใช่ JSON ตาม schema");
  }
  const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null);

  // Apply AI category only when the product's category came from weak sources.
  if (parsed.categorySlug) {
    const cat = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.workspaceId, workspaceId), eq(categories.slug, parsed.categorySlug)))
      .limit(1);
    const conf = clamp(parsed.categoryConfidence) ?? 0;
    const p = loaded.product;
    const weak = !p.categoryId || p.categorySource === "rules" || p.categorySource === "ai";
    if (cat[0] && weak && conf >= (p.categoryConfidence ?? 0)) {
      await db.update(products).set({ categoryId: cat[0].id, categorySource: "ai", categoryConfidence: conf, updatedAt: new Date() }).where(eq(products.id, productId));
    }
  }

  return {
    analyzer: "openai",
    model: ai.models.text,
    contentPotential: clamp(parsed.contentPotential),
    contentEvidence: `AI (${ai.models.text}): ${String(parsed.contentEvidence ?? "").slice(0, 500)}`,
    audience: String(parsed.audience ?? "").slice(0, 300) || null,
    contentAngles: (parsed.contentAngles ?? []).map(String).slice(0, 5),
    riskFlags: (parsed.riskFlags ?? []).map(String).slice(0, 6),
    summary: String(parsed.summary ?? "").slice(0, 400) || null,
  };
}

/** Analyze (and re-score) a list of products. Returns per-product outcome. */
export async function analyzeProducts(db: Db, workspaceId: string, productIds: string[], opts: { jobId?: string | null; onProgress?: (done: number, total: number) => Promise<void> } = {}) {
  const ai = await getAiContext(db, workspaceId);
  const results: { productId: string; score: number | null; analyzer: string }[] = [];
  let i = 0;
  for (const id of productIds) {
    const aiOut = ai.mode === "live" ? await analyzeWithOpenAI(db, workspaceId, id, ai, opts.jobId) : undefined;
    const row = await rescoreProduct(db, workspaceId, id, aiOut);
    results.push({ productId: id, score: row.score, analyzer: row.analyzer });
    await opts.onProgress?.(++i, productIds.length);
  }
  return { mode: ai.mode, results };
}

export const handleAnalyzeJob: JobHandler = async (ctx) => {
  const { db, job } = ctx;
  const payload = job.payload as { productIds?: string[]; all?: boolean };
  let ids = payload.productIds ?? [];
  if (payload.all) {
    const rows = await db.select({ id: products.id }).from(products).where(and(eq(products.workspaceId, job.workspaceId), isNull(products.deletedAt)));
    ids = rows.map((r) => r.id);
  } else if (ids.length) {
    const rows = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.workspaceId, job.workspaceId), inArray(products.id, ids), isNull(products.deletedAt)));
    ids = rows.map((r) => r.id);
  }
  if (!ids.length) throw new PermanentJobError("ไม่มีสินค้าให้วิเคราะห์");
  await ctx.log("info", `Analyzing ${ids.length} product(s)`);
  const out = await analyzeProducts(db, job.workspaceId, ids, {
    jobId: job.id,
    onProgress: async (done, total) => {
      await ctx.progress((done / total) * 100, `วิเคราะห์แล้ว ${done}/${total}`);
      if (await ctx.isCanceled()) throw new PermanentJobError("canceled");
    },
  });
  return { mode: out.mode, analyzed: out.results.length };
};

export async function enqueueAnalysis(db: Db, workspaceId: string, input: { productIds?: string[]; all?: boolean }, userId?: string | null) {
  const key = input.all ? `analyze:all:${new Date().toISOString().slice(0, 16)}` : undefined;
  return enqueueJob(db, {
    workspaceId,
    type: "product.analyze",
    payload: input,
    idempotencyKey: key,
    createdBy: userId ?? null,
    maxAttempts: 2,
  });
}
