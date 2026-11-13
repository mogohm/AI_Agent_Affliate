# AI Affiliate Studio — Product Design & Claude Build Brief
Version: 1.0 | Prepared: 2026-11-03 | Market: Thailand | Status: design/MVP specification

## 0. Instructions for Claude Code

You are the lead full-stack engineer, solution architect, product UX engineer, and QA lead implementing **AI Affiliate Studio**, a production-minded web-based affiliate product intelligence and AI video creation system for Thailand. The owner wants an entire back office, beginning with Shopee and Lazada, designed for evolution into a scalable content-production platform.

**First task:** open `AI_Affiliate_Studio_Design_Prototype.html` and use it as a **functional UX reference**, not as production code. Preserve its main information architecture, build real interfaces with Next.js/React, and offer the visual theme presets A (Command Center dark), B (Creative Studio light), C (Automation Factory green). UI language: primarily Thai; use English product terms where natural.

**Do not claim real integration before credentials/approval are available. Do not scrape marketplaces without authorization. Do not synthesize real commission percentages or sales data.** The prototype figures are mock data only.

Implement features in modular, testable steps. Use stable interfaces for marketplace data providers, LLM/image/video providers, publishing channels, and storage. Show working tests and clearly distinguish mock, staging, and connected production data. No silent fallback from a failed API to invented real-looking figures.

## 1. Primary outcome and user journeys

1. Administrator connects a permitted Shopee Affiliate source and/or Lazada Affiliate source; if not available, uploads authorized CSV/product feed, or manually adds products.
2. System ingests, deduplicates, validates, and normalizes products, affiliate offers and commission rules; saves source and fetched-at timestamps.
3. AI classifies categories, deduces audience, content potential, useful product attributes, uncertainty and safeguards; never fabricates seller/commission claims.
4. Product Explorer filters by marketplace, category, source, price band, commission rate, **estimated commission per eligible sale**, validity, seller, confidence, AI score, freshness, and content-production eligibility; sort and compare.
5. User selects products, chooses templates or bulk production, reviews factual product brief and consent/licensing, generates script + storyboard, images, short video/motion, voiceover, captions and call-to-action.
6. Persistent worker renders video, stores artifacts, records actual cost, provides preview and approval; publish/export according to each channel's available API/terms.
7. Analytics ties content ID ↔ affiliate link/sub-ID ↔ approved conversion reports ↔ attributable commission; shows commissions as pending/validated/paid separately.
8. Admin manages provider credentials, roles, costs, schedules, retry policies, QA, audit logs and templates.

## 2. Visual / navigation modules

- Dashboard: stock of valid offers, pending review, queue status, approved earnings, content cost/ROI, insights. KPIs must carry date range and provenance.
- Products & Commission: multi-market table and cards, server-side filter/search/sort, import, duplicate grouping, shortlist and one-click video draft.
- Product Compare: offer-level Shopee vs Lazada comparison only after reliable product identity match (GTIN/model+variant or human confirmation); never compare unrelated variants.
- AI Video Studio: select SKU, facts reference, Thai hook/script/storyboard, style/template, shot list, 9:16 vertical default, preview, image policy, voice, captions, watermark/disclosure and cost estimate.
- Templates: Thai UGC style, product 3 benefits, photo motion, problem/solution, soft-sell, comparison; versioned prompt templates and per-brand assets.
- Automation Factory: ingestion rules, opportunity thresholds, approval gates, batch scheduling, per-day budget ceiling, retry/dead-letter monitoring.
- Job Queue: created→script_draft→awaiting_approval→asset_generation→rendering→quality_review→ready→exported/published; also failed/canceled states.
- Content Library / Publishing: thumbnails, variants and exports MP4, filenames, metadata, captions, post schedule, link tracking, destination and approval history. Auto-post only for authorized integrations; otherwise export instructions/manual posting.
- Analytics: clicks/orders/conversions; validated commission, refund/reversal, cost per content, creator ROI, category performance, attribution caveats.
- Connections: Shopee, Lazada, CSV feed importer, OAuth/token health, last sync, retry, permission status, API rate limit, data origin.
- Admin: team/RBAC, API keys encrypted server-side, provider cost ceilings, source audit, moderation/rights, category mappings, jobs logs.

## 3. Technical architecture recommendation

- Monorepo `pnpm` (optional Turborepo): `apps/web`, `apps/worker`, `packages/core`, `packages/db`, `packages/providers`, `packages/media`, `packages/ui`.
- Web: **Next.js App Router + TypeScript + Tailwind CSS + shadcn/ui**; accessible Thai UI with responsive desktop-first admin layout. Theme presets A/B/C.
- Database: **Neon PostgreSQL** + Drizzle ORM (or Prisma if justified), schema migrations and seed fixtures; Postgres full-text or pg_trgm for search.
- Jobs: **Redis + BullMQ** workers with idempotency, concurrency and priority. Long video tasks MUST NOT block a web request or depend on short-lived serverless executions.
- Video render: Remotion/FFmpeg worker process; configurable hybrid pipeline where real product photo/video references (authorized/licensed) remain visually faithful.
- Media: S3-compatible object storage (e.g. Cloudflare R2), private originals and signed URLs, lifecycle/retention strategy.
- Hosting: Next.js web on Vercel is possible; durable worker(s), FFmpeg and Redis on VPS/containers. Isolate user-facing website from compute-intensive rendering.
- Auth: secure session/JWT with server-side RBAC, roles Admin, Editor, Approver, Viewer. Use audit logs on privileged actions.
- Observability: structured logs, job events, retries, health checks, provider usage/cost tracking, alert on quota/errors.
- Provider architecture: `MarketplaceProvider`, `ImageProvider`, `VideoProvider`, `SpeechProvider`, `PublisherProvider`, each with versioned interfaces, capability check and adapter.

### Pipeline

Approved Data Source (official API / authorized feed / CSV / manual)
  → Ingestion & Normalization → Source-backed Offers + Commission snapshots
  → Classification + Eligibility + Confidence + Ranking
  → Product Shortlist → Brief/Script/Storyboard/Manual Review
  → AI Images / Optional AI Video / TTS / Captions / Remotion + FFmpeg
  → Brand/Factual/Usage Rights QA → Content Approval → Export or Authorized Publish
  → Attribution / Validated Earnings / Cost Analytics.

## 4. Data model (initial normalized entities)

- `users`, `workspaces`, `workspace_members`, `roles`, `audit_logs`
- `marketplace_connections` (platform, account, authorization scope, status, encrypted secret reference)
- `data_sources` (provider, type API/feed/CSV/manual, license/permission status, metadata)
- `ingestion_runs` (source, status, timestamps, rows, errors, cursor, checksum)
- `categories` and `category_mappings` (source categories → canonical category)
- `products` (canonical description, brand, normalized model, GTIN, images and rights metadata)
- `product_variants` (size/color/model variant attributes)
- `marketplace_offers` (platform, shop, product_id, variant_id, price, availability, public URL, source_updated_at)
- `commission_snapshots` (offer_id, affiliate_account, offer type, direct/indirect, rate components, rate currency, cap, rules, effective dates, fetched_at, source_reference, confidence)
- `affiliate_links` (offer, campaign, channel, approved link, sub-ID and ownership)
- `product_scores` (version, feature evidence, missing field flags, confidence, AI explanation)
- `shortlists`, `shortlist_items`, `campaigns`, `channels`
- `creative_templates` (versioned prompt/style/config)
- `video_projects`, `storyboards`, `video_scenes`, `media_assets` (source/rights), `render_jobs`, `render_attempts`
- `social_posts`, `publishing_jobs`, `posting_approvals`
- `attribution_events`, `affiliate_orders`, `commission_ledger` (pending/approved/paid/reversed)
- `provider_usage_costs`, `budgets`, `notifications`, `system_events`.

Add SQL constraints/indexes, stable external IDs, uniqueness within marketplace+shop+variant, UTC timestamps stored in DB with Asia/Bangkok display, soft delete where meaningful and immutable snapshots for commission and video output traceability.

## 5. Real commission calculation and ranking

A real commission number MUST be distinguished from mock or estimated commission. Store seller/platform/bonus commissions separately and combine only when official terms authorize it. Define eligible sale value, per-order cap, minimum basket, commission type, buyer segment, restrictions, product validity and effective period. Show data freshness and account-specific rate.

- **Estimated gross commission per eligible order** = min(eligible_net_item_value × applicable_total_rate, applicable_cap), when precise rules are known.
- **Expected approved commission** = gross commission × estimated validation probability (only if data supports such probability).
- **Expected profit per 1,000 qualified views** = estimated orders attributed per 1,000 views × expected approved commission − prorated creative production cost − promotion costs.
- `Opportunity Score` (configurable example): 30% expected commission/earning, 20% conversion evidence, 15% reliable demand, 15% seller/product quality, 10% trend, 10% content suitability. Do NOT compute fabricated metrics; reduce confidence and refer to manual review when data is missing.
- Sort options: commission per sale (default), commission rate, net expected profit, projected validated earnings per 1,000 views, quality score, freshness, price, newness.
- Keep dashboard states separate: projected / pending / approved / paid, and reversed or invalidated.

## 6. AI integration design

### Text and product reasoning
OpenAI Responses API (or approved model) for taxonomy mapping, title normalization, hooks, claims extraction, Thai scripts, storyboard JSON, voiceover text, content disclosure. Use structured output schema and enforce evidence-backed fields with citation to source product fields.

### Image generation (OpenAI API)
Provider config can map fast quality to `gpt-image-2.5-flare`, precision edits to `gpt-image-2.5-sunburst`; feature flags and versioned provider selection. Use licensed product reference images; distinguish synthetic lifestyle scenes from actual product photographs. Use precise pricing/Thai legal text via deterministic renderer rather than relying on image model for text. Do not generate counterfeit packaging, fake product logos/specifications, fake first-hand product reviews, or unsupported before/after claims.

### Video generation / compositing
Implement both:
- **Hybrid low-cost mode (default):** authorized product photos + AI-created scene backgrounds + motion graphics/transitions + captions + Thai TTS; Remotion/FFmpeg renders final 15–30s clip.
- **Premium AI-video mode:** Sora API (`sora-2` / `sora-2-pro` if accessible) or configurable provider generates short supporting B-roll; compositing with product-accurate overlays. Sora outputs can distort product geometry/text: QA is mandatory.

All render work goes to a persistent queue with webhooks/polling, timeout, rate limits and retries. Record per-scene model, prompt version, input asset rights, output bytes, compute duration and actual vendor charges. Budget ceilings are enforced BEFORE job dispatch.

### Speech + QA
Configurable Thai TTS and voice preset, subtitle alignment, safe music licensing, visual claims check, profanity/ad compliance, watermark/disclosure, and human review before public posting.

## 7. Marketplace connection policy

- **Shopee Thailand:** affiliate Open API requires application and eligibility; official help as at 2026-11-03 describes >1,000 orders/month among criteria, plus website/followers and quality of content. Must obtain explicit credential/authorization; until then use authorized Product Feed/CSV or manually entered product and real affiliate links.
- **Lazada Thailand:** affiliate account and curated/high-commission products exist, but public seller API access is not a substitute for an affiliate-specific product/commission authorization. Verify API/feed terms with Lazada before calling affiliate endpoints.
- No scraping as a hidden workaround. No automatic platform account interactions outside the approved API scope.
- Explicit status UX: disconnected, permission pending, connected, sync failed, rate-limited, stale data, imported CSV.

References: 
- Shopee official API eligibility: https://help.shopee.co.th/portal/4/article/198622
- Shopee official Product Feed how-to: https://help.shopee.co.th/portal/10/article/172214
- Shopee affiliate terms: https://help.shopee.co.th/portal/4/article/200784
- Lazada Affiliate FAQ: https://education.lazada.co.th/cms/FAQ
- OpenAI image guide: https://developers.openai.com/api/docs/guides/image-generation
- OpenAI video docs: https://developers.openai.com/api/docs/guides/video-generation

## 8. Minimal REST/route contract (examples, not exhaustive)

- `GET /api/products?marketplace=...&category=...&sort=commission_amount&search=...`
- `GET /api/products/:id` and `GET /api/products/:id/offers`
- `POST /api/ingestion/imports` (presigned upload + import job)
- `GET /api/ingestion/runs/:id`
- `POST /api/shortlists`, `POST /api/shortlists/:id/items`
- `POST /api/video-projects` (brief + approved product evidence)
- `POST /api/video-projects/:id/storyboard`
- `POST /api/video-projects/:id/render` (approved + budget guard)
- `GET /api/render-jobs/:id`, `POST /api/render-jobs/:id/retry`
- `POST /api/video-projects/:id/approve`
- `POST /api/content/:id/export`, `POST /api/publishing-jobs`
- `GET /api/analytics/commissions`, `/performance`, `/costs`
- `GET/POST /api/settings/connections`, `GET/POST /api/settings/budget`, `GET /api/audit-logs`

Use Zod validation, authenticated tenancy and RBAC on ALL routes, cursor pagination, constrained sorting/filtering, proper HTTP statuses and idempotency keys for mutation/job enqueue.

## 9. Implementation phases / acceptance criteria

**Phase 1: Product Control Center MVP**
- Auth + Admin roles + theme presets, product import CSV, schema validation, dedup, marketplace normalization, categories, commission snapshots, product explorer and default commission-amount sort.
- Ability to distinguish imported facts from fake/demo and preserve provenance. Unit tests for cap/zero/rate, duplicates and stale data.

**Phase 2: AI Video Studio MVP**
- Structured Thai storyboards/scripts, truthful claims prompts, product picture management, templates, image API adapter, hybrid Remotion/FFmpeg renderer, job queue, MP4 export and library. Include disclosure and human QA. Generate at least one local test MP4 from a licensed placeholder asset (not actual product imagery).

**Phase 3: Automation + Admin Control**
- Rule builder with dry-run, approval checks, per-job cost estimate, daily/monthly budget guard, retry & cancellation, operator queue and logs.

**Phase 4: Authorized Marketplace and Analytics Connectors**
- Shopee/Lazada API connectors *only when access is granted*, conversion and commission report import, affiliate link tracking/sub-ID, analytics and reconcile pending/validated/paid/reversed.

**Phase 5: Scalable Operations**
- Multi-channel authorized publishing, versioned templates A/B tests, multi-account/multi-workspace architecture, alerts, security hardening and performance tests.

**Mandatory verification per phase**:
- lint/typecheck/unit/integration/E2E tests (Playwright); show command and results.
- No secrets exposed to browser, logs or source control.
- Worker restart does not lose queued or completed work; repeated jobs are idempotent.
- Thai UTF-8 font and captions render correctly.
- Unauthorized roles cannot access approve/publish/credentials.
- Genuine product/commission source can be inspected on every displayed claim.
- UI with empty/loading/permission/error/stale-data states.

## 10. Immediate handoff request

1. Inspect supplied HTML mockup and spec, summarize architecture and establish repository structure.
2. Implement Phase 1 completely with seeded DEMO data and clear Demo Mode; include **CSV mapping preview** and fake provider adapters for local development.
3. Make every visible core navigation page functional, with mock mode explicitly labeled until real integrations are configured.
4. Implement end-to-end test command and generate a short implementation report (features, tests, pending integrations, deployment steps, risks).
5. Never claim external integration or auto-posting is complete without confirmed official access.

