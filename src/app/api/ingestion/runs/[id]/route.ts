import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ingestionRuns } from "@/db/schema";
import { notFound, route } from "@/lib/api";

export const GET = route<{ id: string }>({ permission: "products:read" }, async ({ db, session, params }) => {
  const [run] = await db
    .select()
    .from(ingestionRuns)
    .where(and(eq(ingestionRuns.id, z.string().uuid().parse(params.id)), eq(ingestionRuns.workspaceId, session.workspaceId)));
  if (!run) throw notFound("Ingestion run");
  return run;
});
