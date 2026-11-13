import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { categories, products } from "@/db/schema";
import { conflict, parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/core/normalize";

export const GET = route({ permission: "products:read" }, async ({ db, session }) => {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      keywords: categories.keywords,
      products: sql<number>`(select count(*)::int from ${products} p where p.category_id = ${categories.id} and p.deleted_at is null)`,
    })
    .from(categories)
    .where(eq(categories.workspaceId, session.workspaceId))
    .orderBy(asc(categories.name));
  return { items: rows };
});

const Body = z.object({ name: z.string().trim().min(2).max(100), keywords: z.array(z.string().trim().min(1).max(60)).max(100).default([]) });

export const POST = route({ permission: "products:write" }, async ({ req, db, session, ip }) => {
  const body = await parseJson(req, Body);
  const [row] = await db
    .insert(categories)
    .values({ workspaceId: session.workspaceId, name: body.name, slug: slugify(body.name), keywords: body.keywords })
    .onConflictDoNothing()
    .returning();
  if (!row) throw conflict("มีหมวดหมู่นี้แล้ว");
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "category.create", entityType: "category", entityId: row.id, ip });
  return row;
});
