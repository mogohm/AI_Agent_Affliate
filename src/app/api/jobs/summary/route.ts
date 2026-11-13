import { route } from "@/lib/api";
import { jobSummary } from "@/lib/admin/jobs";

export const GET = route({ permission: "video:read" }, async ({ db, session }) => jobSummary(db, session.workspaceId));
