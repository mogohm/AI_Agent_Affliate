/** Client-safe job type labels (the server registry lives in lib/jobs/handlers.ts). */
export const JOB_TYPES: { key: string; label: string }[] = [
  { key: "video.generate_script", label: "สร้างสคริปต์ + Storyboard" },
  { key: "video.render", label: "เรนเดอร์วิดีโอ" },
  { key: "product.analyze", label: "AI วิเคราะห์สินค้า" },
  { key: "automation.run", label: "รันกฎอัตโนมัติ" },
  { key: "marketplace.sync", label: "ซิงก์ Marketplace" },
];

export const jobTypeLabel = (t: string) => JOB_TYPES.find((x) => x.key === t)?.label ?? t;
