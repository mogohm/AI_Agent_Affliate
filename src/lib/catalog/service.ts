import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  categories,
  categoryMappings,
  commissionSnapshots,
  marketplaceOffers,
  products,
} from "@/db/schema";
import { categorizeByRules, type CategoryRule } from "@/lib/core/categorize";
import { findDuplicate, normalizeGtin, normalizeTitle, type DuplicateCandidate } from "@/lib/core/normalize";

export type DataOrigin = "demo" | "csv" | "feed" | "manual" | "api";
export type Marketplace = "shopee" | "lazada";

export type ProductInput = {
  platform: Marketplace;
  externalProductId: string;
  shopId?: string | null;
  shopName?: string | null;
  variantId?: string | null;
  variantName?: string | null;
  title: string;
  brand?: string | null;
  model?: string | null;
  gtin?: string | null;
  description?: string | null;
  sourceCategory?: string | null;
  categoryId?: string | null;
  imageUrl?: string | null;
  imageRights?: "authorized" | "unknown" | "not_allowed";
  price: number;
  originalPrice?: number | null;
  rating?: number | null;
  ratingCount?: number | null;
  soldCount?: number | null;
  stockStatus?: string | null;
  productUrl?: string | null;
  affiliateUrl?: string | null;
  commissionRate?: number | null;
  sellerRate?: number | null;
  platformRate?: number | null;
  bonusRate?: number | null;
  capAmount?: number | null;
  minBasket?: number | null;
  commissionIsEstimated?: boolean;
  commissionSource?: string | null;
  trendScore?: number | null;
  attributes?: Record<string, string>;
  sourceUpdatedAt?: Date | null;
};

export type UpsertOutcome = {
  status: "inserted" | "updated" | "merged";
  productId: string;
  offerId: string;
  possibleDuplicateOf?: string;
  commissionChanged: boolean;
};

/** Per-import cache so large CSVs do not re-query the catalogue for every row. */
export type CatalogCache = { candidates: DuplicateCandidate[]; categories: CategoryRule[]; mappings: Map<string, string> };

export async function loadCatalogCache(db: Db, workspaceId: string): Promise<CatalogCache> {
  const [cands, cats, maps] = await Promise.all([
    db
      .select({ id: products.id, title: products.title, brand: products.brand, model: products.model, gtin: products.gtin })
      .from(products)
      .where(and(eq(products.workspaceId, workspaceId), isNull(products.deletedAt))),
    db.select().from(categories).where(eq(categories.workspaceId, workspaceId)),
    db.select().from(categoryMappings).where(eq(categoryMappings.workspaceId, workspaceId)),
  ]);
  return {
    candidates: cands,
    categories: cats.map((c) => ({ id: c.id, name: c.name, slug: c.slug, keywords: c.keywords })),
    mappings: new Map(maps.map((m) => [`${m.platform ?? "*"}|${m.sourceCategory.toLowerCase()}`, m.categoryId])),
  };
}

function resolveCategory(input: ProductInput, cache: CatalogCache) {
  if (input.categoryId) return { categoryId: input.categoryId, categorySource: "manual" as const, categoryConfidence: 1 };
  if (input.sourceCategory) {
    const k = input.sourceCategory.toLowerCase();
    const mapped = cache.mappings.get(`${input.platform}|${k}`) ?? cache.mappings.get(`*|${k}`);
    if (mapped) return { categoryId: mapped, categorySource: "mapping" as const, categoryConfidence: 0.95 };
    const byName = cache.categories.find((c) => c.name.toLowerCase() === k || c.slug === k);
    if (byName) return { categoryId: byName.id, categorySource: "source" as const, categoryConfidence: 0.9 };
  }
  const m = categorizeByRules({ title: input.title, sourceCategory: input.sourceCategory, description: input.description }, cache.categories);
  if (m) return { categoryId: m.categoryId, categorySource: "rules" as const, categoryConfidence: m.confidence };
  return { categoryId: null, categorySource: null, categoryConfidence: null };
}

/**
 * Insert or update one marketplace offer and its canonical product.
 * - Same marketplace+shop+product+variant → update in place (new commission snapshot only if terms changed).
 * - Strong identity match (GTIN or brand+model) with an existing product → attach offer to it ("merged").
 * - Title similarity ≥ 0.8 only flags a possible duplicate (needs human confirmation; never auto-merged).
 */
export async function upsertProductOffer(
  db: Db,
  workspaceId: string,
  input: ProductInput,
  origin: DataOrigin,
  opts: { dataSourceId?: string | null; cache?: CatalogCache; now?: Date } = {},
): Promise<UpsertOutcome> {
  const now = opts.now ?? new Date();
  const cache = opts.cache ?? (await loadCatalogCache(db, workspaceId));
  const shopId = input.shopId?.trim() ?? "";
  const variantId = input.variantId?.trim() ?? "";
  const attributes = { ...(input.attributes ?? {}) };
  if (input.trendScore !== null && input.trendScore !== undefined) attributes.trend_score = String(input.trendScore);

  const [existingOffer] = await db
    .select()
    .from(marketplaceOffers)
    .where(
      and(
        eq(marketplaceOffers.workspaceId, workspaceId),
        eq(marketplaceOffers.platform, input.platform),
        eq(marketplaceOffers.shopId, shopId),
        eq(marketplaceOffers.externalProductId, input.externalProductId.trim()),
        eq(marketplaceOffers.variantId, variantId),
      ),
    )
    .limit(1);

  const offerValues = {
    shopName: input.shopName ?? null,
    variantName: input.variantName ?? null,
    price: input.price,
    originalPrice: input.originalPrice ?? null,
    rating: input.rating ?? null,
    ratingCount: input.ratingCount ?? null,
    soldCount: input.soldCount ?? null,
    stockStatus: input.stockStatus ?? null,
    productUrl: input.productUrl ?? null,
    affiliateUrl: input.affiliateUrl ?? null,
    dataOrigin: origin,
    dataSourceId: opts.dataSourceId ?? null,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    fetchedAt: now,
    updatedAt: now,
  };

  let productId: string;
  let offerId: string;
  let status: UpsertOutcome["status"];
  let possibleDuplicateOf: string | undefined;

  if (existingOffer) {
    productId = existingOffer.productId;
    offerId = existingOffer.id;
    status = "updated";
    await db.update(marketplaceOffers).set(offerValues).where(eq(marketplaceOffers.id, offerId));
    const [prod] = await db.select().from(products).where(eq(products.id, productId));
    await db
      .update(products)
      .set({
        title: input.title,
        normalizedTitle: normalizeTitle(input.title),
        brand: input.brand ?? prod?.brand ?? null,
        model: input.model ?? prod?.model ?? null,
        gtin: normalizeGtin(input.gtin) ?? prod?.gtin ?? null,
        description: input.description ?? prod?.description ?? null,
        sourceCategory: input.sourceCategory ?? prod?.sourceCategory ?? null,
        imageUrl: input.imageUrl ?? prod?.imageUrl ?? null,
        imageRights: input.imageRights ?? prod?.imageRights ?? "unknown",
        attributes: { ...(prod?.attributes ?? {}), ...attributes },
        dataOrigin: origin,
        updatedAt: now,
      })
      .where(eq(products.id, productId));
  } else {
    const candidate: DuplicateCandidate = { id: "", title: input.title, brand: input.brand, model: input.model, gtin: input.gtin };
    const dup = findDuplicate(candidate, cache.candidates);
    if (dup && dup.reason !== "title") {
      productId = dup.id;
      status = "merged";
    } else {
      const cat = resolveCategory(input, cache);
      const [p] = await db
        .insert(products)
        .values({
          workspaceId,
          title: input.title,
          normalizedTitle: normalizeTitle(input.title),
          brand: input.brand ?? null,
          model: input.model ?? null,
          gtin: normalizeGtin(input.gtin),
          description: input.description ?? null,
          sourceCategory: input.sourceCategory ?? null,
          categoryId: cat.categoryId,
          categorySource: cat.categorySource,
          categoryConfidence: cat.categoryConfidence,
          imageUrl: input.imageUrl ?? null,
          imageRights: input.imageRights ?? "unknown",
          attributes,
          dataOrigin: origin,
        })
        .returning({ id: products.id });
      productId = p.id;
      status = "inserted";
      cache.candidates.push({ id: productId, title: input.title, brand: input.brand, model: input.model, gtin: input.gtin });
      if (dup) {
        // possible duplicate (title similarity) → group for human review, never auto-merge
        const [other] = await db.select({ g: products.duplicateGroupId }).from(products).where(eq(products.id, dup.id));
        const groupId = other?.g ?? dup.id;
        await db.update(products).set({ duplicateGroupId: groupId, duplicateReason: `title~${dup.similarity}` }).where(eq(products.id, dup.id));
        await db.update(products).set({ duplicateGroupId: groupId, duplicateReason: `title~${dup.similarity}` }).where(eq(products.id, productId));
        possibleDuplicateOf = dup.id;
      }
    }
    const [o] = await db
      .insert(marketplaceOffers)
      .values({
        workspaceId,
        productId,
        platform: input.platform,
        shopId,
        externalProductId: input.externalProductId.trim(),
        variantId,
        ...offerValues,
      })
      .returning({ id: marketplaceOffers.id });
    offerId = o.id;
  }

  const commissionChanged = await recordCommission(db, workspaceId, offerId, input, origin, now);
  return { status, productId, offerId, possibleDuplicateOf, commissionChanged };
}

/** Append a commission snapshot when terms are provided and differ from the latest snapshot. */
async function recordCommission(db: Db, workspaceId: string, offerId: string, input: ProductInput, origin: DataOrigin, now: Date) {
  if (input.commissionRate === null || input.commissionRate === undefined) return false;
  const [latest] = await db
    .select()
    .from(commissionSnapshots)
    .where(eq(commissionSnapshots.offerId, offerId))
    .orderBy(desc(commissionSnapshots.fetchedAt))
    .limit(1);
  const same =
    latest &&
    Number(latest.rateTotal) === Number(input.commissionRate) &&
    (latest.capAmount ?? null) === (input.capAmount ?? null) &&
    (latest.minBasket ?? null) === (input.minBasket ?? null) &&
    latest.isEstimated === !!input.commissionIsEstimated &&
    latest.dataOrigin === origin;
  if (same) return false;
  await db.insert(commissionSnapshots).values({
    workspaceId,
    offerId,
    rateTotal: input.commissionRate,
    sellerRate: input.sellerRate ?? null,
    platformRate: input.platformRate ?? null,
    bonusRate: input.bonusRate ?? null,
    capAmount: input.capAmount ?? null,
    minBasket: input.minBasket ?? null,
    isEstimated: !!input.commissionIsEstimated,
    fetchedAt: now,
    sourceReference: input.commissionSource ?? null,
    confidence: origin === "api" ? 1 : origin === "demo" ? 0.3 : input.commissionIsEstimated ? 0.5 : 0.8,
    dataOrigin: origin,
  });
  return true;
}

// ---------------------------------------------------------------- explorer query
export const SORTS = {
  commission_amount: "est_commission desc nulls last",
  commission_rate: "rate_total desc nulls last",
  score: "score desc nulls last",
  price_asc: "price asc",
  price_desc: "price desc",
  newest: "created_at desc",
  freshness: "fetched_at desc",
} as const;
export type SortKey = keyof typeof SORTS;

export type OfferFilters = {
  search?: string;
  marketplace?: Marketplace;
  categoryId?: string;
  origin?: DataOrigin;
  minPrice?: number;
  maxPrice?: number;
  minRate?: number;
  minCommission?: number;
  minScore?: number;
  shortlistId?: string;
  duplicatesOnly?: boolean;
  needsReview?: boolean;
  productId?: string;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
};

export type OfferRow = {
  offer_id: string;
  product_id: string;
  title: string;
  brand: string | null;
  image_url: string | null;
  image_rights: "authorized" | "unknown" | "not_allowed";
  category_id: string | null;
  category_name: string | null;
  category_source: string | null;
  platform: Marketplace;
  shop_name: string | null;
  external_product_id: string;
  price: number;
  rating: number | null;
  rating_count: number | null;
  sold_count: number | null;
  product_url: string | null;
  affiliate_url: string | null;
  data_origin: DataOrigin;
  fetched_at: string;
  created_at: string;
  rate_total: number | null;
  cap_amount: number | null;
  rate_is_estimated: boolean | null;
  commission_origin: DataOrigin | null;
  commission_fetched_at: string | null;
  est_commission: number | null;
  score: number | null;
  score_confidence: number | null;
  needs_review: boolean | null;
  analyzer: string | null;
  duplicate_group_id: string | null;
  duplicate_reason: string | null;
  shortlisted: boolean;
};

/** Server-side filtered, sorted and paginated offer list (one row per marketplace offer). */
export async function listOffers(db: Db, workspaceId: string, f: OfferFilters = {}) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 25));
  const where: SQL[] = [sql`p.workspace_id = ${workspaceId}`, sql`p.deleted_at is null`];
  if (f.search?.trim()) {
    const q = `%${f.search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(p.title ilike ${q} or p.brand ilike ${q} or c.name ilike ${q} or o.shop_name ilike ${q} or o.external_product_id ilike ${q})`);
  }
  if (f.marketplace) where.push(sql`o.platform = ${f.marketplace}`);
  if (f.categoryId) where.push(sql`p.category_id = ${f.categoryId}`);
  if (f.origin) where.push(sql`o.data_origin = ${f.origin}`);
  if (f.minPrice !== undefined) where.push(sql`o.price >= ${f.minPrice}`);
  if (f.maxPrice !== undefined) where.push(sql`o.price <= ${f.maxPrice}`);
  if (f.minRate !== undefined) where.push(sql`cs.rate_total >= ${f.minRate}`);
  if (f.minScore !== undefined) where.push(sql`sc.score >= ${f.minScore}`);
  if (f.duplicatesOnly) where.push(sql`p.duplicate_group_id is not null`);
  if (f.needsReview) where.push(sql`coalesce(sc.needs_review, true) = true`);
  if (f.productId) where.push(sql`p.id = ${f.productId}`);
  if (f.shortlistId) where.push(sql`exists (select 1 from shortlist_items si where si.shortlist_id = ${f.shortlistId} and si.product_id = p.id)`);

  const estExpr = sql`case when cs.rate_total is null then null
      when cs.min_basket is not null and o.price < cs.min_basket then 0
      else round(least(o.price * cs.rate_total / 100, coalesce(cs.cap_amount, o.price * cs.rate_total / 100))::numeric, 2) end`;
  const base = sql`
    from marketplace_offers o
    join products p on p.id = o.product_id
    left join categories c on c.id = p.category_id
    left join lateral (
      select * from commission_snapshots s where s.offer_id = o.id
        and (s.effective_to is null or s.effective_to >= now())
      order by s.fetched_at desc limit 1
    ) cs on true
    left join lateral (
      select * from product_scores ps where ps.product_id = p.id order by ps.created_at desc limit 1
    ) sc on true
    where ${sql.join(where, sql` and `)}`;

  const minCommission = f.minCommission !== undefined ? sql` and (${estExpr}) >= ${f.minCommission}` : sql``;
  const sortKey: SortKey = f.sort && f.sort in SORTS ? f.sort : "commission_amount";

  const rowsRes = await db.execute(sql`
    select * from (
      select o.id as offer_id, p.id as product_id, p.title, p.brand, p.image_url, p.image_rights,
        p.category_id, c.name as category_name, p.category_source,
        o.platform, o.shop_name, o.external_product_id, o.price::float8 as price,
        o.rating, o.rating_count, o.sold_count, o.product_url, o.affiliate_url, o.data_origin,
        o.fetched_at, o.created_at,
        cs.rate_total::float8 as rate_total, cs.cap_amount::float8 as cap_amount, cs.is_estimated as rate_is_estimated,
        cs.data_origin as commission_origin, cs.fetched_at as commission_fetched_at,
        (${estExpr})::float8 as est_commission,
        sc.score, sc.confidence as score_confidence, sc.needs_review, sc.analyzer,
        p.duplicate_group_id, p.duplicate_reason,
        exists (select 1 from shortlist_items si join shortlists sl on sl.id = si.shortlist_id
                where si.product_id = p.id and sl.workspace_id = ${workspaceId}) as shortlisted
      ${base} ${minCommission}
    ) x
    order by ${sql.raw(SORTS[sortKey])}, offer_id
    limit ${pageSize} offset ${(page - 1) * pageSize}`);
  const countRes = await db.execute(sql`select count(*)::int as n ${base} ${minCommission}`);
  const items = (rowsRes as unknown as { rows: OfferRow[] }).rows;
  const total = Number((countRes as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
  return { items, total, page, pageSize };
}
