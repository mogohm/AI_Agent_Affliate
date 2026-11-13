import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callRoute, setupTestDb, type TestCtx } from "../helpers";
import * as dashboardRoute from "@/app/api/dashboard/route";

let t: TestCtx;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("GET /api/dashboard", () => {
  it("returns KPIs with provenance from seeded demo data", async () => {
    const r = await callRoute(t.db, dashboardRoute.GET, { url: "http://localhost/api/dashboard?period=30" });
    expect(r.status).toBe(200);
    const d = r.json;
    expect(d.catalog.products).toBe(8);
    expect(d.catalog.origins).toEqual({ demo: 8 });
    expect(d.catalog.avgRate).toBeGreaterThan(0);
    expect(d.trend).toHaveLength(30);
    expect(d.revenue.origins).toEqual(["demo"]);
    expect(d.topProducts).toHaveLength(5);
    expect(d.topProducts[0].est_commission).toBeGreaterThanOrEqual(d.topProducts[1].est_commission);
    expect(d.insights.some((s: string) => s.includes("DEMO"))).toBe(true);
    expect(d.aiCost.usd).toBe(0);
  });

  it("applies marketplace and period filters", async () => {
    const all = await callRoute(t.db, dashboardRoute.GET, { url: "http://localhost/api/dashboard?period=90" });
    const shopee = await callRoute(t.db, dashboardRoute.GET, { url: "http://localhost/api/dashboard?period=7&marketplace=shopee" });
    expect(shopee.json.catalog.products).toBe(4);
    expect(shopee.json.trend).toHaveLength(7);
    expect(shopee.json.topProducts.every((p: { platform: string }) => p.platform === "shopee")).toBe(true);
    expect(shopee.json.revenue.orders).toBeLessThanOrEqual(all.json.revenue.orders);
    expect((await callRoute(t.db, dashboardRoute.GET, { url: "http://localhost/api/dashboard?period=5" })).status).toBe(400);
  });

  it("is readable by viewers", async () => {
    expect((await callRoute(t.db, dashboardRoute.GET, { as: "viewer" })).status).toBe(200);
  });
});
