import { desc, eq } from "drizzle-orm";
import { dataSources, ingestionRuns, users } from "@/db/schema";
import { route } from "@/lib/api";

export const GET = route({ permission: "products:read" }, async ({ db, session }) => {
  const rows = await db
    .select({
      id: ingestionRuns.id,
      kind: ingestionRuns.kind,
      status: ingestionRuns.status,
      fileName: ingestionRuns.fileName,
      totalRows: ingestionRuns.totalRows,
      inserted: ingestionRuns.inserted,
      updated: ingestionRuns.updated,
      duplicates: ingestionRuns.duplicates,
      failed: ingestionRuns.failed,
      createdAt: ingestionRuns.createdAt,
      finishedAt: ingestionRuns.finishedAt,
      sourceName: dataSources.name,
      sourceType: dataSources.type,
      createdBy: users.name,
    })
    .from(ingestionRuns)
    .leftJoin(dataSources, eq(dataSources.id, ingestionRuns.dataSourceId))
    .leftJoin(users, eq(users.id, ingestionRuns.createdBy))
    .where(eq(ingestionRuns.workspaceId, session.workspaceId))
    .orderBy(desc(ingestionRuns.createdAt))
    .limit(50);
  return { items: rows };
});
