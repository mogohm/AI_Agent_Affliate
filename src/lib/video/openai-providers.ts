/**
 * Live OpenAI adapters (only used when the workspace is in Live AI mode with a key).
 * Script → Responses API structured output; Image → Images API (background scenes only);
 * Speech → TTS; Video → Sora (generative B-roll). Costs are estimated from `ai.pricing`.
 */
import type OpenAI from "openai";
import { z } from "zod";
import type { AiContext } from "@/lib/ai/context";
import { TRUTHFULNESS_RULES } from "./templates";
import { allowedSourceFields, allocateDurations, type ScriptDraft, type ScriptRequest } from "./script-types";

const SceneZ = z.object({
  durationSec: z.number().min(1).max(30),
  title: z.string().min(1).max(80),
  voiceover: z.string().max(400),
  caption: z.string().min(1).max(140),
  visualPrompt: z.string().max(600),
  shotType: z.enum(["hook", "problem", "solution", "showcase", "benefit", "cta"]),
});
const OutputZ = z.object({
  hook: z.string(),
  body: z.string(),
  cta: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()).max(10),
  scenes: z.array(SceneZ).min(2).max(8),
  claims: z.array(z.object({ text: z.string(), sourceField: z.string() })),
});

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hook", "body", "cta", "caption", "hashtags", "scenes", "claims"],
  properties: {
    hook: { type: "string" },
    body: { type: "string" },
    cta: { type: "string" },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    scenes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["durationSec", "title", "voiceover", "caption", "visualPrompt", "shotType"],
        properties: {
          durationSec: { type: "number" },
          title: { type: "string" },
          voiceover: { type: "string" },
          caption: { type: "string" },
          visualPrompt: { type: "string", description: "English prompt for a BACKGROUND scene only: no product, no text, no logos" },
          shotType: { type: "string", enum: ["hook", "problem", "solution", "showcase", "benefit", "cta"] },
        },
      },
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "sourceField"],
        properties: { text: { type: "string" }, sourceField: { type: "string" } },
      },
    },
  },
} as const;

export type UsageCost = { units: number; unit: "tokens" | "images" | "seconds" | "chars"; costUsd: number; model: string; operation: string };

export async function generateOpenAIScript(ai: AiContext, req: ScriptRequest): Promise<{ draft: ScriptDraft; usage: UsageCost }> {
  const client = ai.client as OpenAI;
  const allowed = allowedSourceFields(req.facts);
  const durations = allocateDurations(req.structure, req.durationSec);
  const system = [
    "You are a compliant Thai affiliate short-video scriptwriter.",
    `Write in ${req.language === "th" ? "Thai (natural, friendly, concise)" : "English"}.`,
    "Rules:",
    ...TRUTHFULNESS_RULES.map((r) => `- ${r}`),
    `- claims[].sourceField must be one of: ${[...allowed].join(", ")}`,
    `- Produce exactly ${req.structure.length} scenes with shotType in order: ${req.structure.join(", ")}; durations ≈ ${durations.join(", ")} seconds (total ${req.durationSec}s).`,
    "- caption = short on-screen headline (≤ 60 chars); voiceover = spoken line for the scene.",
    "- visualPrompt describes only a background/lifestyle scene in English: no product, no packaging, no logos, no text.",
    `- Template intent: ${req.templatePrompt}`,
  ].join("\n");
  const res = await client.responses.create({
    model: ai.models.text,
    input: [
      { role: "system", content: system },
      { role: "user", content: `PRODUCT_FACTS:\n${JSON.stringify(req.facts, null, 2)}\n\nDISCLOSURE: ${req.disclosureText}` },
    ],
    text: { format: { type: "json_schema", name: "affiliate_video_script", schema: JSON_SCHEMA as unknown as Record<string, unknown>, strict: true } },
  });
  const parsed = OutputZ.parse(JSON.parse(res.output_text));
  const warnings: string[] = [];
  const claims = parsed.claims.filter((c) => {
    const ok = allowed.has(c.sourceField);
    if (!ok) warnings.push(`ตัด claim ที่อ้างอิงฟิลด์ไม่มีอยู่จริง: "${c.text}" (${c.sourceField})`);
    return ok;
  });
  const inTok = res.usage?.input_tokens ?? 0;
  const outTok = res.usage?.output_tokens ?? 0;
  const costUsd = (inTok / 1e6) * ai.pricing.textInputPer1M + (outTok / 1e6) * ai.pricing.textOutputPer1M;
  const draft: ScriptDraft = {
    script: {
      hook: parsed.hook,
      body: parsed.body,
      cta: parsed.cta,
      caption: parsed.caption.includes(req.disclosureText) ? parsed.caption : `${parsed.caption}\n${req.disclosureText}`,
      hashtags: parsed.hashtags,
      disclosure: req.disclosureText,
      claims,
    },
    scenes: parsed.scenes,
    generator: "openai",
    model: ai.models.text,
    warnings,
  };
  return { draft, usage: { units: inTok + outTok, unit: "tokens", costUsd, model: ai.models.text, operation: "script.generate" } };
}

export async function generateOpenAIBackground(ai: AiContext, prompt: string): Promise<{ png: Buffer; usage: UsageCost }> {
  const client = ai.client as OpenAI;
  const res = await client.images.generate({
    model: ai.models.image,
    prompt: `${prompt}. Background plate only. Absolutely no text, letters, logos, packaging or products.`,
    size: "1024x1536",
    quality: ai.models.imageQuality,
    n: 1,
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI Images ไม่ส่งข้อมูลภาพกลับมา");
  return { png: Buffer.from(b64, "base64"), usage: { units: 1, unit: "images", costUsd: ai.pricing.imagePerImage, model: ai.models.image, operation: "image.background" } };
}

export async function generateOpenAISpeech(ai: AiContext, text: string, voice: "female" | "male", language: "th" | "en"): Promise<{ mp3: Buffer; usage: UsageCost }> {
  const client = ai.client as OpenAI;
  const res = await client.audio.speech.create({
    model: ai.models.tts,
    voice: voice === "female" ? "nova" : "onyx",
    input: text,
    response_format: "mp3",
    instructions: language === "th" ? "Speak natural Thai, friendly and clear, short-video pacing." : "Friendly, clear, short-video pacing.",
  } as Parameters<OpenAI["audio"]["speech"]["create"]>[0]);
  const mp3 = Buffer.from(await res.arrayBuffer());
  return { mp3, usage: { units: text.length, unit: "chars", costUsd: (text.length / 1e6) * ai.pricing.ttsPer1MChars, model: ai.models.tts, operation: "speech.voiceover" } };
}

/** Sora clip length must be one of the API's allowed values. */
export function soraSeconds(sceneSec: number, maxClip: number): "4" | "8" | "12" {
  const want = Math.min(Math.ceil(sceneSec), maxClip);
  return want <= 4 ? "4" : want <= 8 ? "8" : "12";
}

export async function generateSoraClip(
  ai: AiContext,
  prompt: string,
  seconds: "4" | "8" | "12",
  opts: { pollMs?: number; timeoutMs?: number; isCanceled?: () => Promise<boolean> } = {},
): Promise<{ mp4: Buffer; usage: UsageCost }> {
  const client = ai.client as OpenAI;
  let video = await client.videos.create({
    model: ai.models.video as never,
    prompt: `${prompt}. B-roll background footage only; no product close-ups, no text, no logos.`,
    seconds,
    size: "720x1280",
  });
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  while (video.status === "queued" || video.status === "in_progress") {
    if (Date.now() > deadline) throw new Error("Sora ใช้เวลานานเกินกำหนด");
    if (opts.isCanceled && (await opts.isCanceled())) throw new Error("ยกเลิกงานแล้ว");
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 5000));
    video = await client.videos.retrieve(video.id);
  }
  if (video.status !== "completed") throw new Error(`Sora สร้างวิดีโอไม่สำเร็จ (${video.status})`);
  const content = await client.videos.downloadContent(video.id);
  const mp4 = Buffer.from(await content.arrayBuffer());
  const secs = Number(seconds);
  return { mp4, usage: { units: secs, unit: "seconds", costUsd: secs * ai.pricing.videoPerSecond, model: ai.models.video, operation: "video.broll" } };
}
