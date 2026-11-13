import { describe, expect, it } from "vitest";
import { normalizePlatform, normalizeStatus, parseAmount, parseReportDate } from "@/lib/analytics/importer";
import { applyMapping, autoMapHeaders, ORDER_FIELDS, CLICK_FIELDS } from "@/lib/analytics/import-fields";

describe("report import normalisation", () => {
  it("normalises commission statuses (Thai/English)", () => {
    expect(normalizeStatus("Pending")).toBe("pending");
    expect(normalizeStatus("รอดำเนินการ")).toBe("pending");
    expect(normalizeStatus("Unpaid")).toBe("pending");
    expect(normalizeStatus("Completed")).toBe("approved");
    expect(normalizeStatus("Validated")).toBe("approved");
    expect(normalizeStatus("Paid")).toBe("paid");
    expect(normalizeStatus("Cancelled")).toBe("reversed");
    expect(normalizeStatus("ไม่สำเร็จ")).toBe("reversed");
    expect(normalizeStatus("???")).toBeNull();
    expect(normalizeStatus("")).toBeNull();
  });
  it("normalises platform with fallback", () => {
    expect(normalizePlatform("Shopee TH")).toBe("shopee");
    expect(normalizePlatform("LAZADA")).toBe("lazada");
    expect(normalizePlatform("", "lazada")).toBe("lazada");
    expect(normalizePlatform("tiktok", "lazada")).toBeNull();
  });
  it("parses dates in Bangkok time incl. Buddhist years", () => {
    expect(parseReportDate("2026-11-01")?.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(parseReportDate("01/11/2569 10:30")?.toISOString()).toBe("2026-11-01T03:30:00.000Z");
    expect(parseReportDate("2026-11-01T10:00:00Z")?.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(parseReportDate("not a date")).toBeNull();
  });
  it("parses amounts with currency symbols", () => {
    expect(parseAmount("฿1,234.50")).toBe(1234.5);
    expect(parseAmount("12 บาท")).toBe(12);
    expect(parseAmount("abc")).toBeNull();
  });
  it("auto-maps headers and applies mapping", () => {
    const m = autoMapHeaders(["Order ID", "Sub_ID", "Commission", "Status", "Order Date", "Platform"], ORDER_FIELDS);
    expect(m).toMatchObject({ orderRef: "Order ID", subId: "Sub_ID", commission: "Commission", status: "Status", orderedAt: "Order Date", platform: "Platform" });
    expect(applyMapping([{ "Order ID": " A1 ", Commission: "10" }], { orderRef: "Order ID", commission: "Commission" })).toEqual([{ orderRef: "A1", commission: "10" }]);
    expect(autoMapHeaders(["วันที่", "จำนวนคลิก"], CLICK_FIELDS)).toEqual({ date: "วันที่", clicks: "จำนวนคลิก" });
  });
});
