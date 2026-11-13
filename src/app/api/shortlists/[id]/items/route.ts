import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { products, shortlistItems, shortlists } from "@/db/schema";
import { notFound, parseJson, route } from "@/lib/api";
import type { Db } from "@/db/client";

type P = { id: string };
const Body = z.object({ productIds: z.array(z.string().uuid()).min(1).max(500) });

async function ownList(db: Db, workspaceId: string, id: string) {
  const [l] = await db.select().from(shortlists).where(and(eq(shortlists.id, z.string().uuid().parse(id)), eq(shortlists.workspaceId, workspaceId)));
  if (!l) throw notFound("Shortlist");
  return l;
}

export const POST = route<P>({ permission: "products:write" }, async ({ req, db, session, params }) => {
  const list = await ownList(db, session.workspaceId, params.id);
  const body = await parseJson(req, Body);
  const valid = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.workspaceId, session.workspaceId), inArray(products.id, body.productIds), isNull(products.deletedAt)));
  if (valid.length) {
    await db
      .insert(shortlistItems)
      .values(valid.map((v) => ({ shortlistId: list.id, productId: v.id })))
      .onConflictDoNothing();
  }
  return { added: valid.length };
});

export const DELETE = route<P>({ permission: "products:write" }, async ({ req, db, session, params }) => {
  const list = await ownList(db, session.workspaceId, params.id);
  const body = await parseJson(req, Body);
  await db.delete(shortlistItems).where(and(eq(shortlistItems.shortlistId, list.id), inArray(shortlistItems.productId, body.productIds)));
  return { ok: true };
});
