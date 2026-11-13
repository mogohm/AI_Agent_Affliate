/**
 * AI Affiliate Studio — database schema (PostgreSQL / Neon, Drizzle ORM).
 *
 * Conventions
 * - All timestamps are stored in UTC (`timestamptz`) and displayed in Asia/Bangkok.
 * - Every business row carries `workspace_id` (tenancy) and, where it holds external facts,
 *   a `data_origin` so demo/sample data can never be confused with imported or API data.
 * - Commission snapshots and render outputs are immutable (append-only) for traceability.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  real,
  date,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------- enums
export const roleEnum = pgEnum("role", ["admin", "editor", "approver", "viewer"]);
export const dataOriginEnum = pgEnum("data_origin", ["demo", "csv", "feed", "manual", "api"]);
export const marketplaceEnum = pgEnum("marketplace", ["shopee", "lazada"]);
export const connectionStatusEnum = pgEnum("connection_status", [
  "disconnected",
  "permission_pending",
  "connected",
  "sync_failed",
  "rate_limited",
  "stale",
  "csv_only",
]);
export const ingestionStatusEnum = pgEnum("ingestion_status", [
  "pending",
  "running",
  "completed",
  "completed_with_errors",
  "failed",
]);
export const videoStatusEnum = pgEnum("video_status", [
  "created",
  "script_generating",
  "awaiting_approval",
  "queued_render",
  "asset_generation",
  "rendering",
  "quality_review",
  "approved",
  "exported",
  "published",
  "failed",
  "canceled",
]);
export const renderModeEnum = pgEnum("render_mode", ["hybrid", "generative"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "canceled"]);
export const commissionStatusEnum = pgEnum("commission_status", ["pending", "approved", "paid", "reversed"]);
export const imageRightsEnum = pgEnum("image_rights", ["authorized", "unknown", "not_allowed"]);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });

// ---------------------------------------------------------------- identity & tenancy
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("viewer"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_ws_created_idx").on(t.workspaceId, t.createdAt)],
);

/** Workspace-scoped settings. Secrets are AES-256-GCM encrypted in `encrypted_value` and never sent to the browser. */
export const appSettings = pgTable(
  "app_settings",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>(),
    encryptedValue: text("encrypted_value"),
    isSecret: boolean("is_secret").notNull().default(false),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key] })],
);

// ---------------------------------------------------------------- data sources & ingestion
export const marketplaceConnections = pgTable(
  "marketplace_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    platform: marketplaceEnum("platform").notNull(),
    status: connectionStatusEnum("status").notNull().default("disconnected"),
    accountLabel: text("account_label"),
    authScope: text("auth_scope"),
    /** Encrypted JSON of credentials (app id / secret / tokens). Never returned to clients. */
    encryptedCredentials: text("encrypted_credentials"),
    lastSyncAt: ts("last_sync_at"),
    lastCheckedAt: ts("last_checked_at"),
    lastError: text("last_error"),
    rateLimitResetAt: ts("rate_limit_reset_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("marketplace_connections_ws_platform_uq").on(t.workspaceId, t.platform)],
);

export const dataSources = pgTable("data_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: ["api", "feed", "csv", "manual", "demo"] }).notNull(),
  platform: marketplaceEnum("platform"),
  permissionStatus: text("permission_status", { enum: ["authorized", "pending", "unknown"] })
    .notNull()
    .default("unknown"),
  licenseNote: text("license_note"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export type IngestionError = { row: number; message: string };

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    dataSourceId: uuid("data_source_id").references(() => dataSources.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["products", "orders", "clicks"] }).notNull().default("products"),
    status: ingestionStatusEnum("status").notNull().default("pending"),
    fileName: text("file_name"),
    checksum: text("checksum"),
    totalRows: integer("total_rows").notNull().default(0),
    inserted: integer("inserted").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    duplicates: integer("duplicates").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    errors: jsonb("errors").$type<IngestionError[]>().notNull().default([]),
    mapping: jsonb("mapping").$type<Record<string, string>>(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [index("ingestion_runs_ws_created_idx").on(t.workspaceId, t.createdAt)],
);

// ---------------------------------------------------------------- catalog
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("categories_ws_slug_uq").on(t.workspaceId, t.slug)],
);

export const categoryMappings = pgTable(
  "category_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    platform: marketplaceEnum("platform"),
    sourceCategory: text("source_category").notNull(),
    categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("category_mappings_uq").on(t.workspaceId, t.platform, t.sourceCategory)],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    brand: text("brand"),
    model: text("model"),
    gtin: text("gtin"),
    description: text("description"),
    sourceCategory: text("source_category"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    categorySource: text("category_source", { enum: ["source", "mapping", "rules", "ai", "manual"] }),
    categoryConfidence: real("category_confidence"),
    imageUrl: text("image_url"),
    imageRights: imageRightsEnum("image_rights").notNull().default("unknown"),
    imageAssetId: uuid("image_asset_id"),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    dataOrigin: dataOriginEnum("data_origin").notNull(),
    /** Products believed to be the same item (GTIN / brand+model / human confirmation) share a group id. */
    duplicateGroupId: uuid("duplicate_group_id"),
    duplicateReason: text("duplicate_reason"),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_ws_idx").on(t.workspaceId, t.deletedAt),
    index("products_ws_norm_title_idx").on(t.workspaceId, t.normalizedTitle),
    index("products_ws_gtin_idx").on(t.workspaceId, t.gtin),
    index("products_dup_group_idx").on(t.duplicateGroupId),
  ],
);

export const marketplaceOffers = pgTable(
  "marketplace_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    platform: marketplaceEnum("platform").notNull(),
    shopId: text("shop_id").notNull().default(""),
    shopName: text("shop_name"),
    externalProductId: text("external_product_id").notNull(),
    variantId: text("variant_id").notNull().default(""),
    variantName: text("variant_name"),
    price: money("price").notNull(),
    originalPrice: money("original_price"),
    currency: text("currency").notNull().default("THB"),
    rating: real("rating"),
    ratingCount: integer("rating_count"),
    soldCount: integer("sold_count"),
    stockStatus: text("stock_status"),
    productUrl: text("product_url"),
    affiliateUrl: text("affiliate_url"),
    dataOrigin: dataOriginEnum("data_origin").notNull(),
    dataSourceId: uuid("data_source_id").references(() => dataSources.id, { onDelete: "set null" }),
    sourceUpdatedAt: ts("source_updated_at"),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("offers_identity_uq").on(t.workspaceId, t.platform, t.shopId, t.externalProductId, t.variantId),
    index("offers_product_idx").on(t.productId),
  ],
);

/** Immutable commission facts. Latest row per offer (by fetched_at) is the current commission. */
export const commissionSnapshots = pgTable(
  "commission_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id").notNull().references(() => marketplaceOffers.id, { onDelete: "cascade" }),
    /** Total applicable commission rate in percent (e.g. 12.5 = 12.5%). */
    rateTotal: numeric("rate_total", { precision: 7, scale: 3, mode: "number" }).notNull(),
    sellerRate: numeric("seller_rate", { precision: 7, scale: 3, mode: "number" }),
    platformRate: numeric("platform_rate", { precision: 7, scale: 3, mode: "number" }),
    bonusRate: numeric("bonus_rate", { precision: 7, scale: 3, mode: "number" }),
    capAmount: money("cap_amount"),
    minBasket: money("min_basket"),
    commissionType: text("commission_type").notNull().default("percentage"),
    /** true when the rate was entered as an estimate rather than taken from an official source. */
    isEstimated: boolean("is_estimated").notNull().default(false),
    effectiveFrom: ts("effective_from"),
    effectiveTo: ts("effective_to"),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
    sourceReference: text("source_reference"),
    confidence: real("confidence"),
    dataOrigin: dataOriginEnum("data_origin").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("commission_offer_fetched_idx").on(t.offerId, t.fetchedAt)],
);

export const affiliateLinks = pgTable(
  "affiliate_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id").references(() => marketplaceOffers.id, { onDelete: "set null" }),
    videoProjectId: uuid("video_project_id"),
    subId: text("sub_id").notNull(),
    url: text("url").notNull(),
    channel: text("channel"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("affiliate_links_ws_sub_uq").on(t.workspaceId, t.subId)],
);

export type ScoreComponent = {
  key: string;
  label: string;
  weight: number;
  /** 0..1 normalized value, or null when the input data is missing. */
  value: number | null;
  evidence: string;
};

export const productScores = pgTable(
  "product_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    /** 0..100, computed only from available components; null when nothing could be scored. */
    score: real("score"),
    /** 0..1 — share of the scoring weight backed by real data, times data reliability. */
    confidence: real("confidence").notNull(),
    components: jsonb("components").$type<ScoreComponent[]>().notNull(),
    missingFields: jsonb("missing_fields").$type<string[]>().notNull().default([]),
    explanation: text("explanation").notNull(),
    analyzer: text("analyzer", { enum: ["rules", "openai", "demo"] }).notNull(),
    model: text("model"),
    audience: text("audience"),
    contentAngles: jsonb("content_angles").$type<string[]>().notNull().default([]),
    riskFlags: jsonb("risk_flags").$type<string[]>().notNull().default([]),
    needsReview: boolean("needs_review").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("product_scores_product_created_idx").on(t.productId, t.createdAt)],
);

export const shortlists = pgTable("shortlists", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const shortlistItems = pgTable(
  "shortlist_items",
  {
    shortlistId: uuid("shortlist_id").notNull().references(() => shortlists.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    note: text("note"),
    addedAt: ts("added_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shortlistId, t.productId] })],
);

// ---------------------------------------------------------------- creative / video
export type TemplateConfig = {
  durationSec: number;
  sceneCount: number;
  structure: string[];
  palette: { from: string; to: string; accent: string };
  music: "none" | "calm" | "upbeat";
};

export const creativeTemplates = pgTable(
  "creative_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    style: text("style", {
      enum: ["showcase", "review", "problem_solution", "promo", "three_benefits", "comparison"],
    }).notNull(),
    description: text("description"),
    version: integer("version").notNull().default(1),
    prompt: text("prompt").notNull(),
    config: jsonb("config").$type<TemplateConfig>().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("templates_ws_key_version_uq").on(t.workspaceId, t.key, t.version)],
);

export type VideoScript = {
  hook: string;
  body: string;
  cta: string;
  caption: string;
  hashtags: string[];
  disclosure: string;
  /** Product facts the script relies on, each pointing to a source field. */
  claims: { text: string; sourceField: string }[];
};

export type ProductFacts = {
  title: string;
  brand: string | null;
  price: number | null;
  currency: string;
  platform: string | null;
  rating: number | null;
  ratingCount: number | null;
  soldCount: number | null;
  attributes: Record<string, string>;
  description: string | null;
  productUrl: string | null;
  affiliateUrl: string | null;
  dataOrigin: string;
  capturedAt: string;
};

export const videoProjects = pgTable(
  "video_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id").references(() => marketplaceOffers.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => creativeTemplates.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    language: text("language", { enum: ["th", "en"] }).notNull().default("th"),
    status: videoStatusEnum("status").notNull().default("created"),
    renderMode: renderModeEnum("render_mode").notNull().default("hybrid"),
    aspectRatio: text("aspect_ratio").notNull().default("9:16"),
    durationSec: integer("duration_sec").notNull().default(20),
    voice: text("voice", { enum: ["none", "female", "male"] }).notNull().default("none"),
    subtitles: boolean("subtitles").notNull().default(true),
    disclosure: boolean("disclosure").notNull().default(true),
    music: text("music", { enum: ["none", "calm", "upbeat"] }).notNull().default("calm"),
    visualStyle: text("visual_style").notNull().default("premium"),
    script: jsonb("script").$type<VideoScript>(),
    facts: jsonb("facts").$type<ProductFacts>(),
    scriptGenerator: text("script_generator"),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 12, scale: 4, mode: "number" }),
    actualCostUsd: numeric("actual_cost_usd", { precision: 12, scale: 4, mode: "number" }).notNull().default(0),
    outputAssetId: uuid("output_asset_id"),
    thumbnailAssetId: uuid("thumbnail_asset_id"),
    subtitleAssetId: uuid("subtitle_asset_id"),
    error: text("error"),
    batchId: uuid("batch_id"),
    automationRuleId: uuid("automation_rule_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    publishedAt: ts("published_at"),
    publishChannel: text("publish_channel"),
    publishNote: text("publish_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("video_projects_ws_status_idx").on(t.workspaceId, t.status),
    index("video_projects_ws_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

export const videoScenes = pgTable(
  "video_scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => videoProjects.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    durationSec: real("duration_sec").notNull(),
    title: text("title").notNull(),
    voiceover: text("voiceover").notNull().default(""),
    caption: text("caption").notNull().default(""),
    visualPrompt: text("visual_prompt").notNull().default(""),
    shotType: text("shot_type", { enum: ["hook", "problem", "solution", "showcase", "benefit", "cta"] })
      .notNull()
      .default("showcase"),
    imageAssetId: uuid("image_asset_id"),
    videoAssetId: uuid("video_asset_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("video_scenes_project_idx_uq").on(t.projectId, t.idx)],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["image", "video", "audio", "subtitle", "thumbnail", "product_image", "document"],
    }).notNull(),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name"),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    durationSec: real("duration_sec"),
    source: text("source", {
      enum: ["ai_generated", "product_authorized", "demo_placeholder", "upload", "render", "synthesized"],
    }).notNull(),
    rightsNote: text("rights_note"),
    provider: text("provider"),
    model: text("model"),
    prompt: text("prompt"),
    projectId: uuid("project_id"),
    productId: uuid("product_id"),
    createdAt: createdAt(),
  },
  (t) => [index("media_assets_project_idx").on(t.projectId), index("media_assets_ws_kind_idx").on(t.workspaceId, t.kind)],
);

// ---------------------------------------------------------------- jobs & cost
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    idempotencyKey: text("idempotency_key"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: ts("run_at").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    progress: integer("progress").notNull().default(0),
    progressMessage: text("progress_message"),
    projectId: uuid("project_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    uniqueIndex("jobs_idempotency_uq").on(t.workspaceId, t.idempotencyKey),
    index("jobs_claim_idx").on(t.status, t.runAt, t.priority),
    index("jobs_project_idx").on(t.projectId),
  ],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    level: text("level", { enum: ["info", "warn", "error"] }).notNull().default("info"),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.createdAt)],
);

export const providerUsageCosts = pgTable(
  "provider_usage_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model"),
    operation: text("operation").notNull(),
    units: numeric("units", { precision: 14, scale: 3, mode: "number" }).notNull().default(0),
    unit: text("unit").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    isEstimate: boolean("is_estimate").notNull().default(true),
    projectId: uuid("project_id"),
    jobId: uuid("job_id"),
    createdAt: createdAt(),
  },
  (t) => [index("usage_ws_created_idx").on(t.workspaceId, t.createdAt)],
);

// ---------------------------------------------------------------- automation
export type RuleConditions = {
  minCommissionAmount?: number | null;
  minCommissionRate?: number | null;
  minScore?: number | null;
  minConfidence?: number | null;
  categoryIds?: string[];
  marketplaces?: ("shopee" | "lazada")[];
  excludeAlreadyProduced?: boolean;
  requireAuthorizedImage?: boolean;
};

export type RuleActions = {
  templateKey: string;
  language: "th" | "en";
  renderMode: "hybrid" | "generative";
  videosPerDay: number;
  autoGenerateScript: boolean;
  autoRender: boolean;
  /** Publishing always requires human approval; stored for explicitness and auditing. */
  requireApproval: true;
  maxCostPerVideoUsd?: number | null;
};

export const automationRules = pgTable("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  conditions: jsonb("conditions").$type<RuleConditions>().notNull(),
  actions: jsonb("actions").$type<RuleActions>().notNull(),
  schedule: text("schedule", { enum: ["manual", "daily"] }).notNull().default("manual"),
  scheduleTime: text("schedule_time").notNull().default("09:00"),
  lastRunAt: ts("last_run_at"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").notNull().references(() => automationRules.id, { onDelete: "cascade" }),
    dryRun: boolean("dry_run").notNull(),
    trigger: text("trigger", { enum: ["manual", "schedule"] }).notNull().default("manual"),
    matched: integer("matched").notNull().default(0),
    createdProjects: integer("created_projects").notNull().default(0),
    status: text("status", { enum: ["succeeded", "partial", "failed", "skipped"] }).notNull(),
    message: text("message"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("automation_runs_rule_idx").on(t.ruleId, t.createdAt)],
);

// ---------------------------------------------------------------- analytics (imported / API reports)
export const affiliateOrders = pgTable(
  "affiliate_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    platform: marketplaceEnum("platform").notNull(),
    orderRef: text("order_ref").notNull(),
    itemRef: text("item_ref").notNull().default(""),
    subId: text("sub_id"),
    productRef: text("product_ref"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    videoProjectId: uuid("video_project_id"),
    orderValue: money("order_value").notNull().default(0),
    commission: money("commission").notNull().default(0),
    status: commissionStatusEnum("status").notNull().default("pending"),
    orderedAt: ts("ordered_at").notNull(),
    dataOrigin: dataOriginEnum("data_origin").notNull(),
    ingestionRunId: uuid("ingestion_run_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("affiliate_orders_identity_uq").on(t.workspaceId, t.platform, t.orderRef, t.itemRef),
    index("affiliate_orders_ws_date_idx").on(t.workspaceId, t.orderedAt),
  ],
);

export const clickStats = pgTable(
  "click_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    platform: marketplaceEnum("platform").notNull(),
    subId: text("sub_id").notNull().default(""),
    date: date("date", { mode: "string" }).notNull(),
    clicks: integer("clicks").notNull().default(0),
    dataOrigin: dataOriginEnum("data_origin").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("click_stats_uq").on(t.workspaceId, t.platform, t.subId, t.date)],
);

