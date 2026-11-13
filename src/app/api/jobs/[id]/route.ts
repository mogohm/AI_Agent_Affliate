import { notFound, route } from "@/lib/api";
import { getJobWithEvents } from "@/lib/admin/jobs";

export const GET = route<{ id: string }>({ permission: "video:read" }, async ({ db, session, params }) => {
  const r = await getJobWithEvents(db, session.workspaceId, params.id);
  if (!r) throw notFound("Job");
  return r;
});
