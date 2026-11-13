import { route } from "@/lib/api";
import { analyticsFilters } from "@/lib/analytics/filters";
import { getSummary } from "@/lib/analytics/service";

export const GET = route({ permission: "analytics:read" }, async ({ db, session, req }) => {
  const f = await analyticsFilters(req, db, session.workspaceId);
  return { ...(await getSummary(db, session.workspaceId, f)), hasRealData: f.hasRealData, includeDemo: f.includeDemo };
});
