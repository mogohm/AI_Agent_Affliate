import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { callRoute, setupTestDb, type TestCtx } from "../helpers";
import * as productsRoute from "@/app/api/products/route";
import * as productRoute from "@/app/api/products/[id]/route";
import * as dupRoute from "@/app/api/products/[id]/duplicate/route";
import * as analyzeRoute from "@/app/api/products/analyze/route";
import * as importRoute from "@/app/api/ingestion/imports/route";
import * as runsRoute from "@/app/api/ingestion/runs/route";
import * as categoriesRoute from "@/app/api/categories/route";
import * as shortlistsRoute from "@/app/api/shortlists/route";
import * as shortlistItemsRoute from "@/app/api/shortlists/[id]/items/route";
import * as connRoute from "@/app/api/settings/connections/route";
import * as connSaveRoute from "@/app/api/settings/connections/[platform]/route";
import * as connTestRoute from "@/app/api/settings/connections/[platform]/test/route";
import * as connSyncRoute from "@/app/api/settings/connections/[platform]/sync/route";
import { drainQueue } from "@/lib/jobs/worker";
import { jobs, marketplaceConnections, productScores, providerUsageCosts } from "@/db/schema";
import { __setOpenAIFactory } from "@/lib/ai/context";
import { setSecret, setSetting } from "@/lib/settings";
import { __setMarketplaceProvider } from "@/lib/marketplace";
import { shopeeProvider } from "@/lib/marketplace/shopee";

let t: TestCtx;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  __setOpenAIFactory(undefined);
  __setMarketplaceProvider("shopee", undefined);
  await t.close();
});

const CSV = [
  "Item Id,Product Name,Price,Commission Rate,Commission Cap,Shop Name,Sales,Item Rating,Offer Link",
  "X-1,ลำโพงบลูทูธพกพา,2000,10%,100,ShopA,1500,4.6,https://s.shopee.co.th/a",
  "X-2,ขาตั้งกล้องมือถือ,500,20%,,ShopA,,,",
  "X-3,สินค้าราคาผิด,abc,5%,,ShopB,,,",
  "X-1,ลำโพงบลูทูธพกพา,2000,10%,100,ShopA,1500,4.6,https://s.shopee.co.th/a",
].join("\n");

describe("CSV import → explorer", () => {
  it("rejects import without authorization confirmation", async () => {
    const r = await callRoute(t.db, importRoute.POST, { body: { csvText: CSV, defaultPlatform: "shopee" } });
    expect(r.status).toBe(400);
  });

  it("forbids viewers from importing", async () => {
    const r = await callRoute(t.db, importRoute.POST, { as: "viewer", body: { csvText: CSV, defaultPlatform: "shopee", authorizationConfirmed: true } });
    expect(r.status).toBe(403);
  });

  it("imports rows, reports errors and in-file duplicates", async () => {
    const r = await callRoute(t.db, importRoute.POST, { body: { csvText: CSV, fileName: "feed.csv", defaultPlatform: "shopee", authorizationConfirmed: true } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ totalRows: 4, inserted: 2, failed: 2, status: "completed_with_errors" });
    expect(r.json.errors.map((e: { row: number }) => e.row)).toEqual([4, 5]);
    const runs = await callRoute(t.db, runsRoute.GET);
    expect(runs.json.items[0]).toMatchObject({ fileName: "feed.csv", inserted: 2, failed: 2 });
  });

  it("lists imported offers sorted by commission amount with cap applied", async () => {
    const r = await callRoute(t.db, productsRoute.GET, { url: "http://localhost/api/products?origin=csv" });
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(2);
    // X-2: 500 × 20% = 100 ; X-1: 2000 × 10% = 200 capped to 100 → tie broken by id; both 100
    expect(r.json.items.map((i: { est_commission: number }) => i.est_commission)).toEqual([100, 100]);
    const byRate = await callRoute(t.db, productsRoute.GET, { url: "http://localhost/api/products?origin=csv&sort=commission_rate" });
    expect(byRate.json.items[0].title).toBe("ขาตั้งกล้องมือถือ");
    const filtered = await callRoute(t.db, productsRoute.GET, { url: "http://localhost/api/products?minRate=15&marketplace=shopee" });
    expect(filtered.json.items.every((i: { rate_total: number }) => i.rate_total >= 15)).toBe(true);
    const bad = await callRoute(t.db, productsRoute.GET, { url: "http://localhost/api/products?sort=drop_table" });
    expect(bad.status).toBe(400);
  });

  it("adds a manual product and returns detail with commission provenance", async () => {
    const add = await callRoute(t.db, productsRoute.POST, {
      body: { platform: "lazada", externalProductId: "M-1", title: "เครื่องฟอกอากาศ ขนาดเล็ก", price: 3000, commissionRate: 8, commissionIsEstimated: true, imageRights: "unknown" },
    });
    expect(add.status).toBe(200);
    const d = await callRoute(t.db, productRoute.GET, { params: { id: add.json.productId } });
    expect(d.status).toBe(200);
    expect(d.json.offers[0]).toMatchObject({ dataOrigin: "manual", estCommission: 240 });
    expect(d.json.offers[0].currentCommission).toMatchObject({ isEstimated: true, sourceReference: "Manual entry (estimated)" });
    expect(d.json.latestScore.analyzer).toBe("rules");
    expect(d.json.category?.slug).toBe("home-appliances");
    const patch = await callRoute(t.db, productRoute.PATCH, { method: "PATCH", params: { id: add.json.productId }, body: { imageRights: "authorized" } });
    expect(patch.status).toBe(200);
    const viewerPatch = await callRoute(t.db, productRoute.PATCH, { as: "viewer", method: "PATCH", params: { id: add.json.productId }, body: { imageRights: "authorized" } });
    expect(viewerPatch.status).toBe(403);
  });

  it("resolves a possible duplicate by human merge", async () => {
    const a = await callRoute(t.db, productsRoute.POST, { body: { platform: "shopee", externalProductId: "D-1", title: "แก้วเก็บความเย็น สแตนเลส 900 มล", price: 300, commissionRate: 10 } });
    const b = await callRoute(t.db, productsRoute.POST, { body: { platform: "lazada", externalProductId: "D-2", title: "แก้วเก็บความเย็น สแตนเลส 900 มล ส่งฟรี", price: 320, commissionRate: 9 } });
    expect(b.json.possibleDuplicateOf).toBe(a.json.productId);
    const dupList = await callRoute(t.db, productsRoute.GET, { url: "http://localhost/api/products?duplicatesOnly=1" });
    expect(dupList.json.total).toBeGreaterThanOrEqual(2);
    const m = await callRoute(t.db, dupRoute.POST, { params: { id: a.json.productId }, body: { action: "merge", otherId: b.json.productId } });
    expect(m.status).toBe(200);
    const d = await callRoute(t.db, productRoute.GET, { params: { id: a.json.productId } });
    expect(d.json.offers.length).toBe(2);
    expect((await callRoute(t.db, productRoute.GET, { params: { id: b.json.productId } })).status).toBe(404);
  });

  it("manages categories and shortlists", async () => {
    const c = await callRoute(t.db, categoriesRoute.POST, { body: { name: "สัตว์เลี้ยง", keywords: ["แมว", "สุนัข"] } });
    expect(c.status).toBe(200);
    expect((await callRoute(t.db, categoriesRoute.POST, { body: { name: "สัตว์เลี้ยง" } })).status).toBe(409);
    const s = await callRoute(t.db, shortlistsRoute.POST, { body: { name: "ทำคลิปสัปดาห์นี้" } });
    const list = await callRoute(t.db, productsRoute.GET);
    const pid = list.json.items[0].product_id;
    const add = await callRoute(t.db, shortlistItemsRoute.POST, { params: { id: s.json.id }, body: { productIds: [pid] } });
    expect(add.json.added).toBe(1);
    const inList = await callRoute(t.db, productsRoute.GET, { url: `http://localhost/api/products?shortlistId=${s.json.id}` });
    expect(inList.json.total).toBe(1);
    expect(inList.json.items[0].shortlisted).toBe(true);
  });
});

describe("AI analysis job", () => {
  it("demo mode: rule-based rescoring through the worker", async () => {
    const before = await t.db.select().from(productScores);
    const r = await callRoute(t.db, analyzeRoute.POST, { body: { all: true } });
    expect(r.status).toBe(200);
    expect(await drainQueue(t.db)).toContain("succeeded");
    const after = await t.db.select().from(productScores);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.some((s) => s.analyzer === "openai")).toBe(false);
  });

  it("live mode: uses OpenAI structured output, records cost; blocks when over budget", async () => {
    const calls: unknown[] = [];
    __setOpenAIFactory(
      () =>
        ({
          responses: {
            create: async (req: unknown) => {
              calls.push(req);
              return {
                output_text: JSON.stringify({
                  categorySlug: "electronics",
                  categoryConfidence: 0.9,
                  audience: "คนทำงานที่ฟังเพลงระหว่างเดินทาง",
                  contentAngles: ["โชว์ขนาดพกพา"],
                  riskFlags: ["ไม่มีข้อมูลกันน้ำ"],
                  contentPotential: 0.77,
                  contentEvidence: "(title, attributes.Bluetooth)",
                  summary: "เหมาะกับคลิปโชว์สินค้า",
                }),
                usage: { input_tokens: 1000, output_tokens: 300 },
              };
            },
          },
        }) as never,
    );
    await setSetting(t.db, t.workspaceId, "ai.mode", "live");
    await setSecret(t.db, t.workspaceId, "secret.openaiApiKey", "sk-test-xyz");
    const list = await callRoute(t.db, productsRoute.GET, { url: "http://localhost/api/products?origin=demo&pageSize=1" });
    const pid = list.json.items[0].product_id;
    await callRoute(t.db, analyzeRoute.POST, { body: { productIds: [pid] } });
    expect(await drainQueue(t.db)).toEqual(["succeeded"]);
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0])).toContain("json_schema");
    const d = await callRoute(t.db, productRoute.GET, { params: { id: pid } });
    expect(d.json.latestScore).toMatchObject({ analyzer: "openai", audience: "คนทำงานที่ฟังเพลงระหว่างเดินทาง" });
    const usage = await t.db.select().from(providerUsageCosts).where(eq(providerUsageCosts.operation, "product.analyze"));
    expect(usage[0].costUsd).toBeGreaterThan(0);

    // budget exhausted → job fails permanently, no API call, no fabricated score
    await setSetting(t.db, t.workspaceId, "budget", { dailyUsd: 0.000001, monthlyUsd: 100, perVideoUsd: 1, fxThbPerUsd: 36 });
    await callRoute(t.db, analyzeRoute.POST, { body: { productIds: [pid] } });
    expect(await drainQueue(t.db)).toEqual(["failed"]);
    expect(calls).toHaveLength(1);
    const failed = await t.db.select().from(jobs).where(eq(jobs.status, "failed"));
    expect(failed.at(-1)?.lastError).toContain("งบประมาณ");
    await setSetting(t.db, t.workspaceId, "ai.mode", "demo");
  });
});

describe("marketplace connections", () => {
  it("stores credentials encrypted, returns only masked values; admin-only", async () => {
    expect((await callRoute(t.db, connSaveRoute.POST, { as: "editor", params: { platform: "shopee" }, body: { credentials: { appId: "1", secret: "x" } } })).status).toBe(403);
    const save = await callRoute(t.db, connSaveRoute.POST, { params: { platform: "shopee" }, body: { credentials: { appId: "12345", secret: "super-secret-value" } } });
    expect(save.status).toBe(200);
    const [row] = await t.db.select().from(marketplaceConnections).where(eq(marketplaceConnections.platform, "shopee"));
    expect(row.encryptedCredentials).not.toContain("super-secret-value");
    const list = await callRoute(t.db, connRoute.GET);
    const shopee = list.json.items.find((i: { platform: string }) => i.platform === "shopee");
    expect(JSON.stringify(list.json)).not.toContain("super-secret-value");
    expect(shopee.credentials).toEqual({ appId: "12345", secret: "••••alue", endpoint: null });
    expect(shopee.status).toBe("permission_pending");
  });

  it("sync requires a successful test; test uses the adapter", async () => {
    expect((await callRoute(t.db, connSyncRoute.POST, { params: { platform: "shopee" } })).status).toBe(409);
    __setMarketplaceProvider("shopee", {
      ...shopeeProvider,
      testConnection: async () => ({ status: "connected", message: "ok" }),
      fetchOffers: async () => ({ items: [{ platform: "shopee", externalProductId: "API-1", title: "สินค้าจาก API", price: 199, commissionRate: 12 }], nextCursor: null }),
    });
    const test = await callRoute(t.db, connTestRoute.POST, { params: { platform: "shopee" } });
    expect(test.json.status).toBe("connected");
    const sync = await callRoute(t.db, connSyncRoute.POST, { params: { platform: "shopee" } });
    expect(sync.status).toBe(200);
    expect(await drainQueue(t.db)).toEqual(["succeeded"]);
    const list = await callRoute(t.db, productsRoute.GET, { url: "http://localhost/api/products?origin=api" });
    expect(list.json.items[0]).toMatchObject({ title: "สินค้าจาก API", data_origin: "api", est_commission: 23.88 });
    const lz = await callRoute(t.db, connSaveRoute.POST, { params: { platform: "lazada" }, body: { credentials: { appId: "k", secret: "s" } } });
    expect(lz.status).toBe(200);
    expect((await callRoute(t.db, connTestRoute.POST, { params: { platform: "lazada" } })).json.status).toBe("permission_pending");
  });
});
