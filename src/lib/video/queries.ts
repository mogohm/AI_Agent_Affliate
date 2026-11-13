import { and, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { creativeTemplates, jobs, marketplaceOffers, mediaAssets, productScores, products, videoProjects } from "@/db/schema";
import { assetUrl } from "@/lib/storage";
import { VIDEO_STATUS, type LibraryGroup } from "@/lib/labels";
import { estimateProjectCostUsd, getProject, getScenes } from "./projects";

const GROUP_STATUSES = (g: LibraryGroup) => Object.entries(VIDEO_STATUS).filter(([, v]) => v.group === g).map(([k]) => k) as (typeof videoProjects.$inferSelect)["status"][];

export async function listProjects(db: Db, workspaceId: string, f: { group?: LibraryGroup; search?: string; page?: number; pageSize?: number }) {
  const where: SQL[] = [eq(videoProjects.workspaceId, workspaceId)];
  if (f.group) where.push(inArray(videoProjects.status, GROUP_STATUSES(f.group)));
  if (f.search?.trim()) {
    const q = `%${f.search.trim()}%`;
    where.push(or(ilike(videoProjects.title, q), ilike(products.title, q))!);
  }
  const pageSize = Math.min(100, f.pageSize ?? 24);
  const page = Math.max(1, f.page ?? 1);
  const rows = await db
    .select({
      id: videoProjects.id,
      title: videoProjects.title,
      status: videoProjects.status,
      language: videoProjects.language,
      renderMode: videoProjects.renderMode,
      durationSec: videoProjects.durationSec,
      aspectRatio: videoProjects.aspectRatio,
      thumbnailAssetId: videoProjects.thumbnailAssetId,
      outputAssetId: videoProjects.outputAssetId,
      subtitleAssetId: videoProjects.subtitleAssetId,
      actualCostUsd: videoProjects.actualCostUsd,
      error: videoProjects.error,
      scriptGenerator: videoProjects.scriptGenerator,
      publishChannel: videoProjects.publishChannel,
      createdAt: videoProjects.createdAt,
      updatedAt: videoProjects.updatedAt,
      productTitle: products.title,
      productOrigin: products.dataOrigin,
      platform: marketplaceOffers.platform,
      templateName: creativeTemplates.name,
    })
    .from(videoProjects)
    .innerJoin(products, eq(products.id, videoProjects.productId))
    .leftJoin(marketplaceOffers, eq(marketplaceOffers.id, videoProjects.offerId))
    .leftJoin(creativeTemplates, eq(creativeTemplates.id, videoProjects.templateId))
    .where(and(...where))
    .orderBy(desc(videoProjects.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ n }] = await db
    .select({ n: count() })
    .from(videoProjects)
    .innerJoin(products, eq(products.id, videoProjects.productId))
    .where(and(...where));
  const statusCounts = await db
    .select({ status: videoProjects.status, n: count() })
    .from(videoProjects)
    .where(eq(videoProjects.workspaceId, workspaceId))
    .groupBy(videoProjects.status);
  const groups: Record<string, number> = {};
  for (const s of statusCounts) {
    const g = VIDEO_STATUS[s.status]?.group ?? "draft";
    groups[g] = (groups[g] ?? 0) + s.n;
  }
  return {
    items: rows.map((r) => ({
      ...r,
      thumbnailUrl: r.thumbnailAssetId ? assetUrl(r.thumbnailAssetId) : null,
      videoUrl: r.outputAssetId ? assetUrl(r.outputAssetId) : null,
      downloadUrl: r.outputAssetId ? assetUrl(r.outputAssetId, true) : null,
    })),
    total: n,
    page,
    pageSize,
    groups,
  };
}

/** Everything the studio editor needs for one project. */
export async function getProjectBundle(db: Db, workspaceId: string, projectId: string) {
  const project = await getProject(db, workspaceId, projectId);
  const [scenes, [product], [offer], [template], [score], recentJobs, assets, estimate] = await Promise.all([
    getScenes(db, projectId),
    db.select().from(products).where(eq(products.id, project.productId)),
    project.offerId ? db.select().from(marketplaceOffers).where(eq(marketplaceOffers.id, project.offerId)) : Promise.resolve([]),
    project.templateId ? db.select().from(creativeTemplates).where(eq(creativeTemplates.id, project.templateId)) : Promise.resolve([]),
    db.select().from(productScores).where(eq(productScores.productId, project.productId)).orderBy(desc(productScores.createdAt)).limit(1),
    db
      .select({
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        progress: jobs.progress,
        progressMessage: jobs.progressMessage,
        lastError: jobs.lastError,
        attempts: jobs.attempts,
        maxAttempts: jobs.maxAttempts,
        result: jobs.result,
        createdAt: jobs.createdAt,
        finishedAt: jobs.finishedAt,
      })
      .from(jobs)
      .where(and(eq(jobs.projectId, projectId), eq(jobs.workspaceId, workspaceId)))
      .orderBy(desc(jobs.createdAt))
      .limit(6),
    db
      .select({ id: mediaAssets.id, kind: mediaAssets.kind, source: mediaAssets.source, provider: mediaAssets.provider, rightsNote: mediaAssets.rightsNote, createdAt: mediaAssets.createdAt, bytes: mediaAssets.bytes })
      .from(mediaAssets)
      .where(eq(mediaAssets.projectId, projectId))
      .orderBy(desc(mediaAssets.createdAt))
      .limit(60),
    estimateProjectCostUsd(db, workspaceId, projectId),
  ]);
  const url = (id: string | null) => (id ? assetUrl(id) : null);
  return {
    project,
    scenes: scenes.map((s) => ({ ...s, imageUrl: url(s.imageAssetId), videoUrl: url(s.videoAssetId) })),
    product: product
      ? { id: product.id, title: product.title, brand: product.brand, imageRights: product.imageRights, dataOrigin: product.dataOrigin, demoEmoji: product.attributes?.demo_emoji ?? null }
      : null,
    offer: offer ? { id: offer.id, platform: offer.platform, price: offer.price, shopName: offer.shopName, productUrl: offer.productUrl, affiliateUrl: offer.affiliateUrl } : null,
    template: template ? { id: template.id, key: template.key, name: template.name, style: template.style, version: template.version, config: template.config } : null,
    score: score ? { score: score.score, confidence: score.confidence, analyzer: score.analyzer, explanation: score.explanation, needsReview: score.needsReview, createdAt: score.createdAt } : null,
    jobs: recentJobs,
    assets: assets.map((a) => ({ ...a, url: assetUrl(a.id) })),
    urls: {
      video: url(project.outputAssetId),
      download: project.outputAssetId ? assetUrl(project.outputAssetId, true) : null,
      thumbnail: url(project.thumbnailAssetId),
      subtitle: project.subtitleAssetId ? assetUrl(project.subtitleAssetId, true) : null,
    },
    estimate,
  };
}

