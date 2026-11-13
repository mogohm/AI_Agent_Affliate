import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { enqueueAnalysis } from "@/lib/catalog/analyze";

const Body = z
  .object({ productIds: z.array(z.string().uuid()).max(500).optional(), all: z.boolean().optional() })
  .refine((b) => b.all || (b.productIds && b.productIds.length > 0), "ต้องระบุสินค้าหรือเลือกทั้งหมด");

/** Enqueue AI / rule-based analysis (+ re-score) — runs in the worker. */
export const POST = route({ permission: "products:write" }, async ({ req, db, session, ip }) => {
  const body = await parseJson(req, Body);
  const { job, created } = await enqueueAnalysis(db, session.workspaceId, body, session.id);
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "product.analyze_enqueue", entityType: "job", entityId: job.id, metadata: { count: body.productIds?.length ?? "all" }, ip });
  return { jobId: job.id, created };
});
