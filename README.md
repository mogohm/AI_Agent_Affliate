# AI Affiliate Studio

ระบบหลังบ้านสำหรับบริหาร Affiliate สินค้า Shopee / Lazada: วิเคราะห์และจัดอันดับสินค้าตามค่าคอมมิชชัน, AI Product Intelligence, AI Video Studio (วิดีโอแนวตั้ง 9:16), Automation Factory, Content Library และ Affiliate Analytics

> **หลักการสำคัญ:** ไม่สร้างตัวเลขค่าคอม/ยอดขายขึ้นเอง ทุกข้อมูลมี `data_origin` (demo / csv / feed / manual / api) และแสดง badge ที่มาในหน้าจอ ข้อมูลตัวอย่างถูกติดป้าย **DEMO** เสมอ ไม่มีการ scrape และไม่มี fallback ไปเป็นข้อมูลปลอมเมื่อ API ล้มเหลว

## Quick start (local)

```bash
npm install            # ติดตั้ง (ffmpeg-static/esbuild ต้องอนุญาต install script: npm approve-scripts ffmpeg-static esbuild)
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

- Database ใช้ **PGlite** (PostgreSQL แบบ embedded) ที่ `./.data/pglite` และ apply migrations อัตโนมัติ (ไม่ต้องติดตั้ง Postgres/Redis/Docker)
- ครั้งแรกระบบสร้าง workspace + ผู้ใช้ให้อัตโนมัติ:
  - `admin@example.com` / `ChangeMe!2026` (ค่าจาก `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)
  - `editor@example.com`, `approver@example.com`, `viewer@example.com` (รหัสผ่านเดียวกัน) สำหรับทดสอบสิทธิ์
- Worker ทำงาน inline ใน Next.js server ตอน dev (ใช้ FFmpeg จาก `ffmpeg-static`)
- เปลี่ยนธีม A / B / C ได้ที่มุมขวาบน (Command Center / Creative Studio / Automation Factory)

## Scripts

| Command | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run worker` | Worker แยก process (VPS/container) |
| `npm run typecheck` / `lint` | TypeScript / ESLint |
| `npm test` | Unit + integration (Vitest, PostgreSQL in-memory) |
| `npm run test:e2e` | Playwright (build + server แยก DB ใหม่ทุกครั้ง) — ครั้งแรกรัน `npx playwright install chromium` |
| `npm run db:generate` / `db:migrate` / `db:seed` | Drizzle migrations / apply / bootstrap |

> Windows: `npm test` ใช้ wrapper `scripts/vitest.mjs` เพื่อแก้ปัญหา drive letter ตัวเล็ก (`d:\` vs `D:\`) ที่ทำให้ Vitest โหลดตัวเองซ้ำ

## Architecture

```
src/
  app/(app)/          dashboard, products(+[id], import), studio(+[id]), automation, queue, library, analytics, settings
  app/api/            REST routes — ทุก route ผ่าน route() = auth + RBAC + Zod + error mapping
  db/schema.ts        Drizzle schema (28 tables) · drizzle/  SQL migrations
  lib/core/           commission, scoring, normalize/dedupe, categorize (pure, unit-tested)
  lib/catalog/        upsert/dedupe, explorer query, CSV import, AI analysis, dashboard
  lib/marketplace/    MarketplaceProvider: Shopee Affiliate Open API adapter, Lazada (pending approval)
  lib/video/          projects, script providers (demo/OpenAI), images, TTS, Sora adapter, render pipeline
  lib/media/          resvg frame composer (Thai shaping), FFmpeg runner, synthesized music, SRT
  lib/jobs/           durable Postgres job queue (+ optional BullMQ wake-ups), worker loop
  lib/automation/     rule engine, dry-run, quotas, scheduler
  lib/analytics/      orders/clicks import, commission status split, ROI
  lib/ai/             AI context (demo/live gating), usage cost tracking, budget guard
  lib/storage/        local / S3-compatible object storage
  remotion/           Remotion composition (in-browser preview via @remotion/player)
worker/index.ts       standalone worker entry
```

- **Pipeline:** CSV/Feed/Manual/API → normalize + dedupe + categorize → commission snapshots (immutable) → Opportunity Score → shortlist → script/storyboard → images/voice → Hybrid render (resvg + FFmpeg) → human QA → export / manual publish record → analytics
- **Opportunity Score:** weights configurable (default: commission/order 30, sales evidence 20, rating 15, rate 10, trend 10, content 15). Missing data is **not** imputed — it is excluded, lowers confidence and is listed as missing; low confidence → "ควรตรวจสอบ"
- **Commission/order** = `min(price × rate, cap)` (0 when below minimum basket); estimated vs official rates are flagged
- **Jobs:** `jobs` table is the source of truth (`FOR UPDATE SKIP LOCKED`, retries with exponential backoff, dead-letter, stale-lock recovery, idempotency keys, cancel). Restarting the worker never loses work
- **Budget guard:** estimated cost checked against per-video / daily / monthly ceilings **before** dispatch; actual usage recorded in `provider_usage_costs`
- **RBAC:** Admin / Editor / Approver / Viewer — enforced server-side on every route; approve/publish/credentials restricted

### Database tables
workspaces, users, workspace_members, audit_logs, app_settings, marketplace_connections, data_sources, ingestion_runs, categories, category_mappings, products, marketplace_offers, commission_snapshots, affiliate_links, product_scores, shortlists, shortlist_items, creative_templates, video_projects, video_scenes, media_assets, jobs, job_events, provider_usage_costs, automation_rules, automation_runs, affiliate_orders, click_stats

## Integrations status

| Integration | Status |
|---|---|
| CSV / Product Feed import, manual add | ✅ ใช้งานได้ |
| Hybrid video render (FFmpeg + resvg, Thai subtitles, synthesized music, MP4/SRT/thumbnail) | ✅ ใช้งานได้ ไม่ต้องใช้ API key |
| OpenAI text (analysis/script), images, TTS | ⏳ adapter พร้อม — ต้องใส่ API key และเปิด **Live mode** ใน Settings (ทดสอบด้วย mock เท่านั้น ยังไม่ได้เรียกจริง) |
| OpenAI Sora (Generative video mode) | ⏳ adapter พร้อม — ต้องมีสิทธิ์ใช้ Sora + เปิดใน Settings → Video Providers |
| Shopee Affiliate Open API | ⏳ adapter พร้อม (GraphQL + SHA256 signature) — ต้องได้รับอนุมัติ Open API และตรวจ field names กับเอกสารที่ได้รับ |
| Lazada Affiliate API | ⏳ รอการอนุมัติ — แสดงสถานะ "รอสิทธิ์ API" แนะนำใช้ CSV/Feed |
| Auto-posting to social channels | ❌ ไม่ได้ทำโดยเจตนา — Export + บันทึกการโพสต์ด้วยตนเอง จนกว่าจะมี integration ที่ได้รับอนุญาต |
| Redis / BullMQ | ⏳ optional (`QUEUE_DRIVER=bullmq`, `REDIS_URL`) — ยังไม่ได้ทดสอบกับ Redis จริง |
| S3 / R2 storage | ⏳ optional (`STORAGE_DRIVER=s3`) — ยังไม่ได้ทดสอบกับ bucket จริง |

## Production deployment

1. **Neon:** สร้าง database → ตั้ง `DATABASE_URL` (pooled, `sslmode=require`) → `npm run db:migrate` → `SEED_DEMO_DATA=false npm run db:seed`
2. **Secrets:** `AUTH_SECRET` (≥32 chars), `APP_ENCRYPTION_KEY`, เปลี่ยนรหัสผ่าน admin ทันทีหลัง login
3. **Storage:** Cloudflare R2/S3 → `STORAGE_DRIVER=s3` + `S3_*` (จำเป็นเมื่อ web และ worker อยู่คนละเครื่อง)
4. **Web (Vercel):** ตั้ง env ทั้งหมด + `WORKER_INLINE=false`
5. **Worker (VPS/container):** env ชุดเดียวกัน → `npm ci && npm run worker` (systemd/PM2/Docker, restart always). Optional: Redis + `QUEUE_DRIVER=bullmq`
6. Settings → AI Providers: ใส่ OpenAI key, ตรวจราคา/โมเดล, ตั้งงบประมาณ แล้วจึงเปิด Live mode
7. ตรวจ Remotion license หากองค์กรมีพนักงานเกิน 3 คน (ใช้ `@remotion/player` สำหรับ preview)

### Known limitations / next steps
- Login rate limiting is in-memory (move to Redis for multi-instance)
- Live OpenAI/Sora/Shopee paths are unit-tested with mocks only — run a supervised smoke test with real credentials and a small budget
- In-browser Remotion preview uses a placeholder product visual; the rendered MP4 uses the authorized product image
- Postgres full-text / `pg_trgm` index for large catalogues (currently `ILIKE`)
