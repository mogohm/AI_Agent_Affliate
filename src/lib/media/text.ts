/**
 * Thai-aware text layout helpers for deterministic SVG rendering.
 * Thai has no spaces between words, so lines are broken on Intl.Segmenter word boundaries and
 * widths are estimated per grapheme cluster (combining vowels/tone marks take no width).
 */
const wordSeg = new Intl.Segmenter("th", { granularity: "word" });
const graphemeSeg = new Intl.Segmenter("th", { granularity: "grapheme" });

/** Approximate rendered width of `text` in px for a sans-serif face at `fontSize`. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const { segment } of graphemeSeg.segment(text)) {
    const c = segment.codePointAt(0) ?? 0;
    if (segment === " ") w += 0.3;
    else if (c >= 0x0e00 && c <= 0x0e7f) w += 0.6; // Thai base consonant/vowel (+ marks in the same cluster)
    else if (/[A-Z0-9฿%]/.test(segment)) w += 0.64;
    else if (/[a-z]/.test(segment)) w += 0.53;
    else if (/[.,:;'!|]/.test(segment)) w += 0.3;
    else w += 0.6;
  }
  return w * fontSize;
}

/** Greedy word wrap; long words are hard-split on grapheme boundaries. Adds "…" when truncated. */
export function wrapText(text: string, maxWidth: number, fontSize: number, maxLines = 3): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words: string[] = [];
  for (const { segment } of wordSeg.segment(clean)) {
    if (estimateTextWidth(segment, fontSize) <= maxWidth) words.push(segment);
    else {
      let chunk = "";
      for (const { segment: g } of graphemeSeg.segment(segment)) {
        if (estimateTextWidth(chunk + g, fontSize) > maxWidth && chunk) {
          words.push(chunk);
          chunk = "";
        }
        chunk += g;
      }
      if (chunk) words.push(chunk);
    }
  }
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line + w;
    if (line && estimateTextWidth(next.trimEnd(), fontSize) > maxWidth) {
      lines.push(line.trim());
      line = w.trimStart();
    } else line = next;
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && estimateTextWidth(last + "…", fontSize) > maxWidth) last = Array.from(graphemeSeg.segment(last)).slice(0, -1).map((s) => s.segment).join("");
    kept[maxLines - 1] = last + "…";
    return kept;
  }
  return lines;
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
