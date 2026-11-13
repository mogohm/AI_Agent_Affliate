import { eq } from "drizzle-orm";
import { z } from "zod";
import { videoProjects } from "@/db/schema";
import { ApiError, parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getProject } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

const Body = z.object({ reason: z.string().min(1).max(1000) });

/** Send back for edits: returns to awaiting_approval with the reviewer's reason. */
export const POST = route<{ id: string }>({ permission: "video:approve" }, async ({ req, db, session, params, ip }) => {
  const body = await parseJson(req, Body);
  const p = await getProject(db, session.workspaceId, params.id);
  if (!["quality_review", "approved"].includes(p.status)) throw new ApiError(409, "ส่งกลับแก้ไขได้เฉพาะวิดีโอที่รอตรวจหรืออนุมัติแล้ว", "invalid_status");
  const [project] = await db
    .update(videoProjects)
    .set({ status: "awaiting_approval", error: `ส่งกลับแก้ไข: ${body.reason}`, approvedAt: null, approvedBy: null, updatedAt: new Date() })
    .where(eq(videoProjects.id, p.id))
    .returning();
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "video.rejected", entityType: "video_project", entityId: p.id, metadata: { reason: body.reason }, ip });
  return { project };
});
