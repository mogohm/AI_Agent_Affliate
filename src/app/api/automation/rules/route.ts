import { desc, eq } from "drizzle-orm";
import { automationRules } from "@/db/schema";
import { parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createdTodayByRule } from "@/lib/automation/engine";
import { RuleInputSchema } from "@/lib/automation/validation";

export const GET = route({ permission: "automation:read" }, async ({ db, session }) => {
  const rules = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.workspaceId, session.workspaceId))
    .orderBy(desc(automationRules.createdAt));
  const items = await Promise.all(rules.map(async (r) => ({ ...r, createdToday: await createdTodayByRule(db, r.id) })));
  return { items };
});

export const POST = route({ permission: "automation:manage" }, async ({ db, session, req, ip }) => {
  const body = await parseJson(req, RuleInputSchema);
  const [rule] = await db
    .insert(automationRules)
    .values({ ...body, workspaceId: session.workspaceId, createdBy: session.id, actions: { ...body.actions, requireApproval: true } })
    .returning();
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "automation.rule_create", entityType: "automation_rule", entityId: rule.id, metadata: { name: rule.name }, ip });
  return { rule };
});
