import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categories, commissionSnapshots, dataSources, marketplaceOffers, productScores, products, shortlistItems, shortlists } from "@/db/schema";
import { estimateCommission, freshness } from "@/lib/core/commission";

export async function getProductDetail(db: Db, workspaceId: string, productId: string) {
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.workspaceId, workspaceId), isNull(products.deletedAt)));
  if (!p) return null;
  const [cat] = p.categoryId ? await db.select().from(categories).where(eq(categories.id, p.categoryId)) : [];
  const offers = await db
    .select({ o: marketplaceOffers, sourceName: dataSources.name, sourceType: dataSources.type })
    .from(marketplaceOffers)
    .leftJoin(dataSources, eq(dataSources.id, marketplaceOffers.dataSourceId))
    .where(eq(marketplaceOffers.productId, productId))
    .orderBy(marketplaceOffers.platform);
  const offerIds = offers.map((x) => x.o.id);
  const snaps = offerIds.length
    ? await db.select().from(commissionSnapshots).where(inArray(commissionSnapshots.offerId, offerIds)).orderBy(desc(commissionSnapshots.fetchedAt))
    : [];
  const scoreHistory = await db.select().from(productScores).where(eq(productScores.productId, productId)).orderBy(desc(productScores.createdAt)).limit(6);
  const group = p.duplicateGroupId
    ? await db
        .select({ id: products.id, title: products.title, dataOrigin: products.dataOrigin, duplicateReason: products.duplicateReason })
        .from(products)
        .where(and(eq(products.duplicateGroupId, p.duplicateGroupId), ne(products.id, p.id), isNull(products.deletedAt)))
    : [];
  const lists = await db
    .select({ id: shortlists.id, name: shortlists.name })
    .from(shortlistItems)
    .innerJoin(shortlists, eq(shortlists.id, shortlistItems.shortlistId))
    .where(eq(shortlistItems.productId, productId));

  const now = new Date();
  return {
    product: p,
    category: cat ? { id: cat.id, name: cat.name, slug: cat.slug } : null,
    offers: offers.map(({ o, sourceName, sourceType }) => {
      const history = snaps.filter((s) => s.offerId === o.id);
      const current = history.find((s) => !s.effectiveTo || s.effectiveTo >= now) ?? null;
      const est = current ? estimateCommission({ price: o.price, rateTotal: current.rateTotal, capAmount: current.capAmount, minBasket: current.minBasket }) : null;
      return {
        ...o,
        sourceName,
        sourceType,
        freshness: freshness(o.fetchedAt, now),
        currentCommission: current,
        estCommission: est?.amount ?? null,
        estCapped: est?.capped ?? false,
        commissionHistory: history,
      };
    }),
    latestScore: scoreHistory[0] ?? null,
    scoreHistory,
    duplicates: group,
    shortlists: lists,
  };
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductDetail>>>;
