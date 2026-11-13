import { and, asc, count, desc, eq, gte, isNull } from "drizzle-orm";
import { categories, creativeTemplates, productScores, products, videoProjects } from "@/db/schema";
import { route } from "@/lib/api";
import { getAiContext } from "@/lib/ai/context";
import { checkBudget } from "@/lib/ai/usage";
import { startOfBangkokDay } from "@/lib/time";

/** Live pipeline counts + reference data for the Automation Factory page. */
export const GET = route({ permission: "automation:read" }, async ({ db, session }) => {
  const ws = session.workspaceId;
  const [[prod], scored, byStatus, cats, templates, budget, ai, [today]] = await Promise.all([
    db.select({ n: count() }).from(products).where(and(eq(products.workspaceId, ws), isNull(products.deletedAt))),
    db
      .selectDistinctOn([productScores.productId], { productId: productScores.productId, score: productScores.score, needsReview: productScores.needsReview })
      .from(productScores)
      .where(eq(productScores.workspaceId, ws))
      .orderBy(productScores.productId, desc(productScores.createdAt)),
    db.select({ status: videoProjects.status, n: count() }).from(videoProjects).where(eq(videoProjects.workspaceId, ws)).groupBy(videoProjects.status),
    db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.workspaceId, ws)).orderBy(asc(categories.name)),
    db
      .select({ key: creativeTemplates.key, name: creativeTemplates.name, version: creativeTemplates.version })
      .from(creativeTemplates)
      .where(and(eq(creativeTemplates.workspaceId, ws), eq(creativeTemplates.isActive, true)))
      .orderBy(asc(creativeTemplates.name)),
    checkBudget(db, ws, 0),
    getAiContext(db, ws),
    db.select({ n: count() }).from(videoProjects).where(and(eq(videoProjects.workspaceId, ws), gte(videoProjects.createdAt, startOfBangkokDay()))),
  ]);
  const s = Object.fromEntries(byStatus.map((r) => [r.status, r.n])) as Record<string, number>;
  const sum = (...k: string[]) => k.reduce((a, x) => a + (s[x] ?? 0), 0);
  const uniqueTemplates = [...new Map(templates.map((t) => [t.key, t])).values()];
  return {
    pipeline: {
      imported: prod.n,
      scored: scored.length,
      highOpportunity: scored.filter((x) => (x.score ?? 0) >= 70 && !x.needsReview).length,
      creative: sum("created", "script_generating", "awaiting_approval"),
      rendering: sum("queued_render", "asset_generation", "rendering"),
      review: sum("quality_review"),
      approved: sum("approved", "exported"),
      published: sum("published"),
      failed: sum("failed"),
    },
    projectsToday: today.n,
    categories: cats,
    templates: uniqueTemplates,
    budget: { limits: budget.limits, spentTodayUsd: budget.spentTodayUsd, spentMonthUsd: budget.spentMonthUsd },
    aiMode: ai.mode,
  };
});
