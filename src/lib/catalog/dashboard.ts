import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getSetting } from "@/lib/settings";
import { bangkokDateString, daysAgo } from "@/lib/time";
import { listOffers, type Marketplace } from "./service";

export type DashboardFilters = { periodDays: 7 | 30 | 90; marketplace?: Marketplace; categoryId?: string };

type Row = Record<string, unknown>;
const rows = (r: unknown) => (r as { rows: Row[] }).rows;
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** All dashboard KPIs, computed from stored facts only. Each block reports which data origins it includes. */
export async function getDashboard(db: Db, workspaceId: string, f: DashboardFilters) {
  const since = daysAgo(f.periodDays - 1);
  const offerWhere: SQL[] = [sql`p.workspace_id = ${workspaceId}`, sql`p.deleted_at is null`];
  if (f.marketplace) offerWhere.push(sql`o.platform = ${f.marketplace}`);
  if (f.categoryId) offerWhere.push(sql`p.category_id = ${f.categoryId}`);
  const ow = sql.join(offerWhere, sql` and `);

  const catalog = rows(
    await db.execute(sql`
      with base as (
        select p.id as product_id, o.data_origin, cs.rate_total,
          case when cs.rate_total is null then null
               when cs.min_basket is not null and o.price < cs.min_basket then 0
               else least(o.price * cs.rate_total / 100, coalesce(cs.cap_amount, o.price * cs.rate_total / 100)) end as est
        from marketplace_offers o join products p on p.id = o.product_id
        left join lateral (select * from commission_snapshots s where s.offer_id = o.id
          and (s.effective_to is null or s.effective_to >= now()) order by s.fetched_at desc limit 1) cs on true
        where ${ow}
      )
      select count(distinct product_id)::int as products, count(*)::int as offers,
        avg(rate_total)::float8 as avg_rate, avg(est)::float8 as avg_est, max(est)::float8 as max_est,
        count(*) filter (where rate_total is null)::int as missing_rate
      from base`),
  )[0];
  const originRows = rows(
    await db.execute(sql`select o.data_origin, count(*)::int as c from marketplace_offers o join products p on p.id = o.product_id where ${ow} group by 1`),
  );

  const scores = rows(
    await db.execute(sql`
      select count(*) filter (where sc.score >= 70)::int as high, count(*) filter (where sc.needs_review)::int as review,
        avg(sc.score)::float8 as avg_score, count(sc.id)::int as scored
      from products p
      left join lateral (select * from product_scores ps where ps.product_id = p.id order by ps.created_at desc limit 1) sc on true
      where p.workspace_id = ${workspaceId} and p.deleted_at is null
        ${f.categoryId ? sql`and p.category_id = ${f.categoryId}` : sql``}
        ${f.marketplace ? sql`and exists (select 1 from marketplace_offers o where o.product_id = p.id and o.platform = ${f.marketplace})` : sql``}`),
  )[0];

  const videoRows = rows(
    await db.execute(sql`
      select v.status, count(*)::int as c from video_projects v join products p on p.id = v.product_id
      where v.workspace_id = ${workspaceId} ${f.categoryId ? sql`and p.category_id = ${f.categoryId}` : sql``}
      group by v.status`),
  );
  const pipeline: Record<string, number> = {};
  for (const r of videoRows) pipeline[String(r.status)] = n(r.c);
  const producedRow = rows(
    await db.execute(sql`
      select count(*)::int as c from video_projects v join products p on p.id = v.product_id
      where v.workspace_id = ${workspaceId} and v.output_asset_id is not null and v.updated_at >= ${since}
      ${f.categoryId ? sql`and p.category_id = ${f.categoryId}` : sql``}`),
  )[0];

  const jobsRow = rows(
    await db.execute(sql`select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'running')::int as running,
      count(*) filter (where status = 'failed')::int as failed from jobs where workspace_id = ${workspaceId}`),
  )[0];

  const costRow = rows(
    await db.execute(sql`select coalesce(sum(cost_usd),0)::float8 as usd, count(*)::int as calls, bool_or(is_estimate) as any_estimate
      from provider_usage_costs where workspace_id = ${workspaceId} and created_at >= ${since}`),
  )[0];

  const orderWhere: SQL[] = [sql`a.workspace_id = ${workspaceId}`, sql`a.ordered_at >= ${since}`];
  if (f.marketplace) orderWhere.push(sql`a.platform = ${f.marketplace}`);
  if (f.categoryId) orderWhere.push(sql`exists (select 1 from products p where p.id = a.product_id and p.category_id = ${f.categoryId})`);
  const aw = sql.join(orderWhere, sql` and `);
  const revenueRows = rows(
    await db.execute(sql`select a.status, a.data_origin, count(*)::int as orders, coalesce(sum(a.commission),0)::float8 as commission
      from affiliate_orders a where ${aw} group by a.status, a.data_origin`),
  );
  const revenue = { pending: 0, approved: 0, paid: 0, reversed: 0, orders: 0, origins: [] as string[] };
  for (const r of revenueRows) {
    const s = String(r.status) as keyof typeof revenue;
    if (s in revenue && s !== "origins" && s !== "orders") (revenue[s] as number) += n(r.commission);
    revenue.orders += n(r.orders);
    if (!revenue.origins.includes(String(r.data_origin))) revenue.origins.push(String(r.data_origin));
  }

  const trendRows = rows(
    await db.execute(sql`
      select to_char((a.ordered_at at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD') as day,
        coalesce(sum(a.commission) filter (where a.status = 'pending'),0)::float8 as pending,
        coalesce(sum(a.commission) filter (where a.status in ('approved','paid')),0)::float8 as validated
      from affiliate_orders a where ${aw} group by 1 order by 1`),
  );
  const byDay = new Map(trendRows.map((r) => [String(r.day), r]));
  const trend: { day: string; pending: number; validated: number }[] = [];
  for (let i = f.periodDays - 1; i >= 0; i--) {
    const day = bangkokDateString(daysAgo(i));
    const r = byDay.get(day);
    trend.push({ day, pending: n(r?.pending), validated: n(r?.validated) });
  }

  const categoryRows = rows(
    await db.execute(sql`
      select coalesce(c.name, 'ไม่ระบุหมวดหมู่') as name, count(distinct p.id)::int as products,
        avg(case when cs.rate_total is null then null else least(o.price * cs.rate_total / 100, coalesce(cs.cap_amount, o.price * cs.rate_total / 100)) end)::float8 as avg_est
      from marketplace_offers o join products p on p.id = o.product_id
      left join categories c on c.id = p.category_id
      left join lateral (select * from commission_snapshots s where s.offer_id = o.id order by s.fetched_at desc limit 1) cs on true
      where ${ow}
      group by 1 order by avg_est desc nulls last limit 8`),
  );

  const top = await listOffers(db, workspaceId, { marketplace: f.marketplace, categoryId: f.categoryId, sort: "commission_amount", pageSize: 5 });
  const budget = await getSetting(db, workspaceId, "budget");

  const origins: Record<string, number> = Object.fromEntries(originRows.map((r) => [String(r.data_origin), n(r.c)]));
  const categories = categoryRows.map((r) => ({ name: String(r.name), products: n(r.products), avgEst: nn(r.avg_est) }));

  // Rule-derived insights (not AI) — each states the data it is based on.
  const insights: string[] = [];
  if (categories[0]?.avgEst) insights.push(`หมวด "${categories[0].name}" มีค่าคอมประมาณการต่อออเดอร์เฉลี่ยสูงสุด (฿${categories[0].avgEst.toFixed(0)}) — เหมาะกับการทำวิดีโอเป็นชุด`);
  if (n(scores?.review) > 0) insights.push(`${n(scores?.review)} สินค้ายังมีข้อมูลไม่พอ/ความเชื่อมั่นต่ำ ควรตรวจสอบก่อนผลิต`);
  if (n(catalog?.missing_rate) > 0) insights.push(`${n(catalog?.missing_rate)} ข้อเสนอยังไม่มีอัตราค่าคอม — นำเข้าจากแหล่งที่ได้รับอนุญาตเพื่อจัดอันดับได้แม่นยำ`);
  if (origins.demo) insights.push(`ข้อมูลสินค้า ${origins.demo} รายการเป็น DEMO — ตัวเลขใช้ทดสอบ UI เท่านั้น`);
  if (n(jobsRow?.failed) > 0) insights.push(`มีงานล้มเหลว ${n(jobsRow?.failed)} งานในคิว — ตรวจสอบและลองใหม่ได้ที่หน้าคิวงาน`);
  if (!insights.length) insights.push("ยังไม่มีข้อมูลเพียงพอสำหรับคำแนะนำ — นำเข้าสินค้าเพื่อเริ่มต้น");

  return {
    filters: { ...f, since: since.toISOString() },
    catalog: {
      products: n(catalog?.products),
      offers: n(catalog?.offers),
      avgRate: nn(catalog?.avg_rate),
      avgEstCommission: nn(catalog?.avg_est),
      maxEstCommission: nn(catalog?.max_est),
      missingRate: n(catalog?.missing_rate),
      origins,
    },
    scores: { high: n(scores?.high), needsReview: n(scores?.review), avgScore: nn(scores?.avg_score), scored: n(scores?.scored) },
    videos: { producedInPeriod: n(producedRow?.c), pipeline },
    queue: { queued: n(jobsRow?.queued), running: n(jobsRow?.running), failed: n(jobsRow?.failed) },
    aiCost: { usd: n(costRow?.usd), thb: n(costRow?.usd) * budget.fxThbPerUsd, calls: n(costRow?.calls), fxThbPerUsd: budget.fxThbPerUsd, isEstimate: costRow?.any_estimate !== false },
    revenue,
    trend,
    categories,
    topProducts: top.items,
    insights,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
