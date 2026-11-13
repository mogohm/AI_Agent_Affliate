import { eq } from "drizzle-orm";
import { mediaAssets, videoProjects } from "@/db/schema";
import { ApiError, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { assetUrl, getStorage } from "@/lib/storage";
import { getProject } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

/** Export an approved MP4 (manual posting). Returns a download URL; records the export. */
export const POST = route<{ id: string }>({ permission: "video:export" }, async ({ db, session, params, ip }) => {
  const p = await getProject(db, session.workspaceId, params.id);
  if (!["approved", "exported", "published"].includes(p.status)) throw new ApiError(409, "ส่งออกได้เฉพาะวิดีโอที่ผ่านการอนุมัติแล้ว", "not_approved");
  if (!p.outputAssetId) throw new ApiError(409, "ยังไม่มีไฟล์วิดีโอ", "no_output");
  const [asset] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, p.outputAssetId));
  const signed = asset ? await getStorage().signedUrl(asset.storageKey, 900, asset.fileName ?? "video.mp4") : null;
  if (p.status === "approved") await db.update(videoProjects).set({ status: "exported", updatedAt: new Date() }).where(eq(videoProjects.id, p.id));
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "video.exported", entityType: "video_project", entityId: p.id, ip });
  return {
    downloadUrl: signed ?? assetUrl(p.outputAssetId, true),
    subtitleUrl: p.subtitleAssetId ? assetUrl(p.subtitleAssetId, true) : null,
    caption: p.script ? `${p.script.caption}\n\n${p.script.hashtags.join(" ")}` : null,
    affiliateUrl: p.facts?.affiliateUrl ?? null,
  };
});
