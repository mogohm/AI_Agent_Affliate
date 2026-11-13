import { route } from "@/lib/api";
import { checkBudget } from "@/lib/ai/usage";
import { estimateProjectCostUsd } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>({ permission: "video:read" }, async ({ db, session, params }) => {
  const estimate = await estimateProjectCostUsd(db, session.workspaceId, params.id);
  const budget = await checkBudget(db, session.workspaceId, estimate.totalUsd, { perVideo: true });
  return { estimate, budget };
});
