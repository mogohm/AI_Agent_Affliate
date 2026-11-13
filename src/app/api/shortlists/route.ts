import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { shortlistItems, shortlists } from "@/db/schema";
import { parseJson, route } from "@/lib/api";

export const GET = route({ permission: "products:read" }, async ({ db, session }) => {
  const rows = await db
    .select({
      id: shortlists.id,
      name: shortlists.name,
      createdAt: shortlists.createdAt,
      count: sql<number>`(select count(*)::int from ${shortlistItems} si where si.shortlist_id = ${shortlists.id})`,
    })
    .from(shortlists)
    .where(eq(shortlists.workspaceId, session.workspaceId))
    .orderBy(desc(shortlists.createdAt));
  return { items: rows };
});

const Body = z.object({ name: z.string().trim().min(1).max(100) });

export const POST = route({ permission: "products:write" }, async ({ req, db, session }) => {
  const body = await parseJson(req, Body);
  const [row] = await db.insert(shortlists).values({ workspaceId: session.workspaceId, name: body.name, createdBy: session.id }).returning();
  return row;
});
