import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { marketplaceOffers, products, productScores, shortlistItems, videoProjects } from "@/db/schema";
import { badRequest, notFound, parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { rescoreProduct } from "@/lib/catalog/scoring-service";

type P = { id: string };
const Body = z.object({
  action: z.enum(["merge", "dismiss"]),
  /** merge: the other product whose offers move into this one */
  otherId: z.string().uuid().optional(),
});

/**
 * Human resolution of a possible duplicate (title similarity only).
 * - dismiss: remove this product from its duplicate group
 * - merge: move otherId's offers into this product and soft-delete otherId
 */
export const POST = route<P>({ permission: "products:write" }, async ({ req, db, session, params, ip }) => {
  const id = z.string().uuid().parse(params.id);
  const body = await parseJson(req, Body);
  const ws = session.workspaceId;
  const [p] = await db.select().from(products).where(and(eq(products.id, id), eq(products.workspaceId, ws), isNull(products.deletedAt)));
  if (!p) throw notFound("Product");
  if (body.action === "dismiss") {
    await db.update(products).set({ duplicateGroupId: null, duplicateReason: null, updatedAt: new Date() }).where(eq(products.id, id));
    // a group with a single remaining member is no longer a group
    if (p.duplicateGroupId) {
      const rest = await db.select({ id: products.id }).from(products).where(and(eq(products.duplicateGroupId, p.duplicateGroupId), isNull(products.deletedAt)));
      if (rest.length === 1) await db.update(products).set({ duplicateGroupId: null, duplicateReason: null }).where(eq(products.id, rest[0].id));
    }
  } else {
    if (!body.otherId || body.otherId === id) throw badRequest("ต้องระบุสินค้าที่จะรวม");
    const [o] = await db.select().from(products).where(and(eq(products.id, body.otherId), eq(products.workspaceId, ws), isNull(products.deletedAt)));
    if (!o) throw notFound("Product to merge");
    await db.update(marketplaceOffers).set({ productId: id, updatedAt: new Date() }).where(eq(marketplaceOffers.productId, o.id));
    await db.update(videoProjects).set({ productId: id }).where(eq(videoProjects.productId, o.id));
    await db.delete(shortlistItems).where(eq(shortlistItems.productId, o.id));
    await db.delete(productScores).where(eq(productScores.productId, o.id));
    await db.update(products).set({ deletedAt: new Date(), duplicateReason: `merged_into:${id}` }).where(eq(products.id, o.id));
    await db.update(products).set({ duplicateReason: "confirmed_by_human", updatedAt: new Date() }).where(eq(products.id, id));
  }
  await rescoreProduct(db, ws, id);
  await audit(db, { workspaceId: ws, userId: session.id, action: `product.duplicate_${body.action}`, entityType: "product", entityId: id, metadata: { otherId: body.otherId }, ip });
  return { ok: true };
});
