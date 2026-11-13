import { z } from "zod";

/**
 * Server-side environment. Never import this module from client components.
 * Values are parsed lazily so `next build` does not require production secrets.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("pglite://./.data/pglite"),
  DB_AUTO_MIGRATE: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
  APP_ENCRYPTION_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_TEXT_MODEL: z.string().default("gpt-5-mini"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  OPENAI_VIDEO_MODEL: z.string().default("sora-2"),
  QUEUE_DRIVER: z.enum(["db", "bullmq"]).default("db"),
  REDIS_URL: z.string().optional(),
  WORKER_INLINE: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./.data/storage"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().optional(),
  FFMPEG_PATH: z.string().optional(),
  RENDER_WIDTH: z.coerce.number().int().default(720),
  RENDER_HEIGHT: z.coerce.number().int().default(1280),
  RENDER_FPS: z.coerce.number().int().default(30),
  SEED_ADMIN_EMAIL: z.string().default("admin@example.com"),
  SEED_ADMIN_PASSWORD: z.string().default("ChangeMe!2026"),
  SEED_DEMO_DATA: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** Reset cached env (tests only). */
export function resetEnvCache() {
  cached = null;
}

const DEV_AUTH_SECRET = "dev-only-insecure-auth-secret-change-me-0123456789";

export function authSecret(): string {
  const e = env();
  if (e.AUTH_SECRET && e.AUTH_SECRET.length >= 32) return e.AUTH_SECRET;
  if (e.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("AUTH_SECRET (>= 32 chars) must be set in production");
  }
  return DEV_AUTH_SECRET;
}

export const isTrue = (v: string | undefined) => v === "1" || v?.toLowerCase() === "true";
