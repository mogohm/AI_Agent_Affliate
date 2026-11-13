import { desc, eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { ingestionRuns } from "@/db/schema";
import { parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { importClicks, importOrders } from "@/lib/analytics/importer";

const Body = z.object({
  kind: z.enum(["orders", "clicks"]),
  /** Rows already mapped to canonical field keys by the client mapping preview. */
  rows: z.array(z.record(z.string(), z.string())).min(1).max(20_000),
  fileName: z.string().max(255).optional(),
  mapping: z.record(z.string(), z.string()).optional(),
  defaultPlatform: z.enum(["shopee", "lazada"]).optional(),
  confirmAuthorized: z.literal(true, { message: "ต้องยืนยันว่าได้รับอนุญาตให้ใช้รายงานนี้" }),
});

export const POST = route({ permission: "analytics:import" }, async ({ db, session, req, ip }) => {
  const b = await parseJson(req, Body);
  const meta = { fileName: b.fileName, mapping: b.mapping, defaultPlatform: b.defaultPlatform, userId: session.id };
  const result = b.kind === "orders" ? await importOrders(db, session.workspaceId, b.rows, meta) : await importClicks(db, session.workspaceId, b.rows, meta);
  await audit(db, {
    workspaceId: session.workspaceId,
    userId: session.id,
    action: `analytics.import_${b.kind}`,
    entityType: "ingestion_run",
    entityId: result.runId,
    metadata: { rows: result.totalRows, inserted: result.inserted, updated: result.updated, failed: result.failed, fileName: b.fileName },
    ip,
  });
  return result;
});

export const GET = route({ permission: "analytics:read" }, async ({ db, session }) => {
  const items = await db
    .select()
    .from(ingestionRuns)
    .where(and(eq(ingestionRuns.workspaceId, session.workspaceId), inArray(ingestionRuns.kind, ["orders", "clicks"])))
    .orderBy(desc(ingestionRuns.createdAt))
    .limit(20);
  return { items };
});
