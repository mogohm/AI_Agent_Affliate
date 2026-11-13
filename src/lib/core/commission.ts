/**
 * Commission maths. Pure functions — no I/O — so they can be unit tested and used anywhere.
 *
 * Estimated gross commission per eligible order = min(eligible item value × total rate, cap)
 * (brief §5). Returns null whenever the inputs needed are missing — never invents a number.
 */
export type CommissionInput = {
  price: number | null | undefined;
  /** percent, e.g. 12.5 */
  rateTotal: number | null | undefined;
  capAmount?: number | null;
  minBasket?: number | null;
  /** quantity / basket multiplier — defaults to 1 item */
  quantity?: number;
};

export type CommissionResult = {
  amount: number | null;
  capped: boolean;
  belowMinBasket: boolean;
  reason?: "missing_price" | "missing_rate" | "invalid_rate" | "below_min_basket";
};

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function estimateCommission(input: CommissionInput): CommissionResult {
  const { price, rateTotal, capAmount, minBasket } = input;
  const qty = input.quantity ?? 1;
  if (price === null || price === undefined || !Number.isFinite(price) || price < 0) {
    return { amount: null, capped: false, belowMinBasket: false, reason: "missing_price" };
  }
  if (rateTotal === null || rateTotal === undefined || !Number.isFinite(rateTotal)) {
    return { amount: null, capped: false, belowMinBasket: false, reason: "missing_rate" };
  }
  if (rateTotal < 0 || rateTotal > 100) {
    return { amount: null, capped: false, belowMinBasket: false, reason: "invalid_rate" };
  }
  const value = price * qty;
  if (minBasket !== null && minBasket !== undefined && minBasket > 0 && value < minBasket) {
    return { amount: 0, capped: false, belowMinBasket: true, reason: "below_min_basket" };
  }
  const gross = (value * rateTotal) / 100;
  if (capAmount !== null && capAmount !== undefined && capAmount >= 0 && gross > capAmount) {
    return { amount: roundMoney(capAmount), capped: true, belowMinBasket: false };
  }
  return { amount: roundMoney(gross), capped: false, belowMinBasket: false };
}

/** Sum separately stored components; only valid when the official terms say they stack. */
export function combineRates(parts: { seller?: number | null; platform?: number | null; bonus?: number | null }): number | null {
  const vals = [parts.seller, parts.platform, parts.bonus].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) * 1000) / 1000;
}

export type Freshness = "fresh" | "aging" | "stale" | "unknown";

/** Data freshness classification for offer/commission facts. */
export function freshness(fetchedAt: Date | string | null | undefined, now = new Date()): Freshness {
  if (!fetchedAt) return "unknown";
  const t = typeof fetchedAt === "string" ? new Date(fetchedAt) : fetchedAt;
  if (Number.isNaN(t.getTime())) return "unknown";
  const days = (now.getTime() - t.getTime()) / 86_400_000;
  if (days <= 7) return "fresh";
  if (days <= 30) return "aging";
  return "stale";
}

/** Whether a commission snapshot is in effect at `at`. */
export function isEffective(s: { effectiveFrom?: Date | null; effectiveTo?: Date | null }, at = new Date()): boolean {
  if (s.effectiveFrom && s.effectiveFrom > at) return false;
  if (s.effectiveTo && s.effectiveTo < at) return false;
  return true;
}
