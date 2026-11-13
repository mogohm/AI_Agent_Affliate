/** Client-safe field definitions + header auto-mapping for affiliate report imports. */
export type ImportField = { key: string; label: string; required: boolean; aliases: string[] };

export const ORDER_FIELDS: ImportField[] = [
  { key: "orderRef", label: "Order ID", required: true, aliases: ["order id", "order_id", "orderid", "เลขที่คำสั่งซื้อ", "รหัสคำสั่งซื้อ", "order sn", "checkout id"] },
  { key: "itemRef", label: "Item ID", required: false, aliases: ["item id", "item_id", "order item id", "รหัสรายการ", "sku id"] },
  { key: "platform", label: "Platform", required: false, aliases: ["platform", "marketplace", "แพลตฟอร์ม", "channel"] },
  { key: "subId", label: "Sub ID", required: false, aliases: ["sub id", "sub_id", "subid", "sub_id1", "tracking id", "aff_sub"] },
  { key: "productRef", label: "Product ID", required: false, aliases: ["product id", "product_id", "item id (product)", "รหัสสินค้า", "product sku"] },
  { key: "orderValue", label: "Order value (THB)", required: false, aliases: ["order value", "order_value", "purchase value", "ยอดสั่งซื้อ", "มูลค่าคำสั่งซื้อ", "gmv", "amount"] },
  { key: "commission", label: "Commission (THB)", required: true, aliases: ["commission", "estimated commission", "ค่าคอมมิชชั่น", "ค่าคอมมิชชัน", "net commission", "payout"] },
  { key: "status", label: "Status", required: true, aliases: ["status", "order status", "commission status", "สถานะ", "สถานะคำสั่งซื้อ"] },
  { key: "orderedAt", label: "Order date", required: true, aliases: ["order date", "purchase time", "order time", "date", "วันที่สั่งซื้อ", "เวลาสั่งซื้อ", "created at"] },
];

export const CLICK_FIELDS: ImportField[] = [
  { key: "date", label: "Date", required: true, aliases: ["date", "click date", "วันที่", "day"] },
  { key: "platform", label: "Platform", required: false, aliases: ["platform", "marketplace", "แพลตฟอร์ม"] },
  { key: "subId", label: "Sub ID", required: false, aliases: ["sub id", "sub_id", "subid", "tracking id"] },
  { key: "clicks", label: "Clicks", required: true, aliases: ["clicks", "click", "คลิก", "จำนวนคลิก", "total clicks"] },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, " ");

/** Guess column → field mapping from CSV headers. Returns { fieldKey: header }. */
export function autoMapHeaders(headers: string[], fields: ImportField[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const f of fields) {
    const candidates = [f.key, f.label, ...f.aliases].map(norm);
    const hit = headers.find((h) => !used.has(h) && candidates.includes(norm(h)));
    if (hit) {
      out[f.key] = hit;
      used.add(hit);
    }
  }
  return out;
}

/** Apply a mapping to raw CSV rows → canonical rows (strings). */
export function applyMapping(rows: Record<string, string>[], mapping: Record<string, string>): Record<string, string>[] {
  return rows.map((r) => {
    const o: Record<string, string> = {};
    for (const [field, header] of Object.entries(mapping)) if (header) o[field] = (r[header] ?? "").toString().trim();
    return o;
  });
}
