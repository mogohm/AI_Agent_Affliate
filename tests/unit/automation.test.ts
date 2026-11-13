import { describe, expect, it } from "vitest";
import { applyPostFilters, conditionsToFilters, estimatePerVideoUsd, isScheduleDue, remainingQuota } from "@/lib/automation/engine";
import type { OfferRow } from "@/lib/catalog/service";

const offer = (o: Partial<OfferRow>): OfferRow =>
  ({
    offer_id: "o1",
    product_id: "p1",
    title: "สินค้า",
    brand: null,
    image_url: null,
    image_rights: "unknown",
    category_id: "c1",
    category_name: "หมวด",
    category_source: "rules",
    platform: "shopee",
    shop_name: null,
    external_product_id: "x",
    price: 1000,
    rating: 4.5,
    rating_count: 10,
    sold_count: 100,
    product_url: null,
    affiliate_url: null,
    data_origin: "csv",
    fetched_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    rate_total: 10,
    cap_amount: null,
    rate_is_estimated: false,
    commission_origin: "csv",
    commission_fetched_at: null,
    est_commission: 100,
    score: 80,
    score_confidence: 0.8,
    needs_review: false,
    analyzer: "rules",
    duplicate_group_id: null,
    duplicate_reason: null,
    shortlisted: false,
    ...o,
  }) as OfferRow;

describe("automation rule evaluation", () => {
  it("maps single-valued conditions to SQL filters", () => {
    expect(conditionsToFilters({ minCommissionAmount: 50, minScore: 60, marketplaces: ["lazada"], categoryIds: ["a", "b"] })).toMatchObject({
      minCommission: 50,
      minScore: 60,
      marketplace: "lazada",
      sort: "commission_amount",
    });
    expect(conditionsToFilters({ categoryIds: ["a", "b"] }).categoryId).toBeUndefined();
  });

  it("post-filters with reasons and never treats missing data as passing", () => {
    const offers = [
      offer({ offer_id: "a", product_id: "pa" }),
      offer({ offer_id: "b", product_id: "pb", est_commission: null }),
      offer({ offer_id: "c", product_id: "pc", score: null }),
      offer({ offer_id: "d", product_id: "pd", score_confidence: 0.2 }),
      offer({ offer_id: "e", product_id: "pe", platform: "lazada" }),
      offer({ offer_id: "f", product_id: "pf", category_id: "other" }),
      offer({ offer_id: "g", product_id: "pa" }), // second offer of same product
      offer({ offer_id: "h", product_id: "ph" }), // already produced
    ];
    const { matches, rejected } = applyPostFilters(
      offers,
      { minCommissionAmount: 50, minScore: 60, minConfidence: 0.5, marketplaces: ["shopee"], categoryIds: ["c1"], excludeAlreadyProduced: true },
      new Set(["ph"]),
    );
    expect(matches.map((m) => m.offerId)).toEqual(["a"]);
    expect(rejected.map((r) => r.offerId).sort()).toEqual(["b", "c", "d", "e", "f", "g", "h"]);
    expect(rejected.find((r) => r.offerId === "b")?.reason).toContain("ไม่มีข้อมูลค่าคอม");
  });

  it("requires authorized images when asked", () => {
    const { matches } = applyPostFilters([offer({ image_rights: "unknown" }), offer({ offer_id: "z", product_id: "pz", image_rights: "authorized" })], { requireAuthorizedImage: true }, new Set());
    expect(matches.map((m) => m.offerId)).toEqual(["z"]);
  });

  it("computes remaining daily quota", () => {
    expect(remainingQuota(3, 0)).toBe(3);
    expect(remainingQuota(3, 2)).toBe(1);
    expect(remainingQuota(3, 5)).toBe(0);
  });

  it("estimates zero cost in demo mode and positive in live mode", () => {
    const pricing = { textInputPer1M: 0.25, textOutputPer1M: 2, imagePerImage: 0.04, ttsPer1MChars: 15, videoPerSecond: 0.1 };
    const actions = { autoGenerateScript: true, autoRender: true, renderMode: "hybrid" as const };
    expect(estimatePerVideoUsd({ mode: "demo", pricing }, actions)).toBe(0);
    const hybrid = estimatePerVideoUsd({ mode: "live", pricing }, actions);
    expect(hybrid).toBeGreaterThan(0.16);
    expect(estimatePerVideoUsd({ mode: "live", pricing }, { ...actions, renderMode: "generative" })).toBeGreaterThan(hybrid + 1.9);
  });

  it("runs daily schedules once per Bangkok day after the scheduled time", () => {
    const base = { enabled: true, schedule: "daily" as const, scheduleTime: "09:00", lastRunAt: null as Date | null };
    expect(isScheduleDue(base, new Date("2026-11-12T01:00:00Z"))).toBe(false); // 08:00 BKK
    expect(isScheduleDue(base, new Date("2026-11-12T02:30:00Z"))).toBe(true); // 09:30 BKK
    expect(isScheduleDue({ ...base, lastRunAt: new Date("2026-11-12T02:31:00Z") }, new Date("2026-11-12T05:00:00Z"))).toBe(false);
    expect(isScheduleDue({ ...base, lastRunAt: new Date("2026-11-11T02:31:00Z") }, new Date("2026-11-12T05:00:00Z"))).toBe(true);
    expect(isScheduleDue({ ...base, schedule: "manual" }, new Date("2026-11-12T05:00:00Z"))).toBe(false);
    expect(isScheduleDue({ ...base, enabled: false }, new Date("2026-11-12T05:00:00Z"))).toBe(false);
  });
});
