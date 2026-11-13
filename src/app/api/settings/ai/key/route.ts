import { z } from "zod";
import { parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { describeSecret, setSecret, setSetting } from "@/lib/settings";

const Body = z.object({ apiKey: z.string().trim().min(20, "API Key สั้นเกินไป").max(400).regex(/^\S+$/, "API Key ต้องไม่มีช่องว่าง") });

/** Write-only: the key is encrypted server-side and never returned. */
export const PUT = route({ permission: "credentials:manage" }, async ({ db, session, req, ip }) => {
  const { apiKey } = await parseJson(req, Body);
  await setSecret(db, session.workspaceId, "secret.openaiApiKey", apiKey, session.id);
  const key = await describeSecret(db, session.workspaceId, "secret.openaiApiKey");
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "credentials.openai_set", metadata: { masked: key.masked }, ip });
  return { key };
});

export const DELETE = route({ permission: "credentials:manage" }, async ({ db, session, ip }) => {
  await setSecret(db, session.workspaceId, "secret.openaiApiKey", null, session.id);
  const key = await describeSecret(db, session.workspaceId, "secret.openaiApiKey");
  // Without a workspace key (and no env fallback) live mode cannot work — fall back to demo explicitly.
  if (!key.configured) await setSetting(db, session.workspaceId, "ai.mode", "demo", session.id);
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "credentials.openai_remove", ip });
  return { key };
});
