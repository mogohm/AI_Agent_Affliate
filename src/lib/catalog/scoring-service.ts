import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categories, productScores, products } from "@/db/schema";
import { ruleContentPotential } from "@/lib/core/categorize";
import { computeOpportunityScore, SCORE_VERSION } from "@/lib/core/scoring";
import { getSetting } from "@/lib/settings";
import { listOffers } from "./service";

export type AnalyzerOutput = {
  analyzer: "rules" | "openai" | "demo";
  model?: string | null;
  contentPotential?: number | null;
  contentEvidence?: string;
  audience?: string | null;
  contentAngles?: string[];
  riskFlags?: string[];
  summary?: string | null;
};

/**
 * Re-compute and store the Opportunity Score for a product using its best offer
 * (highest estimated commission). AI analyzers pass their content assessment via `ai`;
 * otherwise a deterministic rule-based content assessment is used and labelled as such.
 */
export async function rescoreProduct(db: Db, workspaceId: string, productId: string, ai?: AnalyzerOutput) {
  const [p] = await db.select().from(products).where(eq(products.id, productId));
  if (!p || p.workspaceId !== workspaceId) throw new Error("Product not found");
  const { items } = await listOffers(db, workspaceId, { productId, sort: "commission_amount", pageSize: 1 });
  const best = items[0];
  const [cat] = p.categoryId ? await db.select().from(categories).where(eq(categories.id, p.categoryId)) : [];
  const weights = await getSetting(db, workspaceId, "scoring.weights");

  const rules = ruleContentPotential({
    categorySlug: cat?.slug,
    price: best?.price ?? null,
    hasAuthorizedImage: p.imageRights === "authorized" && !!(p.imageUrl || p.imageAssetId),
    descriptionLength: p.description?.length ?? 0,
    attributeCount: Object.keys(p.attributes ?? {}).length,
  });
  const contentPotential = ai?.contentPotential ?? rules.value;
  const contentEvidence = ai?.contentPotential !== undefined && ai?.contentPotential !== null ? ai.contentEvidence ?? "ประเมินโดย AI" : rules.evidence;
  const trendRaw = p.attributes?.trend_score;
  const trend = trendRaw !== undefined && trendRaw !== "" && Number.isFinite(Number(trendRaw)) ? Number(trendRaw) : null;

  const result = computeOpportunityScore({
    price: best?.price ?? null,
    commissionRate: best?.rate_total ?? null,
    commissionAmount: best?.est_commission ?? null,
    commissionIsEstimated: !!best?.rate_is_estimated,
    soldCount: best?.sold_count ?? null,
    rating: best?.rating ?? null,
    ratingCount: best?.rating_count ?? null,
    trendScore: trend,
    contentPotential,
    contentEvidence,
    dataOrigin: best?.data_origin ?? p.dataOrigin,
    fetchedAt: best?.fetched_at ?? null,
  }, weights);

  const analyzer = ai?.analyzer ?? (p.dataOrigin === "demo" ? "demo" : "rules");
  const explanation = [ai?.summary, result.explanation].filter(Boolean).join(" · ");
  const [row] = await db
    .insert(productScores)
    .values({
      workspaceId,
      productId,
      version: SCORE_VERSION,
      score: result.score,
      confidence: result.confidence,
      components: result.components,
      missingFields: result.missingFields,
      explanation,
      analyzer,
      model: ai?.model ?? null,
      audience: ai?.audience ?? null,
      contentAngles: ai?.contentAngles ?? [],
      riskFlags: ai?.riskFlags ?? [],
      needsReview: result.needsReview,
    })
    .returning();
  return row;
}
