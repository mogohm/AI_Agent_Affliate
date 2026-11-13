import type { ProductFacts, VideoScript, TemplateConfig } from "@/db/schema";

export type OfferOption = {
  offerId: string;
  productId: string;
  title: string;
  platform: string;
  price: number;
  rate: number | null;
  estCommission: number | null;
  score: number | null;
  origin: string;
  imageRights: string;
  categoryName: string | null;
};

export type TemplateRow = {
  id: string;
  key: string;
  name: string;
  style: string;
  description: string | null;
  version: number;
  prompt: string;
  config: TemplateConfig;
  isActive: boolean;
};

export type ProjectListItem = {
  id: string;
  title: string;
  status: string;
  language: string;
  renderMode: string;
  durationSec: number;
  aspectRatio: string;
  actualCostUsd: number;
  error: string | null;
  scriptGenerator: string | null;
  publishChannel: string | null;
  createdAt: string;
  updatedAt: string;
  productTitle: string;
  productOrigin: string;
  platform: string | null;
  templateName: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  downloadUrl: string | null;
};

export type SceneRow = {
  id: string;
  idx: number;
  durationSec: number;
  title: string;
  voiceover: string;
  caption: string;
  visualPrompt: string;
  shotType: "hook" | "problem" | "solution" | "showcase" | "benefit" | "cta";
  imageUrl: string | null;
  videoUrl: string | null;
};

export type JobRowLite = {
  id: string;
  type: string;
  status: string;
  progress: number;
  progressMessage: string | null;
  lastError: string | null;
  attempts: number;
  maxAttempts: number;
  result: Record<string, unknown> | null;
  createdAt: string;
  finishedAt: string | null;
};

export type ProjectBundle = {
  project: {
    id: string;
    title: string;
    status: string;
    language: "th" | "en";
    renderMode: "hybrid" | "generative";
    aspectRatio: string;
    durationSec: number;
    voice: "none" | "female" | "male";
    subtitles: boolean;
    disclosure: boolean;
    music: "none" | "calm" | "upbeat";
    visualStyle: string;
    script: VideoScript | null;
    facts: ProductFacts | null;
    scriptGenerator: string | null;
    estimatedCostUsd: number | null;
    actualCostUsd: number;
    error: string | null;
    approvedAt: string | null;
    publishedAt: string | null;
    publishChannel: string | null;
    publishNote: string | null;
    createdAt: string;
    updatedAt: string;
  };
  scenes: SceneRow[];
  product: { id: string; title: string; brand: string | null; imageRights: string; dataOrigin: string; demoEmoji: string | null } | null;
  offer: { id: string; platform: string; price: number; shopName: string | null; productUrl: string | null; affiliateUrl: string | null } | null;
  template: { id: string; key: string; name: string; style: string; version: number; config: TemplateConfig } | null;
  score: { score: number | null; confidence: number; analyzer: string; explanation: string; needsReview: boolean; createdAt: string } | null;
  jobs: JobRowLite[];
  assets: { id: string; kind: string; source: string; provider: string | null; rightsNote: string | null; createdAt: string; bytes: number; url: string }[];
  urls: { video: string | null; download: string | null; thumbnail: string | null; subtitle: string | null };
  estimate: { totalUsd: number; lines: { label: string; usd: number }[] };
};

export const VISUAL_STYLE_OPTIONS = [
  { value: "premium", label: "Premium Product Commercial" },
  { value: "minimal", label: "Minimal Clean" },
  { value: "lifestyle", label: "Lifestyle Home" },
  { value: "playful", label: "Playful Pastel" },
  { value: "tech", label: "Tech Cinematic" },
];
