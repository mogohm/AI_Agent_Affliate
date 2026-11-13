/**
 * Lazada Affiliate adapter — intentionally NOT connected.
 *
 * Lazada's public seller Open Platform API is not a substitute for affiliate product/commission
 * authorisation (brief §7). Until Lazada grants affiliate API access and documents the endpoints,
 * this adapter reports `permission_pending` and the workspace should import the authorised
 * Lazada affiliate export / CSV instead. Implement `fetchOffers` here once access is granted.
 */
import { MarketplaceError, type MarketplaceProvider } from "./types";

export const lazadaProvider: MarketplaceProvider = {
  platform: "lazada",
  version: "lazada-affiliate-pending",
  displayName: "Lazada Affiliate",
  capabilities: { productOffers: false, commissionRates: false, conversionReports: false, linkGeneration: false },
  requirements: [
    "ต้องได้รับอนุมัติสิทธิ์ API สำหรับ Lazada Affiliate (LazAffiliate) โดยตรงจาก Lazada",
    "Seller Open Platform API ไม่ใช่สิทธิ์ Affiliate — ห้ามใช้แทน",
    "ระหว่างรอสิทธิ์: ส่งออกรายการสินค้า/ค่าคอมจากหน้า Lazada Affiliate แล้วนำเข้า CSV",
  ],
  credentialFields: [
    { key: "appId", label: "App Key", secret: false },
    { key: "secret", label: "App Secret", secret: true },
    { key: "endpoint", label: "Affiliate API Endpoint (จากเอกสารที่ได้รับอนุมัติ)", secret: false },
  ],
  async testConnection(creds) {
    if (!creds.appId || !creds.secret) return { status: "disconnected", message: "ยังไม่ได้กรอกข้อมูลเชื่อมต่อ" };
    return {
      status: "permission_pending",
      message: "บันทึกข้อมูลแล้ว แต่ระบบยังไม่เปิดใช้ Lazada Affiliate API จนกว่าจะยืนยันเอกสาร/สิทธิ์ที่ได้รับอนุมัติ — ใช้ CSV ระหว่างนี้",
    };
  },
  async fetchOffers() {
    throw new MarketplaceError("Lazada affiliate API access has not been granted/implemented", "permission");
  },
};
