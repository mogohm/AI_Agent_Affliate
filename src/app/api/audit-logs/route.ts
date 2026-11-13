import { and, count, desc, eq, ilike, type SQL } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, users } from "@/db/schema";
import { parseQuery, route } from "@/lib/api";

const Q = z.object({
  action: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const GET = route({ permission: "audit:read" }, async ({ db, session, req }) => {
  const q = parseQuery(req, Q);
  const where: SQL[] = [eq(auditLogs.workspaceId, session.workspaceId)];
  if (q.action) where.push(ilike(auditLogs.action, `%${q.action.replace(/[%_]/g, "")}%`));
  const items = await db
    .select({ log: auditLogs, userName: users.name, userEmail: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(and(...where))
    .orderBy(desc(auditLogs.createdAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const [{ n }] = await db.select({ n: count() }).from(auditLogs).where(and(...where));
  return { items: items.map((i) => ({ ...i.log, userName: i.userName, userEmail: i.userEmail })), total: n, page: q.page, pageSize: q.pageSize };
});
