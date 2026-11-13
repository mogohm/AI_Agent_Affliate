import { notFound, route } from "@/lib/api";
import { getRule, runRule } from "@/lib/automation/engine";

/** Run now (synchronous — creating projects + enqueueing jobs is quick; heavy work happens in the worker). */
export const POST = route<{ id: string }>({ permission: "automation:manage" }, async ({ db, session, params }) => {
  if (!(await getRule(db, session.workspaceId, params.id))) throw notFound("Rule");
  return runRule(db, session.workspaceId, params.id, { dryRun: false, trigger: "manual", userId: session.id });
});
