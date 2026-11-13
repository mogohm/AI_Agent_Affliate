import { route, ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { getSecret } from "@/lib/settings";

/**
 * Validates the configured OpenAI key with GET /v1/models — a free, non-generative endpoint.
 * Never sends prompts and never incurs usage charges.
 */
export const POST = route({ permission: "credentials:manage" }, async ({ db, session, ip }) => {
  const key = await getSecret(db, session.workspaceId, "secret.openaiApiKey");
  if (!key.value) throw new ApiError(400, "ยังไม่ได้กำหนด OpenAI API Key", "no_key");
  const base = (env().OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  let ok = false;
  let status = 0;
  let message = "";
  let modelCount: number | null = null;
  try {
    const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key.value}` }, signal: AbortSignal.timeout(15_000) });
    status = res.status;
    ok = res.ok;
    if (ok) {
      const data = (await res.json()) as { data?: unknown[] };
      modelCount = Array.isArray(data.data) ? data.data.length : null;
      message = "API Key ใช้งานได้";
    } else {
      message = status === 401 ? "API Key ไม่ถูกต้องหรือถูกเพิกถอน" : status === 429 ? "ติด Rate limit / โควตา" : `OpenAI ตอบกลับ HTTP ${status}`;
    }
  } catch (e) {
    message = `เชื่อมต่อ OpenAI ไม่ได้: ${e instanceof Error ? e.message : String(e)}`;
  }
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "credentials.openai_test", metadata: { ok, status }, ip });
  return { ok, status, message, modelCount, source: key.source };
});
