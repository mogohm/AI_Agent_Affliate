/** Rule-based auto categorisation (deterministic; the AI analyzer can override with higher confidence). */

export type CategoryRule = { id: string; name: string; slug: string; keywords: string[] };

export const DEFAULT_CATEGORIES: { name: string; slug: string; keywords: string[] }[] = [
  {
    name: "อุปกรณ์ครีเอเตอร์",
    slug: "creator-gear",
    keywords: ["ไฟวงแหวน", "ring light", "ไมค์", "microphone", "mic", "ขาตั้ง", "tripod", "เว็บแคม", "webcam", "gimbal", "ไลฟ์สด", "สตูดิโอ"],
  },
  {
    name: "อุปกรณ์อิเล็กทรอนิกส์",
    slug: "electronics",
    keywords: ["หูฟัง", "earbuds", "headphone", "bluetooth", "บลูทูธ", "ลำโพง", "speaker", "powerbank", "พาวเวอร์แบงค์", "สายชาร์จ", "charger", "smartwatch", "นาฬิกาอัจฉริยะ", "เมาส์", "mouse", "คีย์บอร์ด", "keyboard"],
  },
  {
    name: "เครื่องใช้ในบ้าน",
    slug: "home-appliances",
    keywords: ["เครื่องดูดฝุ่น", "vacuum", "เครื่องปั่น", "blender", "หม้อทอด", "air fryer", "พัดลม", "fan", "กาต้มน้ำ", "kettle", "เครื่องฟอกอากาศ", "purifier", "เตารีด"],
  },
  {
    name: "สุขภาพและความงาม",
    slug: "health-beauty",
    keywords: ["ครีม", "cream", "เซรั่ม", "serum", "ลิป", "lipstick", "กันแดด", "sunscreen", "เครื่องชั่ง", "scale", "แปรงสีฟัน", "toothbrush", "วิตามิน", "vitamin", "สกินแคร์", "skincare", "แชมพู", "shampoo"],
  },
  {
    name: "ไลฟ์สไตล์",
    slug: "lifestyle",
    keywords: ["หมอน", "pillow", "กล่อง", "organizer", "จัดระเบียบ", "กระเป๋า", "bag", "ขวดน้ำ", "bottle", "แก้ว", "tumbler", "โคมไฟ", "lamp", "ผ้าห่ม"],
  },
  {
    name: "แฟชั่น",
    slug: "fashion",
    keywords: ["เสื้อ", "shirt", "กางเกง", "pants", "รองเท้า", "shoes", "sneaker", "ชุด", "dress", "หมวก", "แว่น"],
  },
  {
    name: "แม่และเด็ก",
    slug: "mom-baby",
    keywords: ["เด็ก", "baby", "ผ้าอ้อม", "diaper", "ขวดนม", "รถเข็น", "stroller", "ของเล่น", "toy"],
  },
  {
    name: "กีฬาและกิจกรรมกลางแจ้ง",
    slug: "sports-outdoor",
    keywords: ["โยคะ", "yoga", "ดัมเบล", "dumbbell", "ฟิตเนส", "fitness", "จักรยาน", "bike", "แคมป์", "camping", "วิ่ง", "running"],
  },
];

export type CategoryMatch = { categoryId: string; confidence: number; matched: string[] };

export function categorizeByRules(
  text: { title: string; sourceCategory?: string | null; description?: string | null },
  categories: CategoryRule[],
): CategoryMatch | null {
  const hay = `${text.title} ${text.sourceCategory ?? ""} ${text.description ?? ""}`.toLowerCase();
  let best: CategoryMatch | null = null;
  for (const c of categories) {
    const matched = c.keywords.filter((k) => hay.includes(k.toLowerCase()));
    // exact category-name match in the source category is strong evidence
    const nameHit = text.sourceCategory && text.sourceCategory.toLowerCase().includes(c.name.toLowerCase());
    if (!matched.length && !nameHit) continue;
    const titleHits = matched.filter((k) => text.title.toLowerCase().includes(k.toLowerCase())).length;
    const confidence = Math.min(0.95, (nameHit ? 0.6 : 0) + 0.35 + 0.15 * titleHits + 0.05 * (matched.length - titleHits));
    if (!best || confidence > best.confidence) best = { categoryId: c.id, confidence: Math.round(confidence * 100) / 100, matched };
  }
  return best;
}

/** Heuristic content potential for short vertical video (0..1) with a human-readable reason. */
export function ruleContentPotential(p: {
  categorySlug?: string | null;
  price?: number | null;
  hasAuthorizedImage: boolean;
  descriptionLength: number;
  attributeCount: number;
}): { value: number; evidence: string } {
  const visual: Record<string, number> = {
    "creator-gear": 0.85,
    "home-appliances": 0.8,
    "health-beauty": 0.7,
    electronics: 0.7,
    lifestyle: 0.65,
    fashion: 0.7,
    "mom-baby": 0.55,
    "sports-outdoor": 0.65,
  };
  let v = visual[p.categorySlug ?? ""] ?? 0.5;
  const reasons = [`หมวดหมู่ ${p.categorySlug ?? "ไม่ระบุ"} (${Math.round(v * 100)})`];
  if (p.hasAuthorizedImage) {
    v += 0.1;
    reasons.push("มีภาพสินค้าที่ได้รับอนุญาต");
  } else {
    v -= 0.1;
    reasons.push("ไม่มีภาพที่ยืนยันสิทธิ์");
  }
  if (p.descriptionLength + p.attributeCount * 20 > 120) {
    v += 0.05;
    reasons.push("มีรายละเอียดสินค้าเพียงพอสำหรับสคริปต์");
  } else {
    v -= 0.05;
    reasons.push("รายละเอียดสินค้าน้อย");
  }
  if (p.price !== null && p.price !== undefined && p.price >= 150 && p.price <= 3000) {
    v += 0.05;
    reasons.push("ช่วงราคาเหมาะกับการตัดสินใจซื้อเร็ว");
  }
  return { value: Math.max(0, Math.min(1, Math.round(v * 100) / 100)), evidence: `ประเมินด้วยกฎ: ${reasons.join(", ")}` };
}
