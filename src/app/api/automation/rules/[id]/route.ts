import { and, eq } from "drizzle-orm";
import { automationRules } from "@/db/schema";
import { notFound, parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getRule } from "@/lib/automation/engine";
import { RulePatchSchema } from "@/lib/automation/validation";

type P = { id: string };

export const GET = route<P>({ permission: "automation:read" }, async ({ db, session, params }) => {
  const rule = await getRule(db, session.workspaceId, params.id);
  if (!rule) throw notFound("Rule");
  return { rule };
});

export const PATCH = route<P>({ permission: "automation:manage" }, async ({ db, session, params, req, ip }) => {
  const existing = await getRule(db, session.workspaceId, params.id);
  if (!existing) throw notFound("Rule");
  const body = await parseJson(req, RulePatchSchema);
  const [rule] = await db
    .update(automationRules)
    .set({
      ...body,
      ...(body.actions ? { actions: { ...body.actions, requireApproval: true as const } } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(automationRules.id, params.id), eq(automationRules.workspaceId, session.workspaceId)))
    .returning();
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "automation.rule_update", entityType: "automation_rule", entityId: rule.id, metadata: { fields: Object.keys(body), enabled: rule.enabled }, ip });
  return { rule };
});

export const DELETE = route<P>({ permission: "automation:manage" }, async ({ db, session, params, ip }) => {
  const existing = await getRule(db, session.workspaceId, params.id);
  if (!existing) throw notFound("Rule");
  await db.delete(automationRules).where(eq(automationRules.id, params.id));
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "automation.rule_delete", entityType: "automation_rule", entityId: params.id, metadata: { name: existing.name }, ip });
  return { ok: true };
});
