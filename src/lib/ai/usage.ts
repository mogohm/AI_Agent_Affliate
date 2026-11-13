import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { providerUsageCosts, videoProjects } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { startOfBangkokDay, startOfBangkokMonth } from "@/lib/time";

export type UsageEntry = {
  workspaceId: string;
  provider: string;
  model?: string | null;
  operation: string;
  units: number;
  unit: "tokens" | "images" | "seconds" | "chars" | "requests";
  costUsd: number;
  isEstimate?: boolean;
  projectId?: string | null;
  jobId?: string | null;
};

export async function recordUsage(db: Db, e: UsageEntry) {
  await db.insert(providerUsageCosts).values({
    workspaceId: e.workspaceId,
    provider: e.provider,
    model: e.model ?? null,
    operation: e.operation,
    units: e.units,
    unit: e.unit,
    costUsd: e.costUsd,
    isEstimate: e.isEstimate ?? true,
    projectId: e.projectId ?? null,
    jobId: e.jobId ?? null,
  });
  if (e.projectId && e.costUsd > 0) {
    await db
      .update(videoProjects)
      .set({ actualCostUsd: sql`${videoProjects.actualCostUsd} + ${e.costUsd}` })
      .where(eq(videoProjects.id, e.projectId));
  }
}

export async function spentUsdSince(db: Db, workspaceId: string, since: Date): Promise<number> {
  const [r] = await db
    .select({ total: sql<number>`coalesce(sum(${providerUsageCosts.costUsd}), 0)::float8` })
    .from(providerUsageCosts)
    .where(and(eq(providerUsageCosts.workspaceId, workspaceId), gte(providerUsageCosts.createdAt, since)));
  return Number(r?.total ?? 0);
}

export type BudgetCheck = {
  ok: boolean;
  reason: string | null;
  estimateUsd: number;
  spentTodayUsd: number;
  spentMonthUsd: number;
  limits: { dailyUsd: number; monthlyUsd: number; perVideoUsd: number };
};

/** Budget guard — MUST be called before dispatching paid work. Demo (zero-cost) work always passes. */
export async function checkBudget(db: Db, workspaceId: string, estimateUsd: number, opts: { perVideo?: boolean } = {}): Promise<BudgetCheck> {
  const b = await getSetting(db, workspaceId, "budget");
  const now = new Date();
  const [spentTodayUsd, spentMonthUsd] = await Promise.all([
    spentUsdSince(db, workspaceId, startOfBangkokDay(now)),
    spentUsdSince(db, workspaceId, startOfBangkokMonth(now)),
  ]);
  const limits = { dailyUsd: b.dailyUsd, monthlyUsd: b.monthlyUsd, perVideoUsd: b.perVideoUsd };
  let reason: string | null = null;
  if (estimateUsd > 0) {
    if (opts.perVideo && estimateUsd > b.perVideoUsd) reason = `ค่าใช้จ่ายประมาณการ $${estimateUsd.toFixed(3)} เกินงบต่อคลิป $${b.perVideoUsd}`;
    else if (spentTodayUsd + estimateUsd > b.dailyUsd) reason = `เกินงบรายวัน ($${spentTodayUsd.toFixed(2)} + $${estimateUsd.toFixed(3)} > $${b.dailyUsd})`;
    else if (spentMonthUsd + estimateUsd > b.monthlyUsd) reason = `เกินงบรายเดือน ($${spentMonthUsd.toFixed(2)} + $${estimateUsd.toFixed(3)} > $${b.monthlyUsd})`;
  }
  return { ok: !reason, reason, estimateUsd, spentTodayUsd, spentMonthUsd, limits };
}
