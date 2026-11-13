import { describe, expect, it } from "vitest";
import type { ProductFacts } from "@/db/schema";
import { generateDemoScript } from "@/lib/video/script-demo";
import { allocateDurations, allowedSourceFields } from "@/lib/video/script-types";
import { soraSeconds } from "@/lib/video/openai-providers";
import { DEFAULT_TEMPLATES } from "@/lib/video/templates";

const facts: ProductFacts = {
  title: "ไฟวงแหวนสำหรับครีเอเตอร์ 10 นิ้ว",
  brand: "DemoLight",
  price: 890,
  currency: "THB",
  platform: "shopee",
  rating: 4.8,
  ratingCount: 1240,
  soldCount: null,
  attributes: { "โทนสี": "3 โทน", "ขนาด": "10 นิ้ว" },
  description: null,
  productUrl: null,
  affiliateUrl: "https://example.com/aff",
  dataOrigin: "csv",
  capturedAt: "2026-11-12T00:00:00.000Z",
};

describe("demo script generator", () => {
  for (const t of DEFAULT_TEMPLATES) {
    it(`${t.key}: uses only facts, cites real fields, includes disclosure`, () => {
      for (const language of ["th", "en"] as const) {
        const d = generateDemoScript({ facts, style: t.style, structure: t.config.structure, templatePrompt: t.prompt, language, durationSec: t.config.durationSec, disclosureText: "#โฆษณา ลิงก์ Affiliate", visualStyle: "premium" });
        expect(d.scenes).toHaveLength(t.config.structure.length);
        expect(Math.round(d.scenes.reduce((a, s) => a + s.durationSec, 0))).toBe(t.config.durationSec);
        const allowed = allowedSourceFields(facts);
        for (const c of d.script.claims) expect(allowed.has(c.sourceField)).toBe(true);
        expect(d.script.caption).toContain("#โฆษณา");
        const all = JSON.stringify(d);
        expect(all).not.toMatch(/ฉันใช้|ใช้มาแล้ว|I've used|I used/); // no fabricated first-person review
        expect(all).not.toContain("sold"); // soldCount is null → must not be mentioned
        expect(all).not.toMatch(/฿\s?\d/); // price is never spoken; rendered deterministically instead
      }
    });
  }
  it("is deterministic", () => {
    const req = { facts, style: "showcase" as const, structure: ["hook", "showcase", "benefit", "cta"], templatePrompt: "", language: "th" as const, durationSec: 20, disclosureText: "#ad", visualStyle: "tech" };
    expect(generateDemoScript(req)).toEqual(generateDemoScript(req));
  });
  it("warns when facts are thin", () => {
    const d = generateDemoScript({ facts: { ...facts, attributes: {}, rating: null, ratingCount: null }, style: "showcase", structure: ["hook", "benefit", "cta"], templatePrompt: "", language: "th", durationSec: 15, disclosureText: "#ad", visualStyle: "premium" });
    expect(d.warnings.length).toBeGreaterThan(0);
  });
});

describe("helpers", () => {
  it("allocates durations with fixed hook/cta", () => {
    expect(allocateDurations(["hook", "showcase", "benefit", "cta"], 20)).toEqual([3, 6.5, 6.5, 4]);
    expect(allocateDurations(["hook", "cta"], 5)).toEqual([2.5, 2.5]);
  });
  it("maps scene lengths to allowed Sora durations", () => {
    expect(soraSeconds(3, 8)).toBe("4");
    expect(soraSeconds(6, 8)).toBe("8");
    expect(soraSeconds(11, 8)).toBe("8");
    expect(soraSeconds(11, 12)).toBe("12");
  });
});
