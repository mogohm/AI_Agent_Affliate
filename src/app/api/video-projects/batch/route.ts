import crypto from "node:crypto";
import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createVideoProject, enqueueScriptGeneration } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

const Body = z.object({
  offerIds: z.array(z.string().uuid()).min(1).max(50),
  templateKey: z.string().max(80).optional(),
  language: z.enum(["th", "en"]).optional(),
  renderMode: z.enum(["hybrid", "generative"]).optional(),
  autoGenerateScript: z.boolean().optional(),
});

/** Batch generation: one project per selected offer, scripts queued (renders need human approval). */
export const POST = route({ permission: "video:create" }, async ({ req, db, session, ip }) => {
  const body = await parseJson(req, Body);
  const batchId = crypto.randomUUID();
  const projects: { id: string; title: string }[] = [];
  const errors: { offerId: string; error: string }[] = [];
  for (const offerId of [...new Set(body.offerIds)]) {
    try {
      const p = await createVideoProject(db, session.workspaceId, {
        offerId,
        templateKey: body.templateKey,
        language: body.language,
        renderMode: body.renderMode,
        createdBy: session.id,
        batchId,
      });
      if (body.autoGenerateScript !== false) await enqueueScriptGeneration(db, session.workspaceId, p.id, session.id);
      projects.push({ id: p.id, title: p.title });
    } catch (e) {
      errors.push({ offerId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "video.batch_create", entityType: "video_batch", entityId: batchId, metadata: { count: projects.length, errors: errors.length }, ip });
  return { batchId, projects, errors };
});
