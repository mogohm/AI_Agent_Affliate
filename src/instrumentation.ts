/**
 * Next.js instrumentation hook. In local development (PGlite, single process) the job worker
 * runs inline inside the Next.js server. In production set WORKER_INLINE=false and run
 * `npm run worker` on a VPS/container — long renders must not run in serverless functions.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const url = process.env.DATABASE_URL ?? "pglite://./.data/pglite";
  const flag = process.env.WORKER_INLINE;
  const inline = flag ? flag === "true" || flag === "1" : url.startsWith("pglite://");
  if (!inline || process.env.NEXT_PHASE === "phase-production-build") return;
  const g = globalThis as unknown as { __inlineWorker?: boolean };
  if (g.__inlineWorker) return;
  g.__inlineWorker = true;
  const { startWorker } = await import("@/lib/jobs/worker");
  startWorker({ pollMs: 1500 });
}
