import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, type TestCtx } from "../helpers";
import { jobs, products, commissionSnapshots, marketplaceOffers } from "@/db/schema";
import { enqueueJob, claimNextJob, failJob, completeJob, recoverStaleJobs, retryJob, cancelJob } from "@/lib/jobs/queue";
import { listOffers, upsertProductOffer } from "@/lib/catalog/service";
import { checkBudget, recordUsage } from "@/lib/ai/usage";
import { setSetting } from "@/lib/settings";
import { loadSessionFromToken } from "@/lib/auth/session";
import { signSession } from "@/lib/auth/token";
import { authenticate } from "@/lib/auth/session";

let t: TestCtx;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("bootstrap & auth", () => {
  it("seeds demo catalogue flagged as demo", async () => {
    const rows = await t.db.select().from(products).where(eq(products.workspaceId, t.workspaceId));
    expect(rows.length).toBe(8);
    expect(rows.every((r) => r.dataOrigin === "demo")).toBe(true);
  });
  it("authenticates seeded admin and rejects bad password", async () => {
    expect(await authenticate("admin@example.com", "ChangeMe!2026")).not.toBeNull();
    expect(await authenticate("admin@example.com", "wrong")).toBeNull();
  });
  it("rejects tampered or foreign tokens", async () => {
    expect(await loadSessionFromToken("garbage")).toBeNull();
    const forged = await signSession({ sub: "00000000-0000-0000-0000-000000000000", ws: t.workspaceId, sv: 1 }, process.env.AUTH_SECRET!);
    expect(await loadSessionFromToken(forged)).toBeNull();
  });
});

describe("catalog upsert & explorer", () => {
  it("sorts by commission amount by default and computes caps in SQL", async () => {
    const { items, total } = await listOffers(t.db, t.workspaceId, {});
    expect(total).toBe(8);
    const amounts = items.map((i) => i.est_commission ?? -1);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
    expect(items[0].est_commission).toBeCloseTo(160.55, 2); // 1690 × 9.5%
  });
  it("updates same offer identity and appends commission snapshot only when terms change", async () => {
    const input = { platform: "shopee" as const, externalProductId: "T-1", shopId: "s1", title: "ทดสอบ หูฟัง", price: 1000, commissionRate: 10, capAmount: 50 };
    const a = await upsertProductOffer(t.db, t.workspaceId, input, "csv");
    const b = await upsertProductOffer(t.db, t.workspaceId, input, "csv");
    const c = await upsertProductOffer(t.db, t.workspaceId, { ...input, commissionRate: 12 }, "csv");
    expect(a.status).toBe("inserted");
    expect(b.status).toBe("updated");
    expect(b.commissionChanged).toBe(false);
    expect(c.commissionChanged).toBe(true);
    const snaps = await t.db.select().from(commissionSnapshots).where(eq(commissionSnapshots.offerId, a.offerId));
    expect(snaps.length).toBe(2);
    const { items } = await listOffers(t.db, t.workspaceId, { search: "ทดสอบ" });
    expect(items[0].est_commission).toBe(50); // capped
  });
  it("merges strong identity across marketplaces, flags title-only duplicates", async () => {
    const x = await upsertProductOffer(t.db, t.workspaceId, { platform: "shopee", externalProductId: "G-1", title: "Gadget A", gtin: "8851234567890", price: 100 }, "csv");
    const y = await upsertProductOffer(t.db, t.workspaceId, { platform: "lazada", externalProductId: "G-9", title: "Different name", gtin: "8851234567890", price: 110 }, "csv");
    expect(y.status).toBe("merged");
    expect(y.productId).toBe(x.productId);
    const offers = await t.db.select().from(marketplaceOffers).where(eq(marketplaceOffers.productId, x.productId));
    expect(offers.length).toBe(2);
    const z = await upsertProductOffer(t.db, t.workspaceId, { platform: "lazada", externalProductId: "D-1", title: "ไฟวงแหวนสำหรับครีเอเตอร์ 10 นิ้ว พร้อมขาตั้ง", price: 900 }, "csv");
    expect(z.status).toBe("inserted");
    expect(z.possibleDuplicateOf).toBeTruthy();
  });
});

describe("job queue", () => {
  it("enqueues idempotently, claims, retries with backoff then dead-letters", async () => {
    const a = await enqueueJob(t.db, { workspaceId: t.workspaceId, type: "product.analyze", payload: {}, idempotencyKey: "k1", maxAttempts: 2 });
    const b = await enqueueJob(t.db, { workspaceId: t.workspaceId, type: "product.analyze", payload: {}, idempotencyKey: "k1" });
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    const claimed = await claimNextJob(t.db, "w1");
    expect(claimed?.id).toBe(a.job.id);
    expect(await claimNextJob(t.db, "w2")).toBeNull(); // locked
    expect(await failJob(t.db, claimed!, "boom")).toBe(true); // will retry later (run_at in future)
    expect(await claimNextJob(t.db, "w1")).toBeNull();
    await t.db.update(jobs).set({ runAt: new Date(0) }).where(eq(jobs.id, a.job.id));
    const again = await claimNextJob(t.db, "w1");
    expect(again?.attempts).toBe(2);
    expect(await failJob(t.db, again!, "boom2")).toBe(false);
    const [row] = await t.db.select().from(jobs).where(eq(jobs.id, a.job.id));
    expect(row.status).toBe("failed");
    const retried = await retryJob(t.db, a.job.id);
    expect(retried?.status).toBe("queued");
    const c = await claimNextJob(t.db, "w1");
    await completeJob(t.db, c!.id, { ok: 1 });
  });
  it("recovers stale running jobs after a worker crash and supports cancel", async () => {
    const { job } = await enqueueJob(t.db, { workspaceId: t.workspaceId, type: "product.analyze", payload: {} });
    await claimNextJob(t.db, "dead-worker");
    await t.db.update(jobs).set({ lockedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(jobs.id, job.id));
    expect(await recoverStaleJobs(t.db)).toBe(1);
    const [row] = await t.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row.status).toBe("queued");
    expect((await cancelJob(t.db, job.id))?.status).toBe("canceled");
  });
});

describe("budget guard", () => {
  it("blocks work that would exceed the daily budget", async () => {
    await setSetting(t.db, t.workspaceId, "budget", { dailyUsd: 1, monthlyUsd: 10, perVideoUsd: 0.5, fxThbPerUsd: 36 });
    expect((await checkBudget(t.db, t.workspaceId, 0.2)).ok).toBe(true);
    await recordUsage(t.db, { workspaceId: t.workspaceId, provider: "openai", operation: "test", units: 1, unit: "requests", costUsd: 0.9 });
    const r = await checkBudget(t.db, t.workspaceId, 0.2);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("งบรายวัน");
    expect((await checkBudget(t.db, t.workspaceId, 0.6, { perVideo: true })).ok).toBe(false);
    expect((await checkBudget(t.db, t.workspaceId, 0)).ok).toBe(true); // demo work is free
  });
});
