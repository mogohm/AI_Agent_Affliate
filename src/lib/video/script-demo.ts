/**
 * Demo script generator — deterministic, template-based, no AI and no cost.
 * Uses ONLY values present in the product facts snapshot; every factual sentence is recorded
 * as a claim with its source field. Labelled "Demo generator" in the UI.
 */
import type { ProductFacts, VideoScript } from "@/db/schema";
import { allocateDurations, VISUAL_STYLES, type SceneDraft, type ScriptDraft, type ScriptRequest, type ShotType } from "./script-types";

type Claim = { text: string; sourceField: string };

function shortTitle(title: string, max = 38) {
  const t = title.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() + "…" : t;
}

function fmtNum(n: number, lang: "th" | "en") {
  return new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US").format(n);
}

/** Factual benefit lines from attributes → description → rating, each with a source. */
function factLines(f: ProductFacts, lang: "th" | "en"): Claim[] {
  const out: Claim[] = [];
  for (const [k, v] of Object.entries(f.attributes ?? {})) {
    if (!v || k.startsWith("demo_") || k === "trend_score") continue;
    out.push({ text: `${k}: ${v}`, sourceField: `attributes.${k}` });
  }
  if (f.description) {
    const first = f.description.split(/(?<=[.!?。])\s+|\s{2,}|\n/)[0]?.replace(/\(ข้อมูลตัวอย่าง\)/g, "").trim();
    if (first) out.push({ text: first.length > 90 ? first.slice(0, 90) + "…" : first, sourceField: "description" });
  }
  if (f.rating !== null) {
    out.push({
      text:
        lang === "th"
          ? `คะแนนรีวิว ${f.rating.toFixed(1)}/5${f.ratingCount ? ` จาก ${fmtNum(f.ratingCount, lang)} รีวิว` : ""}`
          : `Rated ${f.rating.toFixed(1)}/5${f.ratingCount ? ` from ${fmtNum(f.ratingCount, lang)} reviews` : ""}`,
      sourceField: f.ratingCount ? "ratingCount" : "rating",
    });
  }
  if (f.soldCount !== null && f.soldCount > 0) {
    out.push({ text: lang === "th" ? `ขายแล้ว ${fmtNum(f.soldCount, lang)} ชิ้น` : `${fmtNum(f.soldCount, lang)} sold`, sourceField: "soldCount" });
  }
  return out;
}

const SCENE_TITLE: Record<ShotType, { th: string; en: string }> = {
  hook: { th: "Hook", en: "Hook" },
  problem: { th: "Problem", en: "Problem" },
  solution: { th: "Solution", en: "Solution" },
  showcase: { th: "Product Showcase", en: "Product Showcase" },
  benefit: { th: "จุดเด่น", en: "Key point" },
  cta: { th: "CTA", en: "CTA" },
};

export function generateDemoScript(req: ScriptRequest): ScriptDraft {
  const f = req.facts;
  const lang = req.language;
  const th = lang === "th";
  const name = shortTitle(f.title);
  const brand = f.brand ? `${f.brand} ` : "";
  const facts = factLines(f, lang);
  const claims: Claim[] = [{ text: f.title, sourceField: "title" }];
  const usedFacts: Claim[] = [];
  let factIdx = 0;
  const nextFact = (): Claim | null => {
    const c = facts[factIdx++] ?? null;
    if (c) usedFacts.push(c);
    return c;
  };
  const visual = VISUAL_STYLES[req.visualStyle] ?? VISUAL_STYLES.premium;
  const durations = allocateDurations(req.structure, req.durationSec);

  const hookBy: Record<ScriptRequest["style"], string> = th
    ? {
        showcase: `ของน่าสนใจวันนี้: ${name}`,
        review: `สรุปจุดเด่น ${name} จากข้อมูลสินค้า`,
        problem_solution: `กำลังมองหา${name.split(" ")[0]}อยู่หรือเปล่า?`,
        promo: `${name} — เช็กโปรล่าสุดที่ลิงก์!`,
        three_benefits: `3 จุดเด่นของ ${name}`,
        comparison: `ก่อนเลือกซื้อ ${name} ดูข้อมูลนี้ก่อน`,
      }
    : {
        showcase: `Worth a look today: ${name}`,
        review: `${name}: key points from the product listing`,
        problem_solution: `Looking for a ${name.split(" ")[0]}?`,
        promo: `${name} — check today's deal at the link!`,
        three_benefits: `3 highlights of ${name}`,
        comparison: `Before you buy ${name}, check this`,
      };

  const scenes: SceneDraft[] = req.structure.map((kind, i) => {
    const shotType = (["hook", "problem", "solution", "showcase", "benefit", "cta"].includes(kind) ? kind : "showcase") as ShotType;
    const base = { durationSec: durations[i], title: SCENE_TITLE[shotType][lang], shotType };
    const bg = `${visual}, background scene only, no text, no logos, no product, vertical 9:16`;
    switch (shotType) {
      case "hook":
        return { ...base, caption: hookBy[req.style], voiceover: hookBy[req.style], visualPrompt: `Eye-catching opening backdrop, ${bg}` };
      case "problem":
        return {
          ...base,
          caption: th ? "เลือกของให้ตรงกับการใช้งานจริง" : "Pick what fits how you'll use it",
          voiceover: th ? "ก่อนตัดสินใจ ลองดูว่าสินค้าตรงกับการใช้งานของเราหรือไม่" : "Before deciding, check whether it fits your needs",
          visualPrompt: `Everyday situation mood, ${bg}`,
        };
      case "solution":
      case "benefit": {
        const c = nextFact();
        const text = c ? c.text : th ? `${brand}${name}` : `${brand}${name}`;
        return { ...base, caption: text, voiceover: c ? (th ? `${c.text}` : c.text) : text, visualPrompt: `Clean product stage, ${bg}` };
      }
      case "showcase": {
        const c = nextFact();
        const caption = c ? c.text : `${brand}${name}`;
        return {
          ...base,
          caption,
          voiceover: th ? `${brand}${name}${c ? ` ${c.text}` : ""}` : `${brand}${name}${c ? `. ${c.text}` : ""}`,
          visualPrompt: `Hero product podium, ${bg}`,
        };
      }
      case "cta":
      default:
        return {
          ...base,
          caption: th ? "ดูรายละเอียดและราคาปัจจุบันที่ลิงก์" : "See details & current price at the link",
          voiceover: th ? "ดูรายละเอียดและราคาปัจจุบันได้ที่ลิงก์สินค้า" : "See details and the current price at the product link",
          visualPrompt: `Closing call-to-action backdrop, ${bg}`,
        };
    }
  });

  claims.push(...usedFacts);
  if (f.brand) claims.push({ text: f.brand, sourceField: "brand" });
  const script: VideoScript = {
    hook: scenes[0]?.voiceover ?? "",
    body: scenes
      .slice(1, -1)
      .map((s) => s.voiceover)
      .join(" "),
    cta: scenes[scenes.length - 1]?.voiceover ?? "",
    caption: `${name}${f.brand ? ` (${f.brand})` : ""}\n${req.disclosureText}`,
    hashtags: [th ? "#ของดีบอกต่อ" : "#founditonline", "#Affiliate", f.platform ? `#${f.platform[0].toUpperCase()}${f.platform.slice(1)}` : "#Shopping"],
    disclosure: req.disclosureText,
    claims,
  };
  const warnings: string[] = [];
  if (facts.length === 0) warnings.push(th ? "ข้อมูลสินค้ามีน้อย สคริปต์จึงใช้เฉพาะชื่อสินค้า ควรเพิ่มคุณสมบัติสินค้า" : "Few product facts available; script only uses the title");
  if (f.dataOrigin === "demo") warnings.push(th ? "สินค้านี้เป็นข้อมูลตัวอย่าง (DEMO)" : "This product is DEMO data");
  return { script, scenes, generator: "demo", model: null, warnings };
}
