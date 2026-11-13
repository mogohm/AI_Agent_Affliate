import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, callRoute, type TestCtx } from "../helpers";
import * as importRoute from "@/app/api/analytics/import/route";
import * as summaryRoute from "@/app/api/analytics/summary/route";
import * as commissionsRoute from "@/app/api/analytics/commissions/route";
import * as performanceRoute from "@/app/api/analytics/performance/route";
import * as costsRoute from "@/app/api/analytics/costs/route";
import { recordUsage } from "@/lib/ai/usage";
import { bangkokDateString } from "@/lib/time";

let t: TestCtx;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => t.close());

const today = bangkokDateString();

describe("analytics", () => {
  it("defaults to including DEMO data only while no real data exists", async () => {
    const r = await callRoute(t.db, summaryRoute.GET, { url: "http://localhost/api/analytics/summary?period=30" });
    expect(r.status).toBe(200);
    expect(r.json.hasRealData).toBe(false);
    expect(r.json.includeDemo).toBe(true);
    expect(r.json.provenance.origins).toContain("demo");
    expect(r.json.kpis.clicks).toBeGreaterThan(0);
  });

  it("imports an orders report (validation errors per row) and separates statuses", async () => {
    const rows = [
      { orderRef: "A1", itemRef: "1", platform: "Shopee", productRef: "DEMO-001", orderValue: "890", commission: "111.25", status: "Pending", orderedAt: today, subId: "vid-1" },
      { orderRef: "A2", itemRef: "1", platform: "Shopee", productRef: "DEMO-003", orderValue: "1,290", commission: "135.45", status: "Completed", orderedAt: today },
      { orderRef: "A3", itemRef: "1", platform: "Lazada", productRef: "DEMO-002", orderValue: "1690", commission: "160.55", status: "Paid", orderedAt: today },
      { orderRef: "A4", itemRef: "1", platform: "Lazada", productRef: "DEMO-004", orderValue: "790", commission: "110.6", status: "Cancelled", orderedAt: today },
      { orderRef: "", platform: "Shopee", commission: "1", status: "Pending", orderedAt: today },
      { orderRef: "A6", platform: "Shopee", commission: "1", status: "weird", orderedAt: today },
    ];
    expect((await callRoute(t.db, importRoute.POST, { body: { kind: "orders", rows, confirmAuthorized: true }, as: "viewer" })).status).toBe(403);
    expect((await callRoute(t.db, importRoute.POST, { body: { kind: "orders", rows } })).status).toBe(400); // must confirm authorisation
    const r = await callRoute(t.db, importRoute.POST, { body: { kind: "orders", rows, fileName: "orders.csv", confirmAuthorized: true } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ inserted: 4, updated: 0, failed: 2, status: "completed_with_errors" });
    expect(r.json.errors.map((e: { row: number }) => e.row)).toEqual([6, 7]);

    // re-import: status progressed pending → approved, counted as update
    const again = await callRoute(t.db, importRoute.POST, { body: { kind: "orders", rows: [{ ...rows[0], status: "Validated" }], confirmAuthorized: true } });
    expect(again.json).toMatchObject({ inserted: 0, updated: 1 });

    const clicks = await callRoute(t.db, importRoute.POST, {
      body: { kind: "clicks", rows: [{ date: today, platform: "shopee", subId: "vid-1", clicks: "120" }, { date: today, platform: "lazada", clicks: "80" }], confirmAuthorized: true },
    });
    expect(clicks.json.inserted).toBe(2);

    const s = await callRoute(t.db, summaryRoute.GET, { url: "http://localhost/api/analytics/summary?period=7" });
    expect(s.json.hasRealData).toBe(true);
    expect(s.json.includeDemo).toBe(false);
    expect(s.json.provenance.origins).toEqual(["csv"]);
    const c = s.json.kpis.commission;
    expect(c.pending).toBe(0);
    expect(c.approved).toBeCloseTo(111.25 + 135.45, 2);
    expect(c.paid).toBeCloseTo(160.55, 2);
    expect(c.reversed).toBeCloseTo(110.6, 2);
    expect(s.json.kpis.orders).toBe(3); // reversed excluded
    expect(s.json.kpis.clicks).toBe(200);
    expect(s.json.kpis.validatedCommission).toBeCloseTo(111.25 + 135.45 + 160.55, 2);
    expect(s.json.kpis.roi).toBeNull(); // no AI cost recorded yet

    await recordUsage(t.db, { workspaceId: t.workspaceId, provider: "openai", model: "m", operation: "script", units: 1000, unit: "tokens", costUsd: 1 });
    const s2 = await callRoute(t.db, summaryRoute.GET, { url: "http://localhost/api/analytics/summary?period=7" });
    expect(s2.json.kpis.aiCostThb).toBeCloseTo(36, 5);
    expect(s2.json.kpis.netRevenueThb).toBeCloseTo(407.25 - 36, 2);
    expect(s2.json.kpis.roi).toBeCloseTo(407.25 / 36, 3);

    const withDemo = await callRoute(t.db, summaryRoute.GET, { url: "http://localhost/api/analytics/summary?period=7&includeDemo=true" });
    expect(withDemo.json.provenance.origins).toContain("demo");

    const lazada = await callRoute(t.db, commissionsRoute.GET, { url: "http://localhost/api/analytics/commissions?period=7&marketplace=lazada" });
    expect(lazada.json.byPlatform).toHaveLength(1);
    expect(lazada.json.byPlatform[0]).toMatchObject({ platform: "lazada", clicks: 80 });

    const perf = await callRoute(t.db, performanceRoute.GET, { url: "http://localhost/api/analytics/performance?period=7" });
    expect(perf.json.byProduct.find((p: { product_ref: string }) => p.product_ref === "DEMO-002")?.title).toContain("เครื่องดูดฝุ่น");
    expect(perf.json.byContent.find((x: { sub_id: string }) => x.sub_id === "vid-1")).toBeTruthy();
    const costs = await callRoute(t.db, costsRoute.GET, { url: "http://localhost/api/analytics/costs?period=7" });
    expect(costs.json.byOperation[0]).toMatchObject({ operation: "script", usd: 1 });
    const history = await callRoute(t.db, importRoute.GET, {});
    expect(history.json.items.length).toBe(3);
  });
});
