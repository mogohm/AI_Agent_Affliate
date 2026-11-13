import { eq } from "drizzle-orm";
import { z } from "zod";
import { videoProjects, videoScenes } from "@/db/schema";
import { ApiError, parseJson, route } from "@/lib/api";
import { getProject, PROCESSING_STATUSES } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

const Scene = z.object({
  durationSec: z.number().min(1).max(30),
  title: z.string().min(1).max(80),
  caption: z.string().max(160),
  voiceover: z.string().max(500),
  visualPrompt: z.string().max(800),
  shotType: z.enum(["hook", "problem", "solution", "showcase", "benefit", "cta"]),
});
const Body = z.object({
  scenes: z.array(Scene).min(1).max(10),
  script: z.object({ caption: z.string().max(2000).optional(), hashtags: z.array(z.string().max(60)).max(15).optional() }).optional(),
});

/** Replace the storyboard with human edits. Rendered output becomes outdated → back to awaiting approval. */
export const PUT = route<{ id: string }>({ permission: "video:create" }, async ({ req, db, session, params }) => {
  const body = await parseJson(req, Body);
  const p = await getProject(db, session.workspaceId, params.id);
  if ((PROCESSING_STATUSES as readonly string[]).includes(p.status) || p.status === "published") {
    throw new ApiError(409, "ไม่สามารถแก้ Storyboard ระหว่างประมวลผลหรือหลังเผยแพร่", "locked");
  }
  if (!p.script) throw new ApiError(409, "ต้องสร้างสคริปต์ก่อนแก้ไข Storyboard", "no_script");
  const total = body.scenes.reduce((a, s) => a + s.durationSec, 0);
  if (total > 60) throw new ApiError(400, "ความยาวรวมต้องไม่เกิน 60 วินาที", "too_long");
  await db.delete(videoScenes).where(eq(videoScenes.projectId, p.id));
  await db.insert(videoScenes).values(body.scenes.map((s, i) => ({ ...s, projectId: p.id, idx: i })));
  const script = {
    ...p.script,
    ...(body.script?.caption !== undefined ? { caption: body.script.caption } : {}),
    ...(body.script?.hashtags ? { hashtags: body.script.hashtags } : {}),
    hook: body.scenes[0]?.voiceover ?? p.script.hook,
    cta: body.scenes[body.scenes.length - 1]?.voiceover ?? p.script.cta,
    body: body.scenes.slice(1, -1).map((s) => s.voiceover).join(" "),
  };
  const [project] = await db
    .update(videoProjects)
    .set({ script, durationSec: Math.round(total), status: "awaiting_approval", scriptGenerator: p.scriptGenerator?.includes("+edited") ? p.scriptGenerator : `${p.scriptGenerator ?? "manual"}+edited`, updatedAt: new Date() })
    .where(eq(videoProjects.id, p.id))
    .returning();
  return { project };
});
