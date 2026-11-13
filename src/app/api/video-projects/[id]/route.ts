import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { mediaAssets, videoProjects } from "@/db/schema";
import { ApiError, parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getStorage } from "@/lib/storage";
import { getProject, getTemplate, PROCESSING_STATUSES } from "@/lib/video/projects";
import { getProjectBundle } from "@/lib/video/queries";

export const dynamic = "force-dynamic";
type P = { id: string };

export const GET = route<P>({ permission: "video:read" }, async ({ db, session, params }) => {
  return getProjectBundle(db, session.workspaceId, params.id);
});

const Patch = z.object({
  title: z.string().min(1).max(200).optional(),
  templateKey: z.string().max(80).optional(),
  language: z.enum(["th", "en"]).optional(),
  renderMode: z.enum(["hybrid", "generative"]).optional(),
  durationSec: z.number().int().min(8).max(60).optional(),
  voice: z.enum(["none", "female", "male"]).optional(),
  music: z.enum(["none", "calm", "upbeat"]).optional(),
  subtitles: z.boolean().optional(),
  disclosure: z.boolean().optional(),
  visualStyle: z.enum(["premium", "minimal", "lifestyle", "playful", "tech"]).optional(),
});

export const PATCH = route<P>({ permission: "video:create" }, async ({ req, db, session, params }) => {
  const body = await parseJson(req, Patch);
  const p = await getProject(db, session.workspaceId, params.id);
  if ((PROCESSING_STATUSES as readonly string[]).includes(p.status) || p.status === "published") {
    throw new ApiError(409, "ไม่สามารถแก้ไขระหว่างประมวลผลหรือหลังเผยแพร่", "locked");
  }
  const { templateKey, ...rest } = body;
  const templateId = templateKey ? (await getTemplate(db, session.workspaceId, templateKey)).id : undefined;
  const contentChanged = ["quality_review", "approved", "exported"].includes(p.status);
  const [project] = await db
    .update(videoProjects)
    .set({ ...rest, ...(templateId ? { templateId } : {}), ...(contentChanged && p.script ? { status: "awaiting_approval" as const } : {}), updatedAt: new Date() })
    .where(eq(videoProjects.id, p.id))
    .returning();
  return { project };
});

export const DELETE = route<P>({ permission: "video:create" }, async ({ db, session, params, ip }) => {
  const p = await getProject(db, session.workspaceId, params.id);
  if ((PROCESSING_STATUSES as readonly string[]).includes(p.status)) throw new ApiError(409, "ยกเลิกงานในคิวก่อนลบโปรเจกต์", "busy");
  const assets = await db.select().from(mediaAssets).where(and(eq(mediaAssets.projectId, p.id), eq(mediaAssets.workspaceId, session.workspaceId)));
  const storage = getStorage();
  for (const a of assets) await storage.delete(a.storageKey).catch(() => undefined);
  await db.delete(mediaAssets).where(eq(mediaAssets.projectId, p.id));
  await db.delete(videoProjects).where(eq(videoProjects.id, p.id));
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "video.delete", entityType: "video_project", entityId: p.id, metadata: { title: p.title }, ip });
  return { ok: true };
});
