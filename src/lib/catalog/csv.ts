/**
 * CSV / product-feed import: column auto-mapping and row validation (pure, client+server safe).
 * The server re-validates every row with these same schemas.
 */
import { z } from "zod";
import type { ProductInput } from "./service";

export const IMPORT_FIELDS = [
  { key: "platform", label: "แพลตฟอร์ม (shopee/lazada)", required: false },
  { key: "externalProductId", label: "รหัสสินค้า (Item ID)", required: true },
  { key: "title", label: "ชื่อสินค้า", required: true },
  { key: "price", label: "ราคา (บาท)", required: true },
  { key: "commissionRate", label: "ค่าคอม %", required: false },
  { key: "capAmount", label: "เพดานค่าคอม (บาท)", required: false },
  { key: "shopId", label: "รหัสร้าน", required: false },
  { key: "shopName", label: "ชื่อร้าน", required: false },
  { key: "variantId", label: "รหัสตัวเลือก (Variant)", required: false },
  { key: "brand", label: "แบรนด์", required: false },
  { key: "model", label: "รุ่น", required: false },
  { key: "gtin", label: "GTIN / Barcode", required: false },
  { key: "sourceCategory", label: "หมวดหมู่ต้นทาง", required: false },
  { key: "description", label: "รายละเอียด", required: false },
  { key: "originalPrice", label: "ราคาก่อนลด", required: false },
  { key: "rating", label: "คะแนนรีวิว (0-5)", required: false },
  { key: "ratingCount", label: "จำนวนรีวิว", required: false },
  { key: "soldCount", label: "ยอดขาย (ชิ้น)", required: false },
  { key: "trendScore", label: "ดัชนีเทรนด์ (0-100)", required: false },
  { key: "productUrl", label: "ลิงก์สินค้า", required: false },
  { key: "affiliateUrl", label: "ลิงก์ Affiliate (Offer link)", required: false },
  { key: "imageUrl", label: "ลิงก์รูปภาพ", required: false },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
/** column header → field key ("" = ignore) */
export type ColumnMapping = Record<string, ImportField | "">;

const SYNONYMS: Record<ImportField, string[]> = {
  platform: ["platform", "marketplace", "แพลตฟอร์ม", "ช่องทาง"],
  externalProductId: ["item id", "itemid", "item_id", "product id", "product_id", "productid", "sku", "รหัสสินค้า", "id สินค้า", "external id", "external_product_id"],
  title: ["product name", "item name", "name", "title", "ชื่อสินค้า", "สินค้า", "product_name", "item_name"],
  price: ["price", "sale price", "current price", "ราคา", "ราคาขาย", "price (thb)", "price_thb"],
  commissionRate: ["commission rate", "commission", "commission %", "comm rate", "ค่าคอม", "ค่าคอม %", "อัตราค่าคอม", "commission_rate", "rate"],
  capAmount: ["commission cap", "cap", "max commission", "เพดานค่าคอม", "cap_amount"],
  shopId: ["shop id", "shopid", "shop_id", "seller id", "รหัสร้าน"],
  shopName: ["shop name", "shop", "seller", "seller name", "store", "ชื่อร้าน", "ร้านค้า", "shop_name"],
  variantId: ["variant id", "model id", "variant_id", "รหัสตัวเลือก"],
  brand: ["brand", "แบรนด์", "ยี่ห้อ"],
  model: ["model", "รุ่น", "model name"],
  gtin: ["gtin", "barcode", "ean", "upc", "บาร์โค้ด"],
  sourceCategory: ["category", "category name", "หมวดหมู่", "global category", "global_category1", "category_name"],
  description: ["description", "รายละเอียด", "รายละเอียดสินค้า", "item description"],
  originalPrice: ["original price", "price before discount", "ราคาเดิม", "ราคาก่อนลด", "original_price"],
  rating: ["rating", "item rating", "rating star", "คะแนน", "คะแนนรีวิว"],
  ratingCount: ["rating count", "reviews", "review count", "จำนวนรีวิว", "rating_count"],
  soldCount: ["sales", "sold", "historical sold", "item sold", "ยอดขาย", "ขายแล้ว", "sold_count"],
  trendScore: ["trend", "trend score", "เทรนด์", "trend_score"],
  productUrl: ["product link", "product url", "item link", "url", "ลิงก์สินค้า", "product_link"],
  affiliateUrl: ["offer link", "affiliate link", "affiliate url", "short link", "ลิงก์ affiliate", "ลิงก์แอฟฟิลิเอต", "offer_link"],
  imageUrl: ["image link", "image url", "image", "รูปภาพ", "ลิงก์รูป", "image_link", "image_url"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_\-]+/g, " ").replace(/[()]/g, "").trim();

/** Auto-detect a mapping from CSV headers. Exact synonym match first, then "contains". */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<ImportField>();
  const fields = Object.keys(SYNONYMS) as ImportField[];
  for (const h of headers) {
    const n = norm(h);
    const f = fields.find((k) => !used.has(k) && SYNONYMS[k].some((s) => norm(s) === n));
    mapping[h] = f ?? "";
    if (f) used.add(f);
  }
  for (const h of headers) {
    if (mapping[h]) continue;
    const n = norm(h);
    const f = fields.find((k) => !used.has(k) && SYNONYMS[k].some((s) => norm(s).length > 3 && n.includes(norm(s))));
    if (f) {
      mapping[h] = f;
      used.add(f);
    }
  }
  return mapping;
}

const numberLike = (v: unknown) => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(/[฿,\s%]|THB|บาท/gi, "").trim();
  if (s === "") return undefined;
  const k = /^([\d.]+)k$/i.exec(s);
  if (k) return Number(k[1]) * 1000;
  return Number(s);
};
const optNum = (min: number, max: number) =>
  z.preprocess(numberLike, z.number({ message: "ต้องเป็นตัวเลข" }).min(min, `ต่ำสุด ${min}`).max(max, `สูงสุด ${max}`).optional());
const optStr = (max = 2000) =>
  z.preprocess((v) => (v === null || v === undefined || String(v).trim() === "" ? undefined : String(v).trim()), z.string().max(max).optional());
const optUrl = z.preprocess(
  (v) => (v === null || v === undefined || String(v).trim() === "" ? undefined : String(v).trim()),
  z.string().url("URL ไม่ถูกต้อง").refine((u) => /^https?:\/\//i.test(u), "ต้องเป็น http(s)").optional(),
);

export const ImportRowSchema = z.object({
  platform: z.preprocess((v) => (v === undefined || v === null || String(v).trim() === "" ? undefined : String(v).trim().toLowerCase()), z.enum(["shopee", "lazada"], { message: "platform ต้องเป็น shopee หรือ lazada" }).optional()),
  externalProductId: z.preprocess((v) => (v === undefined || v === null ? "" : String(v).trim()), z.string().min(1, "ต้องมีรหัสสินค้า").max(200)),
  title: z.preprocess((v) => (v === undefined || v === null ? "" : String(v).trim()), z.string().min(2, "ต้องมีชื่อสินค้า").max(500)),
  price: z.preprocess(numberLike, z.number({ message: "ราคาต้องเป็นตัวเลข" }).min(0, "ราคาต้องไม่ติดลบ").max(10_000_000)),
  commissionRate: optNum(0, 100),
  capAmount: optNum(0, 10_000_000),
  shopId: optStr(200),
  shopName: optStr(300),
  variantId: optStr(200),
  brand: optStr(200),
  model: optStr(200),
  gtin: optStr(50),
  sourceCategory: optStr(300),
  description: optStr(5000),
  originalPrice: optNum(0, 10_000_000),
  rating: optNum(0, 5),
  ratingCount: optNum(0, 1e10),
  soldCount: optNum(0, 1e10),
  trendScore: optNum(0, 100),
  productUrl: optUrl,
  affiliateUrl: optUrl,
  imageUrl: optUrl,
});
export type ImportRow = z.infer<typeof ImportRowSchema>;

export type RowResult = { ok: true; value: ProductInput } | { ok: false; error: string };

export type RowOptions = {
  defaultPlatform?: "shopee" | "lazada";
  /** Rates in an authorised file are official for that account; flag as estimated only when declared. */
  commissionIsEstimated?: boolean;
  imageRights?: "authorized" | "unknown";
  sourceLabel?: string;
};

/** Apply mapping to a raw CSV record, validate, and convert to a ProductInput. */
export function mapAndValidateRow(raw: Record<string, unknown>, mapping: ColumnMapping, opts: RowOptions = {}): RowResult {
  const obj: Record<string, unknown> = {};
  for (const [col, field] of Object.entries(mapping)) if (field) obj[field] = raw[col];
  const r = ImportRowSchema.safeParse(obj);
  if (!r.success) {
    return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`).join("; ") };
  }
  const v = r.data;
  const platform = v.platform ?? opts.defaultPlatform;
  if (!platform) return { ok: false, error: "platform: ไม่ระบุแพลตฟอร์ม (เลือกค่าเริ่มต้นหรือ map คอลัมน์)" };
  return {
    ok: true,
    value: {
      platform,
      externalProductId: v.externalProductId,
      title: v.title,
      price: v.price,
      commissionRate: v.commissionRate ?? null,
      capAmount: v.capAmount ?? null,
      shopId: v.shopId ?? "",
      shopName: v.shopName ?? null,
      variantId: v.variantId ?? "",
      brand: v.brand ?? null,
      model: v.model ?? null,
      gtin: v.gtin ?? null,
      sourceCategory: v.sourceCategory ?? null,
      description: v.description ?? null,
      originalPrice: v.originalPrice ?? null,
      rating: v.rating ?? null,
      ratingCount: v.ratingCount !== undefined ? Math.round(v.ratingCount) : null,
      soldCount: v.soldCount !== undefined ? Math.round(v.soldCount) : null,
      trendScore: v.trendScore ?? null,
      productUrl: v.productUrl ?? null,
      affiliateUrl: v.affiliateUrl ?? null,
      imageUrl: v.imageUrl ?? null,
      imageRights: v.imageUrl ? (opts.imageRights ?? "unknown") : "unknown",
      commissionIsEstimated: !!opts.commissionIsEstimated,
      commissionSource: opts.sourceLabel ?? null,
    },
  };
}

export function missingRequiredFields(mapping: ColumnMapping): ImportField[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  return IMPORT_FIELDS.filter((f) => f.required && !mapped.has(f.key)).map((f) => f.key);
}

export const MAX_IMPORT_ROWS = 5000;
