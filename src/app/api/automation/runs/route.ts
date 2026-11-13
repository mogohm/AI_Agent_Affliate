import { and, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { automationRules, automationRuns } from "@/db/schema";
import { parseQuery, route } from "@/lib/api";

const Q = z.object({ ruleId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(30) });

export const GET = route({ permission: "automation:read" }, async ({ db, session, req }) => {
  const q = parseQuery(req, Q);
  const where: SQL[] = [eq(automationRuns.workspaceId, session.workspaceId)];
  if (q.ruleId) where.push(eq(automationRuns.ruleId, q.ruleId));
  const items = await db
    .select({ run: automationRuns, ruleName: automationRules.name })
    .from(automationRuns)
    .leftJoin(automationRules, eq(automationRules.id, automationRuns.ruleId))
    .where(and(...where))
    .orderBy(desc(automationRuns.createdAt))
    .limit(q.limit);
  return { items: items.map((i) => ({ ...i.run, ruleName: i.ruleName })) };
});
