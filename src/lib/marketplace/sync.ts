import { and, eq } from "drizzle-orm";
import { dataSources, ingestionRuns, marketplaceConnections } from "@/db/schema";
import { loadCatalogCache, upsertProductOffer } from "@/lib/catalog/service";
import { rescoreProduct } from "@/lib/catalog/scoring-service";
import { PermanentJobError, type JobHandler } from "@/lib/jobs/types";
import { getConnection, getMarketplaceProvider, readCredentials } from "./index";
import { errorToStatus } from "./shopee";

/**
 * Sync offers from an authorised marketplace API into the catalogue (data_origin = 'api').
 * Payload: { platform, keyword?, maxPages? }. Only runs for connections in status `connected`.
 */
export const handleMarketplaceSyncJob: JobHandler = async (ctx) => {
  const { db, job } = ctx;
  const p = job.payload as { platform?: "shopee" | "lazada"; keyword?: string; maxPages?: number };
  if (p.platform !== "shopee" && p.platform !== "lazada") throw new PermanentJobError("invalid platform");
  const conn = await getConnection(db, job.workspaceId, p.platform);
  if (conn.status !== "connected") throw new PermanentJobError(`การเชื่อมต่อ ${p.platform} ยังไม่พร้อม (สถานะ ${conn.status})`);
  const provider = getMarketplaceProvider(p.platform);
  const creds = readCredentials(conn.encryptedCredentials);

  let [src] = await db.select().from(dataSources).where(and(eq(dataSources.workspaceId, job.workspaceId), eq(dataSources.name, `${provider.displayName} (API)`))).limit(1);
  if (!src) {
    [src] = await db
      .insert(dataSources)
      .values({ workspaceId: job.workspaceId, name: `${provider.displayName} (API)`, type: "api", platform: p.platform, permissionStatus: "authorized", licenseNote: "Official API with workspace credentials" })
      .returning();
  }
  const [run] = await db
    .insert(ingestionRuns)
    .values({ workspaceId: job.workspaceId, dataSourceId: src.id, kind: "products", status: "running", fileName: `api:${p.platform}`, startedAt: new Date(), createdBy: job.createdBy })
    .returning();

  const cache = await loadCatalogCache(db, job.workspaceId);
  const maxPages = Math.min(20, p.maxPages ?? 3);
  let cursor: string | null = null;
  let inserted = 0,
    updated = 0,
    total = 0;
  const touched = new Set<string>();
  try {
    for (let page = 0; page < maxPages; page++) {
      const res = await provider.fetchOffers(creds, { keyword: p.keyword, cursor, limit: 50 });
      for (const item of res.items) {
        total++;
        const out = await upsertProductOffer(db, job.workspaceId, item, "api", { dataSourceId: src.id, cache });
        if (out.status === "inserted") inserted++;
        else updated++;
        touched.add(out.productId);
      }
      await ctx.progress(((page + 1) / maxPages) * 90, `ดึงหน้า ${page + 1}`);
      cursor = res.nextCursor;
      if (!cursor || (await ctx.isCanceled())) break;
    }
  } catch (e) {
    const st = errorToStatus(e);
    await db
      .update(marketplaceConnections)
      .set({ status: st.status, lastError: st.message, rateLimitResetAt: st.rateLimitResetAt ?? null, updatedAt: new Date() })
      .where(eq(marketplaceConnections.id, conn.id));
    await db.update(ingestionRuns).set({ status: "failed", totalRows: total, inserted, updated, errors: [{ row: 0, message: st.message }], finishedAt: new Date() }).where(eq(ingestionRuns.id, run.id));
    throw e;
  }
  for (const id of touched) await rescoreProduct(db, job.workspaceId, id).catch(() => undefined);
  await db.update(ingestionRuns).set({ status: "completed", totalRows: total, inserted, updated, finishedAt: new Date() }).where(eq(ingestionRuns.id, run.id));
  await db.update(marketplaceConnections).set({ lastSyncAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(marketplaceConnections.id, conn.id));
  return { total, inserted, updated };
};
