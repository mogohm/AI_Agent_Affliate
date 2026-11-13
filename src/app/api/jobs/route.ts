import { z } from "zod";
import { parseQuery, route } from "@/lib/api";
import { listJobs } from "@/lib/admin/jobs";

const Q = z.object({
  status: z.union([z.string(), z.array(z.string())]).optional(),
  type: z.string().max(64).optional(),
  projectId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const STATUSES = ["queued", "running", "succeeded", "failed", "canceled"];

export const GET = route({ permission: "video:read" }, async ({ db, session, req }) => {
  const q = parseQuery(req, Q);
  const status = (Array.isArray(q.status) ? q.status : q.status ? q.status.split(",") : []).filter((s) => STATUSES.includes(s));
  return listJobs(db, session.workspaceId, { ...q, status });
});
