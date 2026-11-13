import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { enqueueRender } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

/** (Re)render — budget guard runs before the job is dispatched. */
export const POST = route<{ id: string }>({ permission: "video:create" }, async ({ db, session, params, ip }) => {
  const r = await enqueueRender(db, session.workspaceId, params.id, session.id);
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "video.render_queued", entityType: "video_project", entityId: params.id, metadata: { jobId: r.jobId }, ip });
  return r;
});
