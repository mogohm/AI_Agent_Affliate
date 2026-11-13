import { describe, expect, it } from "vitest";
import { autoMapColumns, mapAndValidateRow, missingRequiredFields } from "@/lib/catalog/csv";

describe("autoMapColumns", () => {
  it("maps Shopee product-feed style headers", () => {
    const m = autoMapColumns(["Item Id", "Product Name", "Price", "Commission Rate", "Product Link", "Offer Link", "Image Link", "Shop Name", "Sales", "Item Rating", "Global Category1"]);
    expect(m).toMatchObject({
      "Item Id": "externalProductId",
      "Product Name": "title",
      Price: "price",
      "Commission Rate": "commissionRate",
      "Product Link": "productUrl",
      "Offer Link": "affiliateUrl",
      "Image Link": "imageUrl",
      "Shop Name": "shopName",
      Sales: "soldCount",
      "Item Rating": "rating",
      "Global Category1": "sourceCategory",
    });
  });
  it("maps Thai headers and ignores unknown columns", () => {
    const m = autoMapColumns(["รหัสสินค้า", "ชื่อสินค้า", "ราคา", "ค่าคอม %", "หมายเหตุภายใน"]);
    expect(m).toEqual({ รหัสสินค้า: "externalProductId", ชื่อสินค้า: "title", ราคา: "price", "ค่าคอม %": "commissionRate", หมายเหตุภายใน: "" });
    expect(missingRequiredFields(m)).toEqual([]);
    expect(missingRequiredFields({ a: "title" })).toEqual(["externalProductId", "price"]);
  });
});

describe("mapAndValidateRow", () => {
  const mapping = { id: "externalProductId", name: "title", price: "price", rate: "commissionRate", url: "productUrl", platform: "platform" } as const;
  it("parses Thai-formatted numbers and percent signs", () => {
    const r = mapAndValidateRow({ id: "A1", name: "หูฟังไร้สาย", price: "฿1,290", rate: "10.5%", url: "https://shopee.co.th/x", platform: "Shopee" }, mapping);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ platform: "shopee", price: 1290, commissionRate: 10.5, productUrl: "https://shopee.co.th/x" });
  });
  it("leaves missing optional facts as null (no invention)", () => {
    const r = mapAndValidateRow({ id: "A1", name: "สินค้า", price: "100", rate: "" }, mapping, { defaultPlatform: "lazada" });
    expect(r.ok && r.value.commissionRate).toBeNull();
    expect(r.ok && r.value.soldCount).toBeNull();
    expect(r.ok && r.value.platform).toBe("lazada");
  });
  it("reports validation errors per field", () => {
    const bad = mapAndValidateRow({ id: "", name: "x", price: "abc", rate: "150", url: "javascript:alert(1)" }, mapping, { defaultPlatform: "shopee" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toContain("externalProductId");
      expect(bad.error).toContain("price");
      expect(bad.error).toContain("commissionRate");
      expect(bad.error).toContain("productUrl");
    }
    const noPlatform = mapAndValidateRow({ id: "1", name: "สินค้า", price: "10" }, { id: "externalProductId", name: "title", price: "price" });
    expect(noPlatform.ok).toBe(false);
  });
});
