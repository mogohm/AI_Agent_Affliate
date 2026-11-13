/**
 * Import affiliate conversion (orders) and click reports exported from the affiliate dashboards.
 * Rows are validated individually; invalid rows are reported, valid rows are upserted on their
 * natural keys so re-importing the same report updates statuses (pending → approved → paid / reversed).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { affiliateLinks, affiliateOrders, clickStats, dataSources, ingestionRuns, marketplaceOffers, type IngestionError } from "@/db/schema";
import { sha256 } from "@/lib/crypto";
import { bangkokDateString } from "@/lib/time";

export type CommissionStatus = "pending" | "approved" | "paid" | "reversed";

export function normalizeStatus(raw: string | undefined | null): CommissionStatus | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/(cancel|reject|invalid|refund|revers|void|ยกเลิก|คืนเงิน|ไม่อนุมัติ|ไม่สำเร็จ)/.test(s)) return "reversed";
  if (/(unpaid|ยังไม่จ่าย)/.test(s)) return "pending";
  if (/(paid|settled|จ่ายแล้ว|ชำระแล้ว)/.test(s)) return "paid";
  if (/(approv|validat|confirm|complete|อนุมัติ|สำเร็จ|ยืนยัน)/.test(s)) return "approved";
  if (/(pend|process|unpaid|รอ|ดำเนินการ)/.test(s)) return "pending";
  return null;
}

export function normalizePlatform(raw: string | undefined | null, fallback?: "shopee" | "lazada"): "shopee" | "lazada" | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (s.includes("shopee") || s.includes("ช้อปปี้")) return "shopee";
  if (s.includes("lazada") || s.includes("ลาซาด้า")) return "lazada";
  return s ? null : (fallback ?? null);
}

/** Accepts ISO dates/datetimes, YYYY/MM/DD, and Thai-style DD/MM/YYYY (Buddhist years > 2400 converted). Local times are Asia/Bangkok. */
export function parseReportDate(raw: string | undefined | null): Date | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", se = "0", tz] = m;
    const year = Number(y) > 2400 ? Number(y) - 543 : Number(y);
    if (tz) return new Date(`${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}:${se.padStart(2, "0")}${tz === "Z" ? "Z" : tz}`);
    return new Date(Date.UTC(year, Number(mo) - 1, Number(d), Number(h) - 7, Number(mi), Number(se)));
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, d, mo, y, h = "0", mi = "0", se = "0"] = m;
    const year = Number(y) > 2400 ? Number(y) - 543 : Number(y);
    return new Date(Date.UTC(year, Number(mo) - 1, Number(d), Number(h) - 7, Number(mi), Number(se)));
  }
  return null;
}

export function parseAmount(raw: string | undefined | null): number | null {
  const s = (raw ?? "").replace(/[฿,\s]|THB|บาท/gi, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const OrderRow = z.object({
  orderRef: z.string().min(1, "ไม่มี Order ID").max(120),
  itemRef: z.string().max(120).default(""),
  platform: z.enum(["shopee", "lazada"], { message: "ไม่ทราบ Platform (shopee/lazada)" }),
  subId: z.string().max(200).nullable(),
  productRef: z.string().max(120).nullable(),
  orderValue: z.number().min(0).max(100_000_000),
  commission: z.number().min(-10_000_000).max(10_000_000),
  status: z.enum(["pending", "approved", "paid", "reversed"], { message: "สถานะไม่รู้จัก" }),
  orderedAt: z.date({ message: "วันที่ไม่ถูกต้อง" }),
});

const ClickRow = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่ไม่ถูกต้อง"),
  platform: z.enum(["shopee", "lazada"], { message: "ไม่ทราบ Platform (shopee/lazada)" }),
  subId: z.string().max(200),
  clicks: z.number().int().min(0).max(100_000_000),
});

export type ImportMeta = { fileName?: string | null; mapping?: Record<string, string>; defaultPlatform?: "shopee" | "lazada"; userId?: string | null };

export type ImportResult = {
  runId: string;
  totalRows: number;
  inserted: number;
  updated: number;
  failed: number;
  errors: IngestionError[];
  status: "completed" | "completed_with_errors" | "failed";
};

async function startRun(db: Db, workspaceId: string, kind: "orders" | "clicks", rows: unknown[], meta: ImportMeta) {
  const [src] = await db
    .insert(dataSources)
    .values({ workspaceId, name: `${kind === "orders" ? "Conversion report" : "Click report"} CSV${meta.fileName ? `: ${meta.fileName}` : ""}`, type: "csv", platform: meta.defaultPlatform ?? null, permissionStatus: "authorized", createdBy: meta.userId ?? null })
    .returning();
  const [run] = await db
    .insert(ingestionRuns)
    .values({
      workspaceId,
      dataSourceId: src.id,
      kind,
      status: "running",
      fileName: meta.fileName ?? null,
      checksum: sha256(JSON.stringify(rows)),
      totalRows: rows.length,
      mapping: meta.mapping ?? null,
      createdBy: meta.userId ?? null,
      startedAt: new Date(),
    })
    .returning();
  return run;
}

async function finishRun(db: Db, runId: string, r: Omit<ImportResult, "runId" | "status">): Promise<ImportResult> {
  const status: ImportResult["status"] = r.failed === 0 ? "completed" : r.inserted + r.updated > 0 ? "completed_with_errors" : "failed";
  await db
    .update(ingestionRuns)
    .set({ status, inserted: r.inserted, updated: r.updated, failed: r.failed, errors: r.errors.slice(0, 500), finishedAt: new Date() })
    .where(eq(ingestionRuns.id, runId));
  return { ...r, runId, status };
}

export async function importOrders(db: Db, workspaceId: string, raw: Record<string, string>[], meta: ImportMeta = {}): Promise<ImportResult> {
  const run = await startRun(db, workspaceId, "orders", raw, meta);
  const errors: IngestionError[] = [];
  const valid: z.infer<typeof OrderRow>[] = [];
  raw.forEach((r, i) => {
    const parsed = OrderRow.safeParse({
      orderRef: r.orderRef?.trim() ?? "",
      itemRef: r.itemRef?.trim() ?? "",
      platform: normalizePlatform(r.platform, meta.defaultPlatform) ?? undefined,
      subId: r.subId?.trim() || null,
      productRef: r.productRef?.trim() || null,
      orderValue: parseAmount(r.orderValue) ?? 0,
      commission: parseAmount(r.commission) ?? undefined,
      status: normalizeStatus(r.status) ?? undefined,
      orderedAt: parseReportDate(r.orderedAt) ?? undefined,
    });
    if (parsed.success) valid.push(parsed.data);
    else errors.push({ row: i + 2, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
  });

  // resolve product / content attribution
  const refs = [...new Set(valid.map((v) => v.productRef).filter((x): x is string => !!x))];
  const offers = refs.length
    ? await db
        .select({ platform: marketplaceOffers.platform, ext: marketplaceOffers.externalProductId, productId: marketplaceOffers.productId })
        .from(marketplaceOffers)
        .where(and(eq(marketplaceOffers.workspaceId, workspaceId), inArray(marketplaceOffers.externalProductId, refs)))
    : [];
  const subs = [...new Set(valid.map((v) => v.subId).filter((x): x is string => !!x))];
  const links = subs.length
    ? await db
        .select({ subId: affiliateLinks.subId, projectId: affiliateLinks.videoProjectId })
        .from(affiliateLinks)
        .where(and(eq(affiliateLinks.workspaceId, workspaceId), inArray(affiliateLinks.subId, subs)))
    : [];

  let inserted = 0;
  let updated = 0;
  for (const v of valid) {
    const productId = offers.find((o) => o.platform === v.platform && o.ext === v.productRef)?.productId ?? null;
    const videoProjectId = links.find((l) => l.subId === v.subId)?.projectId ?? null;
    const res = await db
      .insert(affiliateOrders)
      .values({ workspaceId, ...v, productId, videoProjectId, dataOrigin: "csv", ingestionRunId: run.id })
      .onConflictDoUpdate({
        target: [affiliateOrders.workspaceId, affiliateOrders.platform, affiliateOrders.orderRef, affiliateOrders.itemRef],
        set: {
          status: v.status,
          commission: v.commission,
          orderValue: v.orderValue,
          subId: v.subId,
          productRef: v.productRef,
          productId,
          videoProjectId,
          dataOrigin: "csv",
          ingestionRunId: run.id,
          updatedAt: new Date(),
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (res[0]?.inserted) inserted++;
    else updated++;
  }
  return finishRun(db, run.id, { totalRows: raw.length, inserted, updated, failed: errors.length, errors });
}

export async function importClicks(db: Db, workspaceId: string, raw: Record<string, string>[], meta: ImportMeta = {}): Promise<ImportResult> {
  const run = await startRun(db, workspaceId, "clicks", raw, meta);
  const errors: IngestionError[] = [];
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const d = parseReportDate(r.date);
    const parsed = ClickRow.safeParse({
      date: d ? bangkokDateString(d) : "",
      platform: normalizePlatform(r.platform, meta.defaultPlatform) ?? undefined,
      subId: r.subId?.trim() ?? "",
      clicks: parseAmount(r.clicks) ?? undefined,
    });
    if (!parsed.success) {
      errors.push({ row: i + 2, message: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
      continue;
    }
    const v = parsed.data;
    const res = await db
      .insert(clickStats)
      .values({ workspaceId, ...v, dataOrigin: "csv" })
      .onConflictDoUpdate({ target: [clickStats.workspaceId, clickStats.platform, clickStats.subId, clickStats.date], set: { clicks: v.clicks, dataOrigin: "csv" } })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    if (res[0]?.inserted) inserted++;
    else updated++;
  }
  return finishRun(db, run.id, { totalRows: raw.length, inserted, updated, failed: errors.length, errors });
}
