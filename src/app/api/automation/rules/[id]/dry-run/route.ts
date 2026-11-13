import { notFound, route } from "@/lib/api";
import { getRule, runRule } from "@/lib/automation/engine";

export const POST = route<{ id: string }>({ permission: "automation:manage" }, async ({ db, session, params }) => {
  if (!(await getRule(db, session.workspaceId, params.id))) throw notFound("Rule");
  return runRule(db, session.workspaceId, params.id, { dryRun: true, userId: session.id });
});
