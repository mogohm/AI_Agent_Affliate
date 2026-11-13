import OpenAI from "openai";
import type { Db } from "@/db/client";
import { env } from "@/lib/env";
import { getSecret, getSettings, type SettingsMap } from "@/lib/settings";

export type AiContext = {
  /** "live" only when the workspace enabled live mode AND an API key is configured. */
  mode: "demo" | "live";
  client: OpenAI | null;
  models: SettingsMap["ai.models"];
  pricing: SettingsMap["ai.pricing"];
  videoProviders: SettingsMap["video.providers"];
  /** Why live AI is not active (shown in UI). */
  reason: string | null;
};

/** Allows tests to inject a fake OpenAI client. */
const g = globalThis as unknown as { __openaiFactory?: (apiKey: string) => OpenAI };
export function __setOpenAIFactory(f: ((apiKey: string) => OpenAI) | undefined) {
  g.__openaiFactory = f;
}

export async function getAiContext(db: Db, workspaceId: string): Promise<AiContext> {
  const s = await getSettings(db, workspaceId, ["ai.mode", "ai.models", "ai.pricing", "video.providers"]);
  const base = { models: s["ai.models"], pricing: s["ai.pricing"], videoProviders: s["video.providers"] };
  if (s["ai.mode"] !== "live") {
    return { ...base, mode: "demo", client: null, reason: "AI อยู่ใน Demo Mode (ตั้งค่า > AI Providers เพื่อเปิด Live)" };
  }
  const key = await getSecret(db, workspaceId, "secret.openaiApiKey");
  if (!key.value) {
    return { ...base, mode: "demo", client: null, reason: "เปิด Live Mode แล้วแต่ยังไม่ได้กำหนด OpenAI API Key" };
  }
  const client = g.__openaiFactory
    ? g.__openaiFactory(key.value)
    : new OpenAI({ apiKey: key.value, baseURL: env().OPENAI_BASE_URL || undefined, timeout: 120_000, maxRetries: 2 });
  return { ...base, mode: "live", client, reason: null };
}
