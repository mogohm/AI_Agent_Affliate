/**
 * First-run bootstrap: workspace, users, categories, templates and (optionally) DEMO data.
 * Demo rows are always stored with data_origin = 'demo' and are labelled as such in the UI.
 */
import { count, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  affiliateOrders,
  automationRules,
  categories,
  clickStats,
  creativeTemplates,
  dataSources,
  marketplaceConnections,
  users,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { DEFAULT_CATEGORIES } from "@/lib/core/categorize";
import { env, isTrue } from "@/lib/env";
import { hashPasswordRaw } from "@/lib/auth/password";
import { DEFAULT_TEMPLATES } from "@/lib/video/templates";
import { loadCatalogCache, upsertProductOffer, type ProductInput } from "@/lib/catalog/service";
import { rescoreProduct } from "@/lib/catalog/scoring-service";
import { bangkokDateString } from "@/lib/time";

const g = globalThis as unknown as { __bootstrapped?: Promise<void> };

/** Idempotent; safe to call on every login request. */
export function ensureBootstrap(db: Db): Promise<void> {
  if (!g.__bootstrapped) {
    g.__bootstrapped = bootstrap(db).catch((e) => {
      g.__bootstrapped = undefined;
      throw e;
    });
  }
  return g.__bootstrapped;
}

export function __resetBootstrapFlag() {
  g.__bootstrapped = undefined;
}

async function bootstrap(db: Db) {
  const [{ n }] = await db.select({ n: count() }).from(users);
  if (n > 0) return;
  const e = env();
  const [ws] = await db.insert(workspaces).values({ name: "AI Affiliate Studio", slug: "default" }).returning();
  const hash = await hashPasswordRaw(e.SEED_ADMIN_PASSWORD);
  const seedUsers = [
    { email: e.SEED_ADMIN_EMAIL.toLowerCase(), name: "Administrator", role: "admin" as const },
    { email: "editor@example.com", name: "Content Editor", role: "editor" as const },
    { email: "approver@example.com", name: "Content Approver", role: "approver" as const },
    { email: "viewer@example.com", name: "Read-only Viewer", role: "viewer" as const },
  ];
  for (const u of seedUsers) {
    const [row] = await db.insert(users).values({ email: u.email, name: u.name, passwordHash: hash }).returning();
    await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: row.id, role: u.role });
  }
  await seedWorkspaceBasics(db, ws.id);
  if (e.SEED_DEMO_DATA === undefined || isTrue(e.SEED_DEMO_DATA)) await seedDemoData(db, ws.id);
}

export async function seedWorkspaceBasics(db: Db, workspaceId: string) {
  await db
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map((c) => ({ workspaceId, ...c })))
    .onConflictDoNothing();
  await db
    .insert(creativeTemplates)
    .values(DEFAULT_TEMPLATES.map((t) => ({ workspaceId, ...t })))
    .onConflictDoNothing();
  await db
    .insert(marketplaceConnections)
    .values([
      { workspaceId, platform: "shopee" as const, status: "disconnected" as const },
      { workspaceId, platform: "lazada" as const, status: "disconnected" as const },
    ])
    .onConflictDoNothing();
}

/** Demo catalogue mirrors the design prototype. Commission rates are fictional. */
export const DEMO_PRODUCTS: (Omit<ProductInput, "commissionIsEstimated"> & { emoji: string })[] = [
  { platform: "shopee", externalProductId: "DEMO-001", shopId: "demo-shop-1", shopName: "Demo Creator Shop", title: "ไฟวงแหวนสำหรับครีเอเตอร์ 10 นิ้ว พร้อมขาตั้ง", brand: "DemoLight", price: 890, commissionRate: 12.5, rating: 4.8, ratingCount: 1240, soldCount: 5300, emoji: "🎥", description: "ไฟวงแหวน LED ปรับได้ 3 โทนสี 10 ระดับความสว่าง พร้อมขาตั้งปรับสูงได้ถึง 160 ซม. (ข้อมูลตัวอย่าง)", attributes: { "ขนาด": "10 นิ้ว", "โทนสี": "3 โทน", "ความสูงขาตั้ง": "160 ซม." }, trendScore: 72 },
  { platform: "lazada", externalProductId: "DEMO-002", shopId: "demo-shop-2", shopName: "Demo Home Store", title: "เครื่องดูดฝุ่นไร้สายขนาดเล็ก", brand: "DemoClean", price: 1690, commissionRate: 9.5, rating: 4.6, ratingCount: 830, soldCount: 2100, emoji: "🧹", description: "เครื่องดูดฝุ่นไร้สาย น้ำหนักเบา ชาร์จผ่าน USB-C ใช้งานต่อเนื่องประมาณ 25 นาที (ข้อมูลตัวอย่าง)", attributes: { "แบตเตอรี่": "25 นาที", "ชาร์จ": "USB-C" } },
  { platform: "shopee", externalProductId: "DEMO-003", shopId: "demo-shop-3", shopName: "Demo Gadget", title: "หูฟังบลูทูธสเตอริโอ True Wireless", brand: "DemoSound", price: 1290, commissionRate: 10.5, rating: 4.7, ratingCount: 2210, soldCount: 8900, emoji: "🎧", description: "หูฟังไร้สาย Bluetooth 5.3 เคสชาร์จ ใช้งานรวมสูงสุด 30 ชั่วโมง (ข้อมูลตัวอย่าง)", attributes: { Bluetooth: "5.3", "แบตเตอรี่รวม": "30 ชม." }, trendScore: 64 },
  { platform: "lazada", externalProductId: "DEMO-004", shopId: "demo-shop-2", shopName: "Demo Home Store", title: "เครื่องปั่นพกพา USB", brand: "DemoBlend", price: 790, commissionRate: 14, rating: 4.5, ratingCount: 640, soldCount: 3400, emoji: "🥤", description: "เครื่องปั่นพกพา ความจุ 380 มล. ชาร์จ USB (ข้อมูลตัวอย่าง)", attributes: { "ความจุ": "380 มล." } },
  { platform: "lazada", externalProductId: "DEMO-005", shopId: "demo-shop-4", shopName: "Demo Tech", title: "กล้องเว็บแคม Full HD 1080p", brand: "DemoCam", price: 1350, commissionRate: 7.5, rating: 4.4, ratingCount: 310, soldCount: 950, emoji: "📷", description: "เว็บแคม 1080p 30fps ไมค์ในตัว (ข้อมูลตัวอย่าง)", attributes: { "ความละเอียด": "1080p" } },
  { platform: "shopee", externalProductId: "DEMO-006", shopId: "demo-shop-5", shopName: "Demo Living", title: "หมอนรองคอเมมโมรี่โฟม", brand: null, price: 590, commissionRate: 16, rating: 4.3, ratingCount: 190, soldCount: null, emoji: "🛏️", description: "หมอนรองคอเมมโมรี่โฟม ปลอกถอดซักได้ (ข้อมูลตัวอย่าง)" },
  { platform: "lazada", externalProductId: "DEMO-007", shopId: "demo-shop-6", shopName: "Demo Health", title: "เครื่องชั่งน้ำหนักดิจิทัล", brand: "DemoFit", price: 650, commissionRate: 10, rating: null, ratingCount: null, soldCount: 400, emoji: "⚖️", description: "เครื่องชั่งน้ำหนักดิจิทัล หน้าจอ LED รองรับ 180 กก. (ข้อมูลตัวอย่าง)", attributes: { "รับน้ำหนัก": "180 กก." } },
  { platform: "shopee", externalProductId: "DEMO-008", shopId: "demo-shop-5", shopName: "Demo Living", title: "กล่องจัดระเบียบอเนกประสงค์", brand: null, price: 420, commissionRate: 14.5, rating: 4.6, ratingCount: 520, soldCount: 6100, emoji: "🗃️", description: "กล่องจัดระเบียบพับได้ (ข้อมูลตัวอย่าง)" },
];

export async function seedDemoData(db: Db, workspaceId: string) {
  const [src] = await db
    .insert(dataSources)
    .values({ workspaceId, name: "Demo sample data (ข้อมูลจำลอง)", type: "demo", permissionStatus: "authorized", licenseNote: "Fictional sample data generated for UI testing only" })
    .returning();
  const cache = await loadCatalogCache(db, workspaceId);
  const fetchedAt = new Date(Date.now() - 2 * 86_400_000);
  const productIds: string[] = [];
  for (const p of DEMO_PRODUCTS) {
    const { emoji, ...input } = p;
    const out = await upsertProductOffer(
      db,
      workspaceId,
      { ...input, imageRights: "unknown", attributes: { ...(input.attributes ?? {}), demo_emoji: emoji }, commissionIsEstimated: false, commissionSource: "DEMO — fictional rate" },
      "demo",
      { dataSourceId: src.id, cache, now: fetchedAt },
    );
    productIds.push(out.productId);
  }
  for (const id of productIds) await rescoreProduct(db, workspaceId, id);

  // Demo analytics — clearly flagged data_origin = demo
  const now = Date.now();
  const orders = [];
  const clicks = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let d = 0; d < 30; d++) {
    const day = new Date(now - d * 86_400_000);
    for (const platform of ["shopee", "lazada"] as const) {
      clicks.push({ workspaceId, platform, subId: "demo", date: bangkokDateString(day), clicks: Math.round(200 + rand() * 600), dataOrigin: "demo" as const });
      const n = Math.round(rand() * 4);
      for (let i = 0; i < n; i++) {
        const prod = DEMO_PRODUCTS[Math.floor(rand() * DEMO_PRODUCTS.length)];
        if (prod.platform !== platform) continue;
        const value = prod.price;
        const statusRoll = rand();
        const status = d > 20 ? (statusRoll > 0.1 ? "paid" : "reversed") : d > 7 ? (statusRoll > 0.15 ? "approved" : "reversed") : "pending";
        orders.push({
          workspaceId,
          platform,
          orderRef: `DEMO-ORD-${d}-${platform}-${i}`,
          itemRef: prod.externalProductId,
          subId: "demo",
          productRef: prod.externalProductId,
          orderValue: value,
          commission: Math.round(value * (prod.commissionRate ?? 0)) / 100,
          status: status as "pending" | "approved" | "paid" | "reversed",
          orderedAt: day,
          dataOrigin: "demo" as const,
        });
      }
    }
  }
  if (orders.length) await db.insert(affiliateOrders).values(orders).onConflictDoNothing();
  if (clicks.length) await db.insert(clickStats).values(clicks).onConflictDoNothing();

  const [cat] = await db.select().from(categories).where(eq(categories.workspaceId, workspaceId)).limit(1);
  await db.insert(automationRules).values({
    workspaceId,
    name: "ตัวอย่าง: ค่าคอม ≥ ฿50 และคะแนน ≥ 60",
    enabled: false,
    conditions: { minCommissionAmount: 50, minScore: 60, minConfidence: 0.3, categoryIds: cat ? [] : [], marketplaces: [], excludeAlreadyProduced: true },
    actions: { templateKey: "product-showcase", language: "th", renderMode: "hybrid", videosPerDay: 3, autoGenerateScript: true, autoRender: false, requireApproval: true, maxCostPerVideoUsd: 0.5 },
    schedule: "manual",
    scheduleTime: "09:00",
  });
}
