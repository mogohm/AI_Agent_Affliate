import type { ProductFacts, VideoScript } from "@/db/schema";

export type ShotType = "hook" | "problem" | "solution" | "showcase" | "benefit" | "cta";

export type SceneDraft = {
  durationSec: number;
  title: string;
  voiceover: string;
  caption: string;
  visualPrompt: string;
  shotType: ShotType;
};

export type ScriptDraft = {
  script: VideoScript;
  scenes: SceneDraft[];
  generator: "demo" | "openai";
  model: string | null;
  warnings: string[];
};

export type ScriptRequest = {
  facts: ProductFacts;
  style: "showcase" | "review" | "problem_solution" | "promo" | "three_benefits" | "comparison";
  structure: string[];
  templatePrompt: string;
  language: "th" | "en";
  durationSec: number;
  disclosureText: string;
  visualStyle: string;
};

/** Fact paths a script claim may cite. Anything else is rejected as unsupported. */
export function allowedSourceFields(facts: ProductFacts): Set<string> {
  const s = new Set<string>(["title"]);
  if (facts.brand) s.add("brand");
  if (facts.price !== null) s.add("price");
  if (facts.rating !== null) s.add("rating");
  if (facts.ratingCount !== null) s.add("ratingCount");
  if (facts.soldCount !== null) s.add("soldCount");
  if (facts.description) s.add("description");
  if (facts.platform) s.add("platform");
  for (const k of Object.keys(facts.attributes ?? {})) s.add(`attributes.${k}`);
  return s;
}

/** Split a total duration over scenes: hook ≈3s, cta ≈4s, the rest shares the remainder. */
export function allocateDurations(structure: string[], total: number): number[] {
  const n = structure.length;
  if (!n) return [];
  const fixed: number[] = structure.map((s) => (s === "hook" ? 3 : s === "cta" ? 4 : 0));
  const fixedSum = fixed.reduce((a, b) => a + b, 0);
  const flexible = fixed.filter((f) => f === 0).length;
  if (fixedSum >= total || flexible === 0) return structure.map(() => Math.round((total / n) * 10) / 10);
  const each = (total - fixedSum) / flexible;
  const out = fixed.map((f) => (f === 0 ? Math.round(each * 10) / 10 : f));
  const drift = Math.round((total - out.reduce((a, b) => a + b, 0)) * 10) / 10;
  out[out.length - 1] = Math.round((out[out.length - 1] + drift) * 10) / 10;
  return out;
}

export const VISUAL_STYLES: Record<string, string> = {
  premium: "premium product commercial lighting, soft gradients, studio",
  minimal: "minimal clean background, soft shadows, pastel neutral",
  lifestyle: "warm lifestyle home interior, natural daylight, blurred",
  playful: "playful pastel colors, fun shapes, bright",
  tech: "tech cinematic, dark blue neon accents, bokeh",
};
