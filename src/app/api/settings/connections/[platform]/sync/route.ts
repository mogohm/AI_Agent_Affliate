import { z } from "zod";
import { conflict, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { enqueueJob } from "@/lib/jobs/queue";
import { getConnection } from "@/lib/marketplace";

const Body = z.object({ keyword: z.string().max(200).optional(), maxPages: z.number().int().min(1).max(20).optional() });

/** Enqueue a sync from the official API — only for verified (connected) connections. */
export const POST = route<{ platform: string }>({ permission: "credentials:manage" }, async ({ req, db, session, params, ip }) => {
  const platform = z.enum(["shopee", "lazada"]).parse(params.platform);
  const text = await req.text();
  const body = Body.parse(text ? JSON.parse(text) : {});
  const conn = await getConnection(db, session.workspaceId, platform);
  if (conn.status !== "connected") throw conflict("ต้องทดสอบการเชื่อมต่อให้สำเร็จก่อน (สถานะต้องเป็น 'เชื่อมต่อแล้ว')", "not_connected");
  const { job } = await enqueueJob(db, {
    workspaceId: session.workspaceId,
    type: "marketplace.sync",
    payload: { platform, ...body },
    idempotencyKey: `sync:${platform}:${new Date().toISOString().slice(0, 15)}`,
    createdBy: session.id,
  });
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "connection.sync_enqueue", entityType: "job", entityId: job.id, ip });
  return { jobId: job.id };
});
