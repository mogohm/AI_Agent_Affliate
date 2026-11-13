import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { listOffers } from "@/lib/catalog/service";

export const dynamic = "force-dynamic";

const Q = z.object({ search: z.string().max(200).optional(), offerId: z.string().uuid().optional() });

/** Lightweight product/offer picker for the Studio (sorted by estimated commission). */
export const GET = route({ permission: "video:read" }, async ({ req, db, session }) => {
  const q = parseQuery(req, Q);
  const { items } = await listOffers(db, session.workspaceId, { search: q.search, sort: "commission_amount", pageSize: 30 });
  let list = items;
  if (q.offerId && !items.some((i) => i.offer_id === q.offerId)) {
    const all = await listOffers(db, session.workspaceId, { pageSize: 200 });
    const hit = all.items.find((i) => i.offer_id === q.offerId);
    if (hit) list = [hit, ...items];
  }
  return {
    items: list.map((o) => ({
      offerId: o.offer_id,
      productId: o.product_id,
      title: o.title,
      platform: o.platform,
      price: o.price,
      rate: o.rate_total,
      estCommission: o.est_commission,
      score: o.score,
      origin: o.data_origin,
      imageRights: o.image_rights,
      categoryName: o.category_name,
    })),
  };
});
