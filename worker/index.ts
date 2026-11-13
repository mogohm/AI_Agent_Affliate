/**
 * Standalone job worker for VPS/containers:  npm run worker
 * Requires DATABASE_URL (Neon/Postgres) shared with the web app and STORAGE_DRIVER=s3 when the
 * web app runs elsewhere (e.g. Vercel). Handles SIGINT/SIGTERM gracefully; unfinished jobs are
 * recovered by the stale-lock sweep, so restarts never lose queued or completed work.
 */
import { startWorker } from "../src/lib/jobs/worker";
import { getDb, closeDb } from "../src/db/client";
import { env } from "../src/lib/env";

async function main() {
  if (env().DATABASE_URL.startsWith("pglite://")) {
    console.warn("[worker] DATABASE_URL is PGlite — a standalone worker cannot share it with `next dev`. Use WORKER_INLINE (default in dev) or point both at Postgres.");
  }
  await getDb();
  const w = startWorker({});
  const shutdown = async (sig: string) => {
    console.log(`[worker] ${sig} received, finishing current jobs...`);
    await w.stop();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
