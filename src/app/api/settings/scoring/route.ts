import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { DEFAULT_WEIGHTS } from "@/lib/core/scoring";
import { getSetting, setSetting } from "@/lib/settings";

export const GET = route({ permission: "settings:read" }, async ({ db, session }) => ({
  weights: await getSetting(db, session.workspaceId, "scoring.weights"),
  defaults: DEFAULT_WEIGHTS,
}));

const w = z.number().min(0).max(100);
const Body = z
  .object({ commissionAmount: w, sales: w, rating: w, commissionRate: w, trend: w, content: w })
  .refine((x) => Object.values(x).reduce((a, b) => a + b, 0) > 0, { message: "น้ำหนักรวมต้องมากกว่า 0" });

export const PATCH = route({ permission: "settings:manage" }, async ({ db, session, req, ip }) => {
  const weights = await parseJson(req, Body);
  await setSetting(db, session.workspaceId, "scoring.weights", weights, session.id);
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "settings.scoring_update", metadata: weights, ip });
  return { weights };
});
