import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { getDashboard } from "@/lib/catalog/dashboard";

const Query = z.object({
  period: z.enum(["7", "30", "90"]).default("30"),
  marketplace: z.enum(["shopee", "lazada"]).optional(),
  categoryId: z.string().uuid().optional(),
});

export const GET = route({ permission: "products:read" }, async ({ req, db, session }) => {
  const q = parseQuery(req, Query);
  return getDashboard(db, session.workspaceId, { periodDays: Number(q.period) as 7 | 30 | 90, marketplace: q.marketplace, categoryId: q.categoryId });
});
