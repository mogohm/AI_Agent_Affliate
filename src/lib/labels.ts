/** Display labels & badge tones for enums (client-safe). */
export type Tone = "default" | "green" | "orange" | "rose" | "muted" | "blue";

export const ORIGIN_LABEL: Record<string, { label: string; tone: Tone; hint: string }> = {
  demo: { label: "DEMO", tone: "orange", hint: "ข้อมูลจำลองสำหรับทดสอบ ไม่ใช่ข้อมูลจริง" },
  csv: { label: "CSV", tone: "blue", hint: "นำเข้าจากไฟล์ CSV ที่ได้รับอนุญาต" },
  feed: { label: "FEED", tone: "blue", hint: "นำเข้าจาก Product Feed ที่ได้รับอนุญาต" },
  manual: { label: "MANUAL", tone: "muted", hint: "เพิ่มด้วยตนเอง" },
  api: { label: "API", tone: "green", hint: "ดึงจาก Official API ที่ได้รับสิทธิ์" },
};

export const VIDEO_STATUS: Record<string, { label: string; tone: Tone; group: LibraryGroup }> = {
  created: { label: "ร่าง", tone: "muted", group: "draft" },
  script_generating: { label: "กำลังสร้างสคริปต์", tone: "orange", group: "processing" },
  awaiting_approval: { label: "รออนุมัติสคริปต์", tone: "default", group: "draft" },
  queued_render: { label: "รอคิวเรนเดอร์", tone: "orange", group: "processing" },
  asset_generation: { label: "กำลังสร้างภาพ/เสียง", tone: "orange", group: "processing" },
  rendering: { label: "กำลังเรนเดอร์", tone: "orange", group: "processing" },
  quality_review: { label: "รอตรวจคุณภาพ", tone: "blue", group: "review" },
  approved: { label: "อนุมัติแล้ว", tone: "green", group: "approved" },
  exported: { label: "ส่งออกแล้ว", tone: "green", group: "approved" },
  published: { label: "เผยแพร่แล้ว", tone: "green", group: "published" },
  failed: { label: "ล้มเหลว", tone: "rose", group: "failed" },
  canceled: { label: "ยกเลิก", tone: "rose", group: "failed" },
};

export type LibraryGroup = "draft" | "processing" | "review" | "approved" | "published" | "failed";
export const LIBRARY_GROUPS: { key: LibraryGroup; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "processing", label: "Processing" },
  { key: "review", label: "Review" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" },
  { key: "failed", label: "Failed" },
];

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "รอคิว", tone: "default" },
  running: { label: "กำลังทำงาน", tone: "orange" },
  succeeded: { label: "สำเร็จ", tone: "green" },
  failed: { label: "ล้มเหลว", tone: "rose" },
  canceled: { label: "ยกเลิก", tone: "muted" },
};

export const CONNECTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  disconnected: { label: "ยังไม่เชื่อมต่อ", tone: "orange" },
  permission_pending: { label: "รอสิทธิ์ API", tone: "orange" },
  connected: { label: "เชื่อมต่อแล้ว", tone: "green" },
  sync_failed: { label: "ซิงก์ล้มเหลว", tone: "rose" },
  rate_limited: { label: "ติด Rate limit", tone: "rose" },
  stale: { label: "ข้อมูลเก่า", tone: "orange" },
  csv_only: { label: "ใช้ CSV/Feed", tone: "blue" },
};

export const PLATFORM_LABEL: Record<string, { label: string; className: string }> = {
  shopee: { label: "Shopee", className: "text-[#ff8659]" },
  lazada: { label: "Lazada", className: "text-[#c78eff]" },
};

export const COMMISSION_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "รอตรวจสอบ", tone: "orange" },
  approved: { label: "อนุมัติแล้ว", tone: "green" },
  paid: { label: "จ่ายแล้ว", tone: "green" },
  reversed: { label: "ยกเลิก/คืนเงิน", tone: "rose" },
};
