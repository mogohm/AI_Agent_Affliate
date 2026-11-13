import { eq } from "drizzle-orm";
import { z } from "zod";
import { videoProjects } from "@/db/schema";
import { ApiError, parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getProject } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

const Body = z.object({
  channel: z.enum(["tiktok", "facebook", "instagram", "youtube", "line", "other"]),
  postUrl: z.string().url().max(500).optional(),
  note: z.string().max(1000).optional(),
});

/**
 * Records a MANUAL publication (the user posted the exported MP4 themselves).
 * No auto-posting: that requires an authorized publishing integration per channel's API/terms.
 */
export const POST = route<{ id: string }>({ permission: "video:publish" }, async ({ req, db, session, params, ip }) => {
  const body = await parseJson(req, Body);
  const p = await getProject(db, session.workspaceId, params.id);
  if (!["approved", "exported", "published"].includes(p.status)) throw new ApiError(409, "ต้องอนุมัติวิดีโอก่อนบันทึกการเผยแพร่", "not_approved");
  const [project] = await db
    .update(videoProjects)
    .set({
      status: "published",
      publishedAt: new Date(),
      publishChannel: body.channel,
      publishNote: [body.postUrl, body.note].filter(Boolean).join(" · ") || null,
      updatedAt: new Date(),
    })
    .where(eq(videoProjects.id, p.id))
    .returning();
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "video.published_manual", entityType: "video_project", entityId: p.id, metadata: body, ip });
  return { project, mode: "manual_record" };
});
