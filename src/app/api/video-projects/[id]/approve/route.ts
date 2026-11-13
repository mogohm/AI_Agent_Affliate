import { eq } from "drizzle-orm";
import { z } from "zod";
import { videoProjects } from "@/db/schema";
import { ApiError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getProject } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

const Body = z.object({ note: z.string().max(1000).optional() });

/** Quality review sign-off (Approver/Admin only). */
export const POST = route<{ id: string }>({ permission: "video:approve" }, async ({ req, db, session, params, ip }) => {
  const text = await req.text();
  const body = Body.parse(text ? JSON.parse(text) : {});
  const p = await getProject(db, session.workspaceId, params.id);
  if (p.status !== "quality_review") throw new ApiError(409, "วิดีโอต้องอยู่ในสถานะรอตรวจคุณภาพ", "invalid_status");
  const [project] = await db
    .update(videoProjects)
    .set({ status: "approved", approvedBy: session.id, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(videoProjects.id, p.id))
    .returning();
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "video.approved", entityType: "video_project", entityId: p.id, metadata: { note: body.note ?? null }, ip });
  return { project };
});
