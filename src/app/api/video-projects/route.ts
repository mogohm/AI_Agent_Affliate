import { z } from "zod";
import { parseJson, parseQuery, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createVideoProject, enqueueScriptGeneration } from "@/lib/video/projects";

import { getProjectBundle, listProjects } from "@/lib/video/queries";

export const dynamic = "force-dynamic";

const ListQ = z.object({
  group: z.enum(["draft", "processing", "review", "approved", "published", "failed"]).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = route({ permission: "video:read" }, async ({ req, db, session }) => {
  return listProjects(db, session.workspaceId, parseQuery(req, ListQ));
});

const CreateBody = z.object({
  offerId: z.string().uuid(),
  templateKey: z.string().max(80).optional(),
  language: z.enum(["th", "en"]).optional(),
  renderMode: z.enum(["hybrid", "generative"]).optional(),
  durationSec: z.number().int().min(8).max(60).optional(),
  voice: z.enum(["none", "female", "male"]).optional(),
  music: z.enum(["none", "calm", "upbeat"]).optional(),
  subtitles: z.boolean().optional(),
  disclosure: z.boolean().optional(),
  visualStyle: z.enum(["premium", "minimal", "lifestyle", "playful", "tech"]).optional(),
  generateScript: z.boolean().optional(),
});

export const POST = route({ permission: "video:create" }, async ({ req, db, session, ip }) => {
  const body = await parseJson(req, CreateBody);
  const { generateScript, ...input } = body;
  const project = await createVideoProject(db, session.workspaceId, { ...input, createdBy: session.id });
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "video.create", entityType: "video_project", entityId: project.id, ip });
  if (generateScript) await enqueueScriptGeneration(db, session.workspaceId, project.id, session.id);
  const bundle = generateScript ? await getProjectBundle(db, session.workspaceId, project.id) : null;
  return { project: bundle?.project ?? project };
});
