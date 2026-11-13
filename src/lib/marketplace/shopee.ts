/**
 * Shopee Affiliate Open API adapter (Thailand).
 *
 * Access requires an approved Shopee Affiliate Open API application (see brief §7 — eligibility
 * criteria apply). The request signing and the `productOfferV2` query follow Shopee's published
 * affiliate Open API conventions; VERIFY field names and limits against the documentation you
 * receive with your approved credentials before relying on production data.
 */
import crypto from "node:crypto";
import type { ProductInput } from "@/lib/catalog/service";
import { MarketplaceError, type ConnectionTestResult, type FetchOffersQuery, type FetchOffersResult, type MarketplaceCredentials, type MarketplaceProvider } from "./types";

export const SHOPEE_DEFAULT_ENDPOINT = "https://open-api.affiliate.shopee.co.th/graphql";

/** Signature = SHA256(appId + timestamp + payload + secret), hex. */
export function shopeeSignature(appId: string, timestamp: number, payload: string, secret: string): string {
  return crypto.createHash("sha256").update(`${appId}${timestamp}${payload}${secret}`).digest("hex");
}

export function shopeeAuthHeader(appId: string, timestamp: number, payload: string, secret: string): string {
  return `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${shopeeSignature(appId, timestamp, payload, secret)}`;
}

const PRODUCT_OFFER_QUERY = `query ProductOffers($keyword: String, $page: Int, $limit: Int) {
  productOfferV2(keyword: $keyword, page: $page, limit: $limit) {
    nodes {
      itemId productName shopId shopName price priceMin priceMax
      commissionRate sellerCommissionRate shopeeCommissionRate commission
      sales ratingStar imageUrl productLink offerLink productCatIds periodStartTime periodEndTime
    }
    pageInfo { page limit hasNextPage }
  }
}`;

type ShopeeNode = {
  itemId: number | string;
  productName: string;
  shopId?: number | string;
  shopName?: string;
  price?: string | number;
  priceMin?: string | number;
  commissionRate?: string | number;
  sellerCommissionRate?: string | number;
  shopeeCommissionRate?: string | number;
  sales?: number;
  ratingStar?: string | number;
  imageUrl?: string;
  productLink?: string;
  offerLink?: string;
  periodStartTime?: number;
  periodEndTime?: number;
};

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** Shopee returns rates as fractions ("0.1" = 10%). Convert to percent. */
const ratePct = (v: unknown) => {
  const n = toNum(v);
  if (n === null) return null;
  return n <= 1 ? Math.round(n * 100_000) / 1000 : n;
};

export function mapShopeeNode(n: ShopeeNode): ProductInput {
  const price = toNum(n.price) ?? toNum(n.priceMin) ?? 0;
  return {
    platform: "shopee",
    externalProductId: String(n.itemId),
    shopId: n.shopId !== undefined ? String(n.shopId) : "",
    shopName: n.shopName ?? null,
    title: n.productName,
    price,
    commissionRate: ratePct(n.commissionRate),
    sellerRate: ratePct(n.sellerCommissionRate),
    platformRate: ratePct(n.shopeeCommissionRate),
    commissionIsEstimated: false,
    commissionSource: "Shopee Affiliate Open API productOfferV2",
    soldCount: toNum(n.sales),
    rating: toNum(n.ratingStar),
    imageUrl: n.imageUrl ?? null,
    // Images are marketplace listing photos; usage rights for video must be confirmed by a human.
    imageRights: "unknown",
    productUrl: n.productLink ?? null,
    affiliateUrl: n.offerLink ?? null,
    sourceUpdatedAt: new Date(),
  };
}

type GqlResponse = {
  data?: { productOfferV2?: { nodes: ShopeeNode[]; pageInfo: { page: number; limit: number; hasNextPage: boolean } } };
  errors?: { message: string; extensions?: { code?: number | string } }[];
};

export const shopeeProvider: MarketplaceProvider = {
  platform: "shopee",
  version: "shopee-affiliate-graphql-v2",
  displayName: "Shopee Affiliate Open API",
  capabilities: { productOffers: true, commissionRates: true, conversionReports: false, linkGeneration: false },
  requirements: [
    "ต้องได้รับอนุมัติ Shopee Affiliate Open API (มีเกณฑ์คุณสมบัติ เช่น ยอดออเดอร์/ช่องทาง)",
    "กรอก App ID และ Secret ที่ได้รับจาก Shopee Affiliate",
    "ตรวจสอบชื่อฟิลด์/โควตากับเอกสาร API ที่ได้รับเมื่ออนุมัติ",
    "ระหว่างรอสิทธิ์: ใช้ Product Feed / CSV ที่ดาวน์โหลดจาก Shopee Affiliate",
  ],
  credentialFields: [
    { key: "appId", label: "App ID", secret: false },
    { key: "secret", label: "Secret", secret: true },
    { key: "endpoint", label: "Endpoint (ไม่บังคับ)", secret: false },
  ],

  async testConnection(creds) {
    if (!creds.appId || !creds.secret) return { status: "disconnected", message: "ยังไม่ได้กรอก App ID / Secret" };
    try {
      await this.fetchOffers(creds, { limit: 1 });
      return { status: "connected", message: "เชื่อมต่อสำเร็จ (ทดสอบดึงสินค้า 1 รายการ)" };
    } catch (e) {
      return errorToStatus(e);
    }
  },

  async fetchOffers(creds: MarketplaceCredentials, query: FetchOffersQuery): Promise<FetchOffersResult> {
    if (!creds.appId || !creds.secret) throw new MarketplaceError("Missing Shopee credentials", "auth");
    const page = query.cursor ? Number(query.cursor) : 1;
    const payload = JSON.stringify({ query: PRODUCT_OFFER_QUERY, variables: { keyword: query.keyword ?? null, page, limit: Math.min(50, query.limit ?? 20) } });
    const ts = Math.floor(Date.now() / 1000);
    let res: Response;
    try {
      res = await fetch(creds.endpoint || SHOPEE_DEFAULT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: shopeeAuthHeader(creds.appId, ts, payload, creds.secret) },
        body: payload,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new MarketplaceError(`Network error: ${e instanceof Error ? e.message : String(e)}`, "network");
    }
    if (res.status === 429) throw new MarketplaceError("Shopee rate limit reached", "rate_limited");
    if (res.status === 401 || res.status === 403) throw new MarketplaceError(`Shopee rejected credentials (HTTP ${res.status})`, "auth");
    if (!res.ok) throw new MarketplaceError(`Shopee HTTP ${res.status}`, "network");
    const body = (await res.json()) as GqlResponse;
    if (body.errors?.length) {
      const msg = body.errors.map((e) => e.message).join("; ");
      const code = String(body.errors[0].extensions?.code ?? "");
      if (/rate|limit/i.test(msg) || code === "10030") throw new MarketplaceError(msg, "rate_limited");
      if (/auth|signature|permission|credential/i.test(msg) || code.startsWith("100")) throw new MarketplaceError(msg, "auth");
      throw new MarketplaceError(msg, "invalid_response");
    }
    const conn = body.data?.productOfferV2;
    if (!conn) throw new MarketplaceError("Unexpected Shopee response shape", "invalid_response");
    return { items: conn.nodes.map(mapShopeeNode), nextCursor: conn.pageInfo.hasNextPage ? String(page + 1) : null };
  },
};

export function errorToStatus(e: unknown): ConnectionTestResult {
  if (e instanceof MarketplaceError) {
    if (e.kind === "rate_limited") return { status: "rate_limited", message: e.message, rateLimitResetAt: new Date(Date.now() + 60 * 60_000) };
    if (e.kind === "auth" || e.kind === "permission") return { status: "permission_pending", message: e.message };
    return { status: "sync_failed", message: e.message };
  }
  return { status: "sync_failed", message: e instanceof Error ? e.message : String(e) };
}
