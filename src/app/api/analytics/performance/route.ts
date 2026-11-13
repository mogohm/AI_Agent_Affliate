import { route } from "@/lib/api";
import { analyticsFilters } from "@/lib/analytics/filters";
import { getPerformance } from "@/lib/analytics/service";

export const GET = route({ permission: "analytics:read" }, async ({ db, session, req }) => {
  const f = await analyticsFilters(req, db, session.workspaceId);
  return { ...(await getPerformance(db, session.workspaceId, f)), includeDemo: f.includeDemo };
});
