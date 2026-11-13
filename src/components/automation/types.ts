export type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  conditions: {
    minCommissionAmount?: number | null;
    minCommissionRate?: number | null;
    minScore?: number | null;
    minConfidence?: number | null;
    categoryIds?: string[];
    marketplaces?: ("shopee" | "lazada")[];
    excludeAlreadyProduced?: boolean;
    requireAuthorizedImage?: boolean;
  };
  actions: {
    templateKey: string;
    language: "th" | "en";
    renderMode: "hybrid" | "generative";
    videosPerDay: number;
    autoGenerateScript: boolean;
    autoRender: boolean;
    requireApproval: true;
    maxCostPerVideoUsd?: number | null;
  };
  schedule: "manual" | "daily";
  scheduleTime: string;
  lastRunAt: string | null;
  createdToday: number;
};

export type Overview = {
  pipeline: Record<"imported" | "scored" | "highOpportunity" | "creative" | "rendering" | "review" | "approved" | "published" | "failed", number>;
  projectsToday: number;
  categories: { id: string; name: string }[];
  templates: { key: string; name: string; version: number }[];
  budget: { limits: { dailyUsd: number; monthlyUsd: number; perVideoUsd: number }; spentTodayUsd: number; spentMonthUsd: number };
  aiMode: "demo" | "live";
};

export type RunResult = {
  runId: string;
  dryRun: boolean;
  status: "succeeded" | "partial" | "failed" | "skipped";
  message: string;
  matched: number;
  quotaRemaining: number;
  planned: {
    offerId: string;
    productId: string;
    title: string;
    platform: string;
    categoryName: string | null;
    price: number;
    commissionRate: number | null;
    estCommission: number | null;
    score: number | null;
    confidence: number | null;
    dataOrigin: string;
    reasons: string[];
  }[];
  rejected: { offerId: string; title: string; reason: string }[];
  createdProjectIds: string[];
  estimatePerVideoUsd: number;
  estimateTotalUsd: number;
  aiMode: "demo" | "live";
  budget?: { ok: boolean; reason: string | null; spentTodayUsd: number; spentMonthUsd: number };
  errors: { offerId: string; error: string }[];
};

export type RunRow = {
  id: string;
  ruleId: string;
  ruleName: string | null;
  dryRun: boolean;
  trigger: "manual" | "schedule";
  matched: number;
  createdProjects: number;
  status: string;
  message: string | null;
  createdAt: string;
};
