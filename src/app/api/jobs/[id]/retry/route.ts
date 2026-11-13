import { conflict, notFound, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getJobWithEvents, operatorRetry } from "@/lib/admin/jobs";

export const POST = route<{ id: string }>({ permission: "jobs:manage" }, async ({ db, session, params, ip }) => {
  const r = await getJobWithEvents(db, session.workspaceId, params.id);
  if (!r) throw notFound("Job");
  const job = await operatorRetry(db, r.job);
  if (!job) throw conflict("ลองใหม่ได้เฉพาะงานที่ล้มเหลวหรือถูกยกเลิก", "invalid_state");
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "job.retry", entityType: "job", entityId: job.id, metadata: { type: job.type }, ip });
  return { job };
});
