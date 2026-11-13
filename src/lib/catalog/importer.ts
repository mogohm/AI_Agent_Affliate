import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { dataSources, ingestionRuns, type IngestionError } from "@/db/schema";
import { sha256 } from "@/lib/crypto";
import { mapAndValidateRow, MAX_IMPORT_ROWS, type ColumnMapping } from "./csv";
import { loadCatalogCache, upsertProductOffer } from "./service";
import { rescoreProduct } from "./scoring-service";

export type ImportRequest = {
  rows: Record<string, unknown>[];
  mapping: ColumnMapping;
  fileName?: string | null;
  origin: "csv" | "feed";
  defaultPlatform?: "shopee" | "lazada";
  commissionIsEstimated?: boolean;
  imageRightsAuthorized?: boolean;
  sourceName?: string | null;
  licenseNote?: string | null;
};

export type ImportSummary = {
  runId: string;
  status: "completed" | "completed_with_errors" | "failed";
  totalRows: number;
  inserted: number;
  updated: number;
  merged: number;
  possibleDuplicates: number;
  failed: number;
  errors: IngestionError[];
};

/** Validate + upsert rows into the catalogue, recording a data source and an ingestion run. */
export async function importProducts(db: Db, workspaceId: string, req: ImportRequest, userId: string | null): Promise<ImportSummary> {
  if (req.rows.length > MAX_IMPORT_ROWS) throw new Error(`ไฟล์มี ${req.rows.length} แถว เกินขีดจำกัด ${MAX_IMPORT_ROWS} แถวต่อครั้ง`);
  const [src] = await db
    .insert(dataSources)
    .values({
      workspaceId,
      name: req.sourceName?.trim() || `${req.origin.toUpperCase()} import${req.fileName ? `: ${req.fileName}` : ""}`,
      type: req.origin,
      platform: req.defaultPlatform ?? null,
      permissionStatus: "authorized",
      licenseNote: req.licenseNote ?? "ผู้ใช้ยืนยันสิทธิ์การใช้ข้อมูลตอนนำเข้า",
      createdBy: userId,
    })
    .returning();
  const [run] = await db
    .insert(ingestionRuns)
    .values({
      workspaceId,
      dataSourceId: src.id,
      kind: "products",
      status: "running",
      fileName: req.fileName ?? null,
      checksum: sha256(JSON.stringify(req.rows)),
      totalRows: req.rows.length,
      mapping: Object.fromEntries(Object.entries(req.mapping).filter(([, v]) => v)) as Record<string, string>,
      createdBy: userId,
      startedAt: new Date(),
    })
    .returning();

  const cache = await loadCatalogCache(db, workspaceId);
  const errors: IngestionError[] = [];
  let inserted = 0,
    updated = 0,
    merged = 0,
    possibleDuplicates = 0;
  const touched = new Set<string>();
  const seen = new Set<string>();
  const label = `${req.origin.toUpperCase()}${req.fileName ? ` ${req.fileName}` : ""}`;

  for (let i = 0; i < req.rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    const r = mapAndValidateRow(req.rows[i], req.mapping, {
      defaultPlatform: req.defaultPlatform,
      commissionIsEstimated: req.commissionIsEstimated,
      imageRights: req.imageRightsAuthorized ? "authorized" : "unknown",
      sourceLabel: label,
    });
    if (!r.ok) {
      errors.push({ row: rowNo, message: r.error });
      continue;
    }
    const identity = `${r.value.platform}|${r.value.shopId}|${r.value.externalProductId}|${r.value.variantId}`;
    if (seen.has(identity)) {
      errors.push({ row: rowNo, message: "แถวซ้ำในไฟล์ (สินค้า/ร้าน/ตัวเลือกเดียวกัน) — ข้าม" });
      continue;
    }
    seen.add(identity);
    try {
      const out = await upsertProductOffer(db, workspaceId, r.value, req.origin, { dataSourceId: src.id, cache });
      if (out.status === "inserted") inserted++;
      else if (out.status === "updated") updated++;
      else merged++;
      if (out.possibleDuplicateOf) possibleDuplicates++;
      touched.add(out.productId);
    } catch (e) {
      errors.push({ row: rowNo, message: e instanceof Error ? e.message : String(e) });
    }
  }

  for (const id of touched) {
    try {
      await rescoreProduct(db, workspaceId, id);
    } catch {
      /* scoring failure must not fail the import */
    }
  }

  const failed = errors.length;
  const status = failed === 0 ? "completed" : failed === req.rows.length ? "failed" : "completed_with_errors";
  await db
    .update(ingestionRuns)
    .set({ status, inserted, updated: updated + merged, duplicates: possibleDuplicates, failed, errors: errors.slice(0, 500), finishedAt: new Date() })
    .where(eq(ingestionRuns.id, run.id));
  return { runId: run.id, status, totalRows: req.rows.length, inserted, updated, merged, possibleDuplicates, failed, errors: errors.slice(0, 500) };
}
