import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mapShopeeNode, shopeeAuthHeader, shopeeProvider, shopeeSignature } from "@/lib/marketplace/shopee";
import { lazadaProvider } from "@/lib/marketplace/lazada";

afterEach(() => vi.unstubAllGlobals());

describe("Shopee affiliate adapter", () => {
  it("signs SHA256(appId + timestamp + payload + secret)", () => {
    const expected = crypto.createHash("sha256").update("123" + "1700000000" + '{"q":1}' + "sec").digest("hex");
    expect(shopeeSignature("123", 1700000000, '{"q":1}', "sec")).toBe(expected);
    expect(shopeeAuthHeader("123", 1700000000, '{"q":1}', "sec")).toBe(`SHA256 Credential=123, Timestamp=1700000000, Signature=${expected}`);
  });

  it("calls the GraphQL endpoint with a signed header and maps offers", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      const ts = Number(/Timestamp=(\d+)/.exec(auth)![1]);
      expect(auth).toBe(shopeeAuthHeader("app", ts, String(init.body), "s3cret"));
      return new Response(
        JSON.stringify({
          data: {
            productOfferV2: {
              nodes: [{ itemId: 42, productName: "หูฟัง", shopId: 7, shopName: "Shop", price: "1290", commissionRate: "0.105", sales: 900, ratingStar: "4.7", offerLink: "https://s.shopee.co.th/abc" }],
              pageInfo: { page: 1, limit: 20, hasNextPage: true },
            },
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await shopeeProvider.fetchOffers({ appId: "app", secret: "s3cret" }, { keyword: "หูฟัง" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("https://open-api.affiliate.shopee.co.th/graphql");
    expect(r.nextCursor).toBe("2");
    expect(r.items[0]).toMatchObject({ platform: "shopee", externalProductId: "42", shopId: "7", price: 1290, commissionRate: 10.5, soldCount: 900, rating: 4.7, imageRights: "unknown", commissionIsEstimated: false });
  });

  it("maps auth / rate-limit errors to connection statuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    expect((await shopeeProvider.testConnection({ appId: "a", secret: "b" })).status).toBe("rate_limited");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "Invalid Signature", extensions: { code: 10020 } }] }), { status: 200 })));
    expect((await shopeeProvider.testConnection({ appId: "a", secret: "b" })).status).toBe("permission_pending");
    expect((await shopeeProvider.testConnection({})).status).toBe("disconnected");
  });

  it("keeps missing facts null", () => {
    const p = mapShopeeNode({ itemId: 1, productName: "x" });
    expect(p.commissionRate).toBeNull();
    expect(p.soldCount).toBeNull();
  });
});

describe("Lazada adapter", () => {
  it("never claims a connection without approved access", async () => {
    expect((await lazadaProvider.testConnection({ appId: "a", secret: "b" })).status).toBe("permission_pending");
    await expect(lazadaProvider.fetchOffers({}, {})).rejects.toThrow();
  });
});
