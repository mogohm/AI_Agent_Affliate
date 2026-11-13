import { z } from "zod";
import { badRequest, parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getAiContext } from "@/lib/ai/context";
import { mediaStatus } from "@/lib/admin/system";
import { getSetting, setSetting } from "@/lib/settings";

export const GET = route({ permission: "settings:read" }, async ({ db, session }) => {
  const [providers, ai, media] = await Promise.all([getSetting(db, session.workspaceId, "video.providers"), getAiContext(db, session.workspaceId), mediaStatus()]);
  return { providers, aiMode: ai.mode, aiReason: ai.reason, videoModel: ai.models.video, media };
});

const Body = z.object({
  generativeEnabled: z.boolean().optional(),
  maxClipSeconds: z.number().int().min(2).max(20).optional(),
});

export const PATCH = route({ permission: "settings:manage" }, async ({ db, session, req, ip }) => {
  const b = await parseJson(req, Body);
  const cur = await getSetting(db, session.workspaceId, "video.providers");
  if (b.generativeEnabled) {
    const ai = await getAiContext(db, session.workspaceId);
    if (ai.mode !== "live") throw badRequest("ต้องเปิด AI Live Mode และกำหนด API Key ก่อนเปิด Generative AI Video");
  }
  const next = { ...cur, ...b };
  await setSetting(db, session.workspaceId, "video.providers", next, session.id);
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "settings.video_update", metadata: b, ip });
  return { providers: next };
});
