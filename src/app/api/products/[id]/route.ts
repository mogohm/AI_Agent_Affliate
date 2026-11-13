import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { products } from "@/db/schema";
import { notFound, parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getProductDetail } from "@/lib/catalog/detail";
import { rescoreProduct } from "@/lib/catalog/scoring-service";

type P = { id: string };
const Id = z.string().uuid();

export const GET = route<P>({ permission: "products:read" }, async ({ db, session, params }) => {
  const d = await getProductDetail(db, session.workspaceId, Id.parse(params.id));
  if (!d) throw notFound("Product");
  return d;
});

const Patch = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  imageRights: z.enum(["authorized", "unknown", "not_allowed"]).optional(),
  imageUrl: z.string().url().nullable().optional(),
  title: z.string().trim().min(2).max(500).optional(),
  brand: z.string().trim().max(200).nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
});

export const PATCH = route<P>({ permission: "products:write" }, async ({ req, db, session, params, ip }) => {
  const id = Id.parse(params.id);
  const body = await parseJson(req, Patch);
  const set: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
  if (body.categoryId !== undefined) Object.assign(set, { categoryId: body.categoryId, categorySource: body.categoryId ? "manual" : null, categoryConfidence: body.categoryId ? 1 : null });
  for (const k of ["imageRights", "imageUrl", "title", "brand", "model", "description"] as const) if (body[k] !== undefined) Object.assign(set, { [k]: body[k] });
  const [row] = await db
    .update(products)
    .set(set)
    .where(and(eq(products.id, id), eq(products.workspaceId, session.workspaceId), isNull(products.deletedAt)))
    .returning({ id: products.id });
  if (!row) throw notFound("Product");
  await rescoreProduct(db, session.workspaceId, id);
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "product.update", entityType: "product", entityId: id, metadata: body, ip });
  return { ok: true };
});

export const DELETE = route<P>({ permission: "products:write" }, async ({ db, session, params, ip }) => {
  const id = Id.parse(params.id);
  const [row] = await db
    .update(products)
    .set({ deletedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.workspaceId, session.workspaceId), isNull(products.deletedAt)))
    .returning({ id: products.id });
  if (!row) throw notFound("Product");
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "product.delete", entityType: "product", entityId: id, ip });
  return { ok: true };
});
