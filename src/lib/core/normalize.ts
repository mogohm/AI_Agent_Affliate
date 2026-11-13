/** Text normalisation and duplicate detection helpers (pure). */

/** Lower-case, strip punctuation/emoji/marketing noise, collapse spaces. Thai characters are preserved. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFC")
    .toLowerCase()
    .replace(/【.*?】|\[.*?\]|\(.*?\)/g, " ")
    .replace(/(ส่งฟรี|พร้อมส่ง|ของแท้|ราคาถูก|ลดราคา|โปรโมชั่น|flash\s*sale|hot|new|ใหม่ล่าสุด|แท้100%|100%)/gi, " ")
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeGtin(gtin: string | null | undefined): string | null {
  if (!gtin) return null;
  const digits = gtin.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 14) return null;
  return digits.padStart(14, "0");
}

export function normalizeModel(model: string | null | undefined): string | null {
  if (!model) return null;
  const m = model.toLowerCase().replace(/[^a-z0-9]/g, "");
  return m.length >= 3 ? m : null;
}

/** Token-set Jaccard similarity of two normalised titles, using Intl.Segmenter for Thai word breaks. */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("th", { granularity: "word" }) : null;

export function tokens(s: string): Set<string> {
  const norm = normalizeTitle(s);
  const out = new Set<string>();
  if (segmenter) {
    for (const seg of segmenter.segment(norm)) if (seg.isWordLike && seg.segment.trim().length > 1) out.add(seg.segment.trim());
  } else {
    for (const w of norm.split(" ")) if (w.length > 1) out.add(w);
  }
  return out;
}

export type DuplicateCandidate = {
  id: string;
  title: string;
  brand?: string | null;
  model?: string | null;
  gtin?: string | null;
};

export type DuplicateMatch = { id: string; reason: "gtin" | "brand_model" | "title"; similarity: number };

/**
 * Find a likely duplicate of `item` among `existing`. Strong identity (GTIN, brand+model) wins;
 * title similarity alone only flags a *possible* duplicate (threshold 0.8) for human confirmation.
 */
export function findDuplicate(item: DuplicateCandidate, existing: DuplicateCandidate[]): DuplicateMatch | null {
  const g = normalizeGtin(item.gtin);
  if (g) {
    const hit = existing.find((e) => normalizeGtin(e.gtin) === g);
    if (hit) return { id: hit.id, reason: "gtin", similarity: 1 };
  }
  const brand = item.brand?.trim().toLowerCase();
  const model = normalizeModel(item.model);
  if (brand && model) {
    const hit = existing.find((e) => e.brand?.trim().toLowerCase() === brand && normalizeModel(e.model) === model);
    if (hit) return { id: hit.id, reason: "brand_model", similarity: 1 };
  }
  let best: DuplicateMatch | null = null;
  for (const e of existing) {
    const s = titleSimilarity(item.title, e.title);
    if (s >= 0.8 && (!best || s > best.similarity)) best = { id: e.id, reason: "title", similarity: Math.round(s * 100) / 100 };
  }
  return best;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}
