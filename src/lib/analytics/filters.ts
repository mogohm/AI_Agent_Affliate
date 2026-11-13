import type { NextRequest } from "next/server";
import { z } from "zod";
import type { Db } from "@/db/client";
import { parseQuery } from "@/lib/api";
import { hasRealAnalyticsData, type AnalyticsFilters } from "./service";

const Q = z.object({
  period: z.coerce.number().int().min(1).max(365).default(30),
  marketplace: z.enum(["shopee", "lazada"]).optional(),
  includeDemo: z.enum(["true", "false", "auto"]).default("auto"),
});

/** Parse filters; includeDemo=auto → include demo rows only when no real (imported/API) data exists. */
export async function analyticsFilters(req: NextRequest, db: Db, workspaceId: string): Promise<AnalyticsFilters & { hasRealData: boolean }> {
  const q = parseQuery(req, Q);
  const hasRealData = await hasRealAnalyticsData(db, workspaceId);
  const includeDemo = q.includeDemo === "auto" ? !hasRealData : q.includeDemo === "true";
  return { periodDays: q.period, marketplace: q.marketplace, includeDemo, hasRealData };
}
