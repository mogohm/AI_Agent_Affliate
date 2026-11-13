import { describe, expect, it } from "vitest";
import { estimateCommission, combineRates, freshness, isEffective } from "@/lib/core/commission";
import { computeOpportunityScore, type ScoringInput } from "@/lib/core/scoring";
import { findDuplicate, normalizeGtin, normalizeTitle, titleSimilarity } from "@/lib/core/normalize";
import { categorizeByRules } from "@/lib/core/categorize";
import { can } from "@/lib/auth/permissions";
import { encryptSecret, decryptSecret, maskSecret } from "@/lib/crypto";
import { startOfBangkokDay, bangkokDateString } from "@/lib/time";

describe("estimateCommission", () => {
  it("computes price × rate", () => {
    expect(estimateCommission({ price: 890, rateTotal: 12.5 }).amount).toBe(111.25);
  });
  it("applies the cap", () => {
    const r = estimateCommission({ price: 10000, rateTotal: 10, capAmount: 500 });
    expect(r).toMatchObject({ amount: 500, capped: true });
  });
  it("returns 0 for zero rate, never invents values", () => {
    expect(estimateCommission({ price: 500, rateTotal: 0 }).amount).toBe(0);
    expect(estimateCommission({ price: 500, rateTotal: null })).toMatchObject({ amount: null, reason: "missing_rate" });
    expect(estimateCommission({ price: null, rateTotal: 10 })).toMatchObject({ amount: null, reason: "missing_price" });
  });
  it("rejects invalid rates and handles min basket", () => {
    expect(estimateCommission({ price: 100, rateTotal: 150 }).reason).toBe("invalid_rate");
    expect(estimateCommission({ price: 100, rateTotal: 10, minBasket: 200 })).toMatchObject({ amount: 0, belowMinBasket: true });
  });
  it("combines only provided rate components", () => {
    expect(combineRates({ seller: 5, platform: 3 })).toBe(8);
    expect(combineRates({})).toBeNull();
  });
});

describe("freshness / effectiveness", () => {
  const now = new Date("2026-11-12T00:00:00Z");
  it("classifies data age", () => {
    expect(freshness(new Date("2026-11-10T00:00:00Z"), now)).toBe("fresh");
    expect(freshness(new Date("2026-10-20T00:00:00Z"), now)).toBe("aging");
    expect(freshness(new Date("2026-08-01T00:00:00Z"), now)).toBe("stale");
    expect(freshness(null, now)).toBe("unknown");
  });
  it("checks effective window", () => {
    expect(isEffective({ effectiveTo: new Date("2026-11-01") }, now)).toBe(false);
    expect(isEffective({ effectiveFrom: new Date("2026-11-01") }, now)).toBe(true);
  });
});

describe("computeOpportunityScore", () => {
  const base: ScoringInput = {
    price: 890,
    commissionRate: 12.5,
    commissionAmount: 111.25,
    commissionIsEstimated: false,
    soldCount: 5300,
    rating: 4.8,
    ratingCount: 1240,
    trendScore: 70,
    contentPotential: 0.8,
    dataOrigin: "csv",
    fetchedAt: new Date(),
  };
  it("scores with full data and high confidence", () => {
    const r = computeOpportunityScore(base);
    expect(r.score).toBeGreaterThan(60);
    expect(r.confidence).toBeGreaterThan(0.8);
    expect(r.missingFields).toEqual([]);
    expect(r.needsReview).toBe(false);
  });
  it("does not impute missing data — lowers confidence and lists missing fields", () => {
    const r = computeOpportunityScore({ ...base, soldCount: null, rating: null, ratingCount: null, trendScore: null });
    expect(r.missingFields).toEqual(expect.arrayContaining(["sold_count", "rating", "trend_score"]));
    expect(r.components.find((c) => c.key === "sales")?.value).toBeNull();
    expect(r.confidence).toBeLessThan(computeOpportunityScore(base).confidence);
  });
  it("flags review when commission unknown or data is demo", () => {
    expect(computeOpportunityScore({ ...base, commissionRate: null, commissionAmount: null }).needsReview).toBe(true);
    const demo = computeOpportunityScore({ ...base, dataOrigin: "demo" });
    expect(demo.explanation).toContain("DEMO");
  });
  it("returns null score when nothing can be scored", () => {
    const r = computeOpportunityScore({ ...base, price: null, commissionRate: null, commissionAmount: null, soldCount: null, rating: null, trendScore: null, contentPotential: null });
    expect(r.score).toBeNull();
    expect(r.confidence).toBe(0);
  });
  it("stale data reduces reliability", () => {
    const stale = computeOpportunityScore({ ...base, fetchedAt: new Date(Date.now() - 60 * 86_400_000) });
    expect(stale.freshness).toBe("stale");
    expect(stale.reliability).toBeLessThan(computeOpportunityScore(base).reliability);
  });
});

describe("normalisation & duplicates", () => {
  it("normalises titles and GTINs", () => {
    expect(normalizeTitle("【ส่งฟรี】 หูฟัง Bluetooth!!")).toBe("หูฟัง bluetooth");
    expect(normalizeGtin("885-0000-123456")).toBe("00008850000123456".slice(-14));
    expect(normalizeGtin("12")).toBeNull();
  });
  it("detects duplicates by GTIN, brand+model and flags similar titles", () => {
    const existing = [
      { id: "a", title: "หูฟังบลูทูธ DemoSound X1", brand: "DemoSound", model: "X-100", gtin: "8850000123456" },
      { id: "b", title: "ไฟวงแหวน 10 นิ้ว พร้อมขาตั้ง", brand: null, model: null, gtin: null },
    ];
    expect(findDuplicate({ id: "", title: "anything", gtin: "08850000123456" }, existing)).toMatchObject({ id: "a", reason: "gtin" });
    expect(findDuplicate({ id: "", title: "x", brand: "demosound", model: "x100" }, existing)).toMatchObject({ id: "a", reason: "brand_model" });
    expect(findDuplicate({ id: "", title: "ไฟวงแหวน 10 นิ้ว พร้อมขาตั้ง ส่งฟรี" }, existing)).toMatchObject({ id: "b", reason: "title" });
    expect(findDuplicate({ id: "", title: "เครื่องปั่นพกพา" }, existing)).toBeNull();
    expect(titleSimilarity("abc def", "abc def")).toBe(1);
  });
  it("categorises by keyword rules", () => {
    const cats = [
      { id: "c1", name: "อุปกรณ์อิเล็กทรอนิกส์", slug: "electronics", keywords: ["หูฟัง", "bluetooth"] },
      { id: "c2", name: "ไลฟ์สไตล์", slug: "lifestyle", keywords: ["หมอน"] },
    ];
    expect(categorizeByRules({ title: "หูฟัง Bluetooth ไร้สาย" }, cats)?.categoryId).toBe("c1");
    expect(categorizeByRules({ title: "สินค้าไม่ทราบประเภท" }, cats)).toBeNull();
  });
});

describe("RBAC", () => {
  it("restricts approve/publish/credentials", () => {
    expect(can("viewer", "video:approve")).toBe(false);
    expect(can("editor", "video:approve")).toBe(false);
    expect(can("approver", "video:approve")).toBe(true);
    expect(can("editor", "credentials:manage")).toBe(false);
    expect(can("admin", "credentials:manage")).toBe(true);
    expect(can("viewer", "products:write")).toBe(false);
  });
});

describe("secrets & time", () => {
  it("encrypts and masks secrets", () => {
    const enc = encryptSecret("sk-test-1234567890");
    expect(enc).not.toContain("sk-test");
    expect(decryptSecret(enc)).toBe("sk-test-1234567890");
    expect(maskSecret("sk-test-1234567890")).toBe("••••7890");
  });
  it("uses Asia/Bangkok day boundaries", () => {
    const d = new Date("2026-11-12T18:30:00Z"); // 01:30 next day in Bangkok
    expect(bangkokDateString(d)).toBe("2026-11-13");
    expect(startOfBangkokDay(d).toISOString()).toBe("2026-11-12T17:00:00.000Z");
  });
});
