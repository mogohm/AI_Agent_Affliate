import Papa from "papaparse";
import { z } from "zod";
import { badRequest, parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { autoMapColumns, IMPORT_FIELDS, MAX_IMPORT_ROWS, missingRequiredFields } from "@/lib/catalog/csv";
import { importProducts } from "@/lib/catalog/importer";

const fieldKeys = ["", ...IMPORT_FIELDS.map((f) => f.key)] as [string, ...string[]];
const Body = z
  .object({
    rows: z.array(z.record(z.string(), z.unknown())).max(MAX_IMPORT_ROWS, `นำเข้าได้สูงสุด ${MAX_IMPORT_ROWS} แถวต่อครั้ง — แบ่งไฟล์แล้วนำเข้าทีละส่วน`).optional(),
    csvText: z.string().max(20_000_000).optional(),
    mapping: z.record(z.string(), z.enum(fieldKeys)).optional(),
    fileName: z.string().max(300).optional().nullable(),
    origin: z.enum(["csv", "feed"]).default("csv"),
    defaultPlatform: z.enum(["shopee", "lazada"]).optional(),
    commissionIsEstimated: z.boolean().default(false),
    imageRightsAuthorized: z.boolean().default(false),
    sourceName: z.string().max(200).optional().nullable(),
    authorizationConfirmed: z.literal(true, { message: "ต้องยืนยันว่าได้รับอนุญาตให้ใช้ข้อมูลนี้" }),
  })
  .refine((b) => b.rows || b.csvText, "ต้องส่ง rows หรือ csvText");

/** Import products from parsed CSV rows (client preview) or raw CSV text. */
export const POST = route({ permission: "products:write" }, async ({ req, db, session, ip }) => {
  const body = await parseJson(req, Body);
  let rows = body.rows;
  if (!rows) {
    const parsed = Papa.parse<Record<string, unknown>>(body.csvText!, { header: true, skipEmptyLines: "greedy" });
    rows = parsed.data;
  }
  if (!rows.length) throw badRequest("ไฟล์ไม่มีข้อมูล");
  if (rows.length > MAX_IMPORT_ROWS) throw badRequest(`นำเข้าได้สูงสุด ${MAX_IMPORT_ROWS} แถวต่อครั้ง (ไฟล์มี ${rows.length} แถว)`);
  const mapping = (body.mapping ?? autoMapColumns(Object.keys(rows[0]))) as Parameters<typeof importProducts>[2]["mapping"];
  const missing = missingRequiredFields(mapping);
  if (missing.length) throw badRequest(`ยังไม่ได้ map คอลัมน์ที่จำเป็น: ${missing.join(", ")}`, { missing });
  const summary = await importProducts(db, session.workspaceId, { ...body, rows, mapping }, session.id);
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "ingestion.import", entityType: "ingestion_run", entityId: summary.runId, metadata: { rows: rows.length, failed: summary.failed, origin: body.origin }, ip });
  return summary;
});
