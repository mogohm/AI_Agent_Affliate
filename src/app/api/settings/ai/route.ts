import { z } from "zod";
import { badRequest, parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getAiContext } from "@/lib/ai/context";
import { describeSecret, getSecret, getSettings, setSetting } from "@/lib/settings";

async function view(db: Parameters<typeof getSettings>[0], ws: string) {
  const s = await getSettings(db, ws, ["ai.mode", "ai.models", "ai.pricing"]);
  const ai = await getAiContext(db, ws);
  return {
    mode: s["ai.mode"],
    effectiveMode: ai.mode,
    reason: ai.reason,
    models: s["ai.models"],
    pricing: s["ai.pricing"],
    key: await describeSecret(db, ws, "secret.openaiApiKey"),
  };
}

export const GET = route({ permission: "settings:read" }, async ({ db, session }) => view(db, session.workspaceId));

const model = z.string().trim().min(1).max(100);
const price = z.number().min(0).max(10_000);
const Patch = z.object({
  mode: z.enum(["demo", "live"]).optional(),
  models: z.object({ text: model, image: model, tts: model, video: model, imageQuality: z.enum(["low", "medium", "high"]) }).partial().optional(),
  pricing: z
    .object({ textInputPer1M: price, textOutputPer1M: price, imagePerImage: price, ttsPer1MChars: price, videoPerSecond: price })
    .partial()
    .optional(),
});

export const PATCH = route({ permission: "settings:manage" }, async ({ db, session, req, ip }) => {
  const b = await parseJson(req, Patch);
  const ws = session.workspaceId;
  if (b.mode === "live") {
    const key = await getSecret(db, ws, "secret.openaiApiKey");
    if (!key.value) throw badRequest("ต้องกำหนด OpenAI API Key ก่อนเปิด Live Mode");
  }
  const cur = await getSettings(db, ws, ["ai.models", "ai.pricing"]);
  if (b.mode) await setSetting(db, ws, "ai.mode", b.mode, session.id);
  if (b.models) await setSetting(db, ws, "ai.models", { ...cur["ai.models"], ...b.models }, session.id);
  if (b.pricing) await setSetting(db, ws, "ai.pricing", { ...cur["ai.pricing"], ...b.pricing }, session.id);
  await audit(db, { workspaceId: ws, userId: session.id, action: "settings.ai_update", metadata: { mode: b.mode, models: b.models, pricingChanged: !!b.pricing }, ip });
  return view(db, ws);
});
