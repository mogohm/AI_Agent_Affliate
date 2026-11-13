import type { JobType } from "./queue";
import type { JobHandler } from "./types";

/** Lazy handler registry — each module owns its job implementation. */
export const JOB_HANDLERS: Record<JobType, () => Promise<JobHandler>> = {
  "video.generate_script": () => import("@/lib/video/jobs").then((m) => m.handleGenerateScript),
  "video.render": () => import("@/lib/video/jobs").then((m) => m.handleRender),
  "product.analyze": () => import("@/lib/catalog/analyze").then((m) => m.handleAnalyzeJob),
  "automation.run": () => import("@/lib/automation/engine").then((m) => m.handleAutomationJob),
  "marketplace.sync": () => import("@/lib/marketplace/sync").then((m) => m.handleMarketplaceSyncJob),
};

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  "video.generate_script": "สร้างสคริปต์ + Storyboard",
  "video.render": "เรนเดอร์วิดีโอ",
  "product.analyze": "AI วิเคราะห์สินค้า",
  "automation.run": "รันกฎอัตโนมัติ",
  "marketplace.sync": "ซิงก์ Marketplace",
};
