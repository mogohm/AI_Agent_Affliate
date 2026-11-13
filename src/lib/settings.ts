import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { DEFAULT_WEIGHTS, type ScoringWeights } from "@/lib/core/scoring";

/** Typed, non-secret workspace settings and their defaults. */
export type SettingsMap = {
  "ai.mode": "demo" | "live";
  "ai.models": { text: string; image: string; tts: string; video: string; imageQuality: "low" | "medium" | "high" };
  /** USD price estimates used for budget checks — verify against the provider's current pricing page. */
  "ai.pricing": {
    textInputPer1M: number;
    textOutputPer1M: number;
    imagePerImage: number;
    ttsPer1MChars: number;
    videoPerSecond: number;
  };
  "video.providers": { generativeEnabled: boolean; provider: "openai"; maxClipSeconds: number };
  budget: { dailyUsd: number; monthlyUsd: number; perVideoUsd: number; fxThbPerUsd: number };
  "scoring.weights": ScoringWeights;
  "publishing.disclosureText": { th: string; en: string };
};

export type SettingKey = keyof SettingsMap;

export function settingDefaults(): SettingsMap {
  const e = env();
  return {
    "ai.mode": "demo",
    "ai.models": {
      text: e.OPENAI_TEXT_MODEL,
      image: e.OPENAI_IMAGE_MODEL,
      tts: e.OPENAI_TTS_MODEL,
      video: e.OPENAI_VIDEO_MODEL,
      imageQuality: "medium",
    },
    "ai.pricing": { textInputPer1M: 0.25, textOutputPer1M: 2.0, imagePerImage: 0.04, ttsPer1MChars: 15, videoPerSecond: 0.1 },
    "video.providers": { generativeEnabled: false, provider: "openai", maxClipSeconds: 8 },
    budget: { dailyUsd: 5, monthlyUsd: 100, perVideoUsd: 1, fxThbPerUsd: 36 },
    "scoring.weights": DEFAULT_WEIGHTS,
    "publishing.disclosureText": {
      th: "#โฆษณา ลิงก์ Affiliate — ผู้สร้างอาจได้รับค่าคอมมิชชันเมื่อมีการสั่งซื้อ",
      en: "#ad Affiliate link — the creator may earn a commission from purchases",
    },
  };
}

export async function getSetting<K extends SettingKey>(db: Db, workspaceId: string, key: K): Promise<SettingsMap[K]> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(and(eq(appSettings.workspaceId, workspaceId), eq(appSettings.key, key)))
    .limit(1);
  const def = settingDefaults()[key];
  if (row?.value === undefined || row?.value === null) return def;
  if (typeof def === "object" && def !== null && !Array.isArray(def)) {
    return { ...(def as object), ...(row.value as object) } as SettingsMap[K];
  }
  return row.value as SettingsMap[K];
}

export async function getSettings<K extends SettingKey>(db: Db, workspaceId: string, keys: K[]) {
  const out = {} as Pick<SettingsMap, K>;
  for (const k of keys) out[k] = await getSetting(db, workspaceId, k);
  return out;
}

export async function setSetting<K extends SettingKey>(
  db: Db,
  workspaceId: string,
  key: K,
  value: SettingsMap[K],
  userId?: string,
) {
  await db
    .insert(appSettings)
    .values({ workspaceId, key, value, isSecret: false, updatedBy: userId ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [appSettings.workspaceId, appSettings.key],
      set: { value, updatedBy: userId ?? null, updatedAt: new Date() },
    });
}

// ---------------------------------------------------------------- secrets
export const SECRET_KEYS = ["secret.openaiApiKey"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

const SECRET_ENV_FALLBACK: Record<SecretKey, () => string | undefined> = {
  "secret.openaiApiKey": () => env().OPENAI_API_KEY,
};

export async function setSecret(db: Db, workspaceId: string, key: SecretKey, plain: string | null, userId?: string) {
  if (!plain) {
    await db.delete(appSettings).where(and(eq(appSettings.workspaceId, workspaceId), eq(appSettings.key, key)));
    return;
  }
  const encryptedValue = encryptSecret(plain);
  await db
    .insert(appSettings)
    .values({ workspaceId, key, encryptedValue, isSecret: true, updatedBy: userId ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [appSettings.workspaceId, appSettings.key],
      set: { encryptedValue, isSecret: true, updatedBy: userId ?? null, updatedAt: new Date() },
    });
}

/** Server-only: resolve a secret (workspace setting first, then environment). */
export async function getSecret(db: Db, workspaceId: string, key: SecretKey): Promise<{ value: string | null; source: "workspace" | "env" | null }> {
  const [row] = await db
    .select({ enc: appSettings.encryptedValue })
    .from(appSettings)
    .where(and(eq(appSettings.workspaceId, workspaceId), eq(appSettings.key, key)))
    .limit(1);
  if (row?.enc) return { value: decryptSecret(row.enc), source: "workspace" };
  const fromEnv = SECRET_ENV_FALLBACK[key]();
  return fromEnv ? { value: fromEnv, source: "env" } : { value: null, source: null };
}

/** Safe for clients: whether a secret is configured and its masked tail. */
export async function describeSecret(db: Db, workspaceId: string, key: SecretKey) {
  const s = await getSecret(db, workspaceId, key);
  return { configured: !!s.value, source: s.source, masked: maskSecret(s.value) };
}
