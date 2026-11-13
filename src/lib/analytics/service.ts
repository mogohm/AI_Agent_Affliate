/**
 * Affiliate Analytics — computed only from imported/API reports (affiliate_orders, click_stats)
 * and recorded provider usage costs. Commission statuses are always kept separate:
 * pending ≠ approved ≠ paid ≠ reversed. Demo rows are excluded unless explicitly included.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getSetting } from "@/lib/settings";
import { bangkokDateString, daysAgo } from "@/lib/time";

export type AnalyticsFilters = {
  periodDays: number;
  marketplace?: "shopee" | "lazada";
  includeDemo: boolean;
  now?: Date;
};

type Rows<T> = { rows: T[] };
const rows = <T>(r: unknown) => (r as Rows<T>).rows;

export async function hasRealAnalyticsData(db: Db, workspaceId: string): Promise<boolean> {
  const r = rows<{ n: number }>(
    await db.execute(sql`
      select ((select count(*) from affiliate_orders where workspace_id = ${workspaceId} and data_origin <> 'demo')
            + (select count(*) from click_stats where workspace_id = ${workspaceId} and data_origin <> 'demo'))::int as n`),
  );
  return (r[0]?.n ?? 0) > 0;
}

function range(f: AnalyticsFilters) {
  const from = daysAgo(Math.max(1, f.periodDays) - 1, f.now ?? new Date());
  return { from, fromDate: bangkokDateString(from) };
}

function orderWhere(workspaceId: string, f: AnalyticsFilters, alias = "o"): SQL {
  const { from } = range(f);
  const a = sql.raw(alias);
  const parts: SQL[] = [sql`${a}.workspace_id = ${workspaceId}`, sql`${a}.ordered_at >= ${from}`];
  if (f.marketplace) parts.push(sql`${a}.platform = ${f.marketplace}`);
  if (!f.includeDemo) parts.push(sql`${a}.data_origin <> 'demo'`);
  return sql.join(parts, sql` and `);
}

function clickWhere(workspaceId: string, f: AnalyticsFilters): SQL {
  const { fromDate } = range(f);
  const parts: SQL[] = [sql`workspace_id = ${workspaceId}`, sql`date >= ${fromDate}`];
  if (f.marketplace) parts.push(sql`platform = ${f.marketplace}`);
  if (!f.includeDemo) parts.push(sql`data_origin <> 'demo'`);
  return sql.join(parts, sql` and `);
}

const STATUS_SUMS = sql`
  coalesce(sum(case when o.status = 'pending' then o.commission end), 0)::float8 as pending,
  coalesce(sum(case when o.status = 'approved' then o.commission end), 0)::float8 as approved,
  coalesce(sum(case when o.status = 'paid' then o.commission end), 0)::float8 as paid,
  coalesce(sum(case when o.status = 'reversed' then o.commission end), 0)::float8 as reversed,
  count(*) filter (where o.status <> 'reversed')::int as orders,
  coalesce(sum(case when o.status <> 'reversed' then o.order_value end), 0)::float8 as gmv`;

export type StatusSums = { pending: number; approved: number; paid: number; reversed: number; orders: number; gmv: number };

export async function getSummary(db: Db, workspaceId: string, f: AnalyticsFilters) {
  const { from, fromDate } = range(f);
  const [totals] = rows<StatusSums & { reversed_orders: number }>(
    await db.execute(sql`select ${STATUS_SUMS}, count(*) filter (where o.status = 'reversed')::int as reversed_orders
      from affiliate_orders o where ${orderWhere(workspaceId, f)}`),
  );
  const [clk] = rows<{ clicks: number }>(await db.execute(sql`select coalesce(sum(clicks), 0)::int as clicks from click_stats where ${clickWhere(workspaceId, f)}`));
  const [cost] = rows<{ usd: number; estimated_usd: number }>(
    await db.execute(sql`select coalesce(sum(cost_usd), 0)::float8 as usd,
      coalesce(sum(case when is_estimate then cost_usd end), 0)::float8 as estimated_usd
      from provider_usage_costs where workspace_id = ${workspaceId} and created_at >= ${from}`),
  );
  const budget = await getSetting(db, workspaceId, "budget");
  const fx = budget.fxThbPerUsd;

  const orderDays = rows<{ d: string; pending: number; approved: number; reversed: number; orders: number }>(
    await db.execute(sql`select to_char((o.ordered_at + interval '7 hours')::date, 'YYYY-MM-DD') as d,
        coalesce(sum(case when o.status = 'pending' then o.commission end), 0)::float8 as pending,
        coalesce(sum(case when o.status in ('approved','paid') then o.commission end), 0)::float8 as approved,
        coalesce(sum(case when o.status = 'reversed' then o.commission end), 0)::float8 as reversed,
        count(*) filter (where o.status <> 'reversed')::int as orders
      from affiliate_orders o where ${orderWhere(workspaceId, f)} group by 1`),
  );
  const clickDays = rows<{ d: string; clicks: number }>(
    await db.execute(sql`select date::text as d, sum(clicks)::int as clicks from click_stats where ${clickWhere(workspaceId, f)} group by 1`),
  );
  const origins = rows<{ origin: string }>(
    await db.execute(sql`select distinct data_origin as origin from affiliate_orders o where ${orderWhere(workspaceId, f)}
      union select distinct data_origin from click_stats where ${clickWhere(workspaceId, f)}`),
  ).map((r) => r.origin);

  const byDay = new Map<string, { date: string; clicks: number; pending: number; approved: number; reversed: number; orders: number }>();
  const days = Math.max(1, f.periodDays);
  for (let i = days - 1; i >= 0; i--) {
    const d = bangkokDateString(daysAgo(i, f.now ?? new Date()));
    if (d >= fromDate) byDay.set(d, { date: d, clicks: 0, pending: 0, approved: 0, reversed: 0, orders: 0 });
  }
  for (const r of orderDays) {
    const e = byDay.get(r.d);
    if (e) Object.assign(e, { pending: r.pending, approved: r.approved, reversed: r.reversed, orders: r.orders });
  }
  for (const r of clickDays) {
    const e = byDay.get(r.d);
    if (e) e.clicks = r.clicks;
  }

  const t = totals ?? { pending: 0, approved: 0, paid: 0, reversed: 0, orders: 0, gmv: 0, reversed_orders: 0 };
  const validated = t.approved + t.paid;
  const aiCostThb = (cost?.usd ?? 0) * fx;
  return {
    period: { days, from: from.toISOString(), fromDate },
    kpis: {
      clicks: clk?.clicks ?? 0,
      orders: t.orders,
      reversedOrders: t.reversed_orders,
      gmv: t.gmv,
      conversionRate: (clk?.clicks ?? 0) > 0 ? t.orders / clk.clicks : null,
      commission: { pending: t.pending, approved: t.approved, paid: t.paid, reversed: t.reversed },
      validatedCommission: validated,
      aiCostUsd: cost?.usd ?? 0,
      aiCostEstimatedUsd: cost?.estimated_usd ?? 0,
      aiCostThb,
      netRevenueThb: validated - aiCostThb,
      roi: aiCostThb > 0 ? validated / aiCostThb : null,
      fxThbPerUsd: fx,
    },
    trend: [...byDay.values()],
    provenance: { origins, includeDemo: f.includeDemo },
  };
}

export async function getCommissions(db: Db, workspaceId: string, f: AnalyticsFilters) {
  const byPlatform = rows<StatusSums & { platform: string }>(
    await db.execute(sql`select o.platform, ${STATUS_SUMS} from affiliate_orders o where ${orderWhere(workspaceId, f)} group by o.platform order by o.platform`),
  );
  const clicks = rows<{ platform: string; clicks: number }>(
    await db.execute(sql`select platform, sum(clicks)::int as clicks from click_stats where ${clickWhere(workspaceId, f)} group by platform`),
  );
  const byStatus = rows<{ status: string; n: number; commission: number }>(
    await db.execute(sql`select o.status, count(*)::int as n, coalesce(sum(o.commission), 0)::float8 as commission
      from affiliate_orders o where ${orderWhere(workspaceId, f)} group by o.status`),
  );
  return {
    byStatus,
    byPlatform: byPlatform.map((p) => ({ ...p, clicks: clicks.find((c) => c.platform === p.platform)?.clicks ?? 0 })),
  };
}

export async function getPerformance(db: Db, workspaceId: string, f: AnalyticsFilters) {
  const byProduct = rows<StatusSums & { product_ref: string | null; title: string | null; category: string | null; platform: string; product_id: string | null }>(
    await db.execute(sql`
      select o.product_ref, o.platform, p.id as product_id, p.title, c.name as category, ${STATUS_SUMS}
      from affiliate_orders o
      left join lateral (
        select mo.product_id from marketplace_offers mo
        where mo.workspace_id = o.workspace_id and mo.platform = o.platform and mo.external_product_id = o.product_ref
        limit 1
      ) m on true
      left join products p on p.id = coalesce(o.product_id, m.product_id)
      left join categories c on c.id = p.category_id
      where ${orderWhere(workspaceId, f)}
      group by o.product_ref, o.platform, p.id, p.title, c.name
      order by (coalesce(sum(case when o.status in ('approved','paid') then o.commission end),0)
              + coalesce(sum(case when o.status = 'pending' then o.commission end),0)) desc
      limit 20`),
  );
  const byCategory = rows<StatusSums & { category: string | null }>(
    await db.execute(sql`
      select coalesce(c.name, 'ไม่ทราบหมวดหมู่') as category, ${STATUS_SUMS}
      from affiliate_orders o
      left join lateral (
        select mo.product_id from marketplace_offers mo
        where mo.workspace_id = o.workspace_id and mo.platform = o.platform and mo.external_product_id = o.product_ref
        limit 1
      ) m on true
      left join products p on p.id = coalesce(o.product_id, m.product_id)
      left join categories c on c.id = p.category_id
      where ${orderWhere(workspaceId, f)}
      group by 1 order by coalesce(sum(case when o.status in ('approved','paid','pending') then o.commission end),0) desc`),
  );
  const byContent = rows<StatusSums & { sub_id: string | null; project_id: string | null; project_title: string | null; cost_usd: number }>(
    await db.execute(sql`
      select o.sub_id, vp.id as project_id, vp.title as project_title, coalesce(max(vp.actual_cost_usd), 0)::float8 as cost_usd, ${STATUS_SUMS}
      from affiliate_orders o
      left join affiliate_links al on al.workspace_id = o.workspace_id and al.sub_id = o.sub_id
      left join video_projects vp on vp.id = coalesce(o.video_project_id, al.video_project_id)
      where ${orderWhere(workspaceId, f)} and o.sub_id is not null and o.sub_id <> ''
      group by o.sub_id, vp.id, vp.title
      order by coalesce(sum(case when o.status in ('approved','paid','pending') then o.commission end),0) desc
      limit 20`),
  );
  return { byProduct, byCategory, byContent };
}

export async function getCosts(db: Db, workspaceId: string, f: AnalyticsFilters) {
  const { from } = range(f);
  const byOperation = rows<{ provider: string; model: string | null; operation: string; usd: number; n: number; estimated: boolean }>(
    await db.execute(sql`select provider, model, operation, coalesce(sum(cost_usd),0)::float8 as usd, count(*)::int as n, bool_or(is_estimate) as estimated
      from provider_usage_costs where workspace_id = ${workspaceId} and created_at >= ${from}
      group by provider, model, operation order by usd desc`),
  );
  const byDay = rows<{ d: string; usd: number }>(
    await db.execute(sql`select to_char((created_at + interval '7 hours')::date, 'YYYY-MM-DD') as d, coalesce(sum(cost_usd),0)::float8 as usd
      from provider_usage_costs where workspace_id = ${workspaceId} and created_at >= ${from} group by 1 order by 1`),
  );
  const [videos] = rows<{ n: number; usd: number }>(
    await db.execute(sql`select count(*)::int as n, coalesce(sum(actual_cost_usd),0)::float8 as usd from video_projects
      where workspace_id = ${workspaceId} and created_at >= ${from} and status in ('quality_review','approved','exported','published')`),
  );
  const budget = await getSetting(db, workspaceId, "budget");
  return {
    byOperation,
    byDay,
    producedVideos: videos?.n ?? 0,
    costPerVideoUsd: videos && videos.n > 0 ? videos.usd / videos.n : null,
    fxThbPerUsd: budget.fxThbPerUsd,
  };
}
