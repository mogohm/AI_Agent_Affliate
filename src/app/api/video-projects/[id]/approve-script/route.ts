import { ApiError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { enqueueRender, getProject } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

/** Human approval of script/storyboard facts, then budget-guarded render enqueue. */
export const POST = route<{ id: string }>({ permission: "video:create" }, async ({ db, session, params, ip }) => {
  const p = await getProject(db, session.workspaceId, params.id);
  if (p.status !== "awaiting_approval") throw new ApiError(409, "สคริปต์ไม่ได้อยู่ในสถานะรออนุมัติ", "invalid_status");
  const r = await enqueueRender(db, session.workspaceId, p.id, session.id);
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "video.script_approved", entityType: "video_project", entityId: p.id, metadata: { jobId: r.jobId }, ip });
  return r;
});
