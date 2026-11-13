import { route } from "@/lib/api";
import { enqueueScriptGeneration } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

/** Queue (re)generation of script + storyboard. */
export const POST = route<{ id: string }>({ permission: "video:create" }, async ({ db, session, params }) => {
  return enqueueScriptGeneration(db, session.workspaceId, params.id, session.id);
});
