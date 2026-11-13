import os from "node:os";
import { getDb, type Db } from "@/db/client";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { addJobEvent, claimNextJob, completeJob, failJob, isJobCanceled, recoverStaleJobs, updateJobProgress, type JobRow } from "./queue";
import { JOB_HANDLERS } from "./handlers";
import { onLocalWake, BULL_QUEUE_NAME } from "./signal";
import { JobCanceledError, type JobContext } from "./types";

export type WorkerHandle = { stop: () => Promise<void>; id: string };

/** Run a single claimed job through its handler. Exported for tests. */
export async function runJob(db: Db, job: JobRow): Promise<"succeeded" | "retry" | "failed" | "canceled"> {
  const ctx: JobContext = {
    db,
    job,
    progress: (pct, message) => updateJobProgress(db, job.id, pct, message),
    log: (level, message, data) => addJobEvent(db, job.id, level, message, data),
    isCanceled: () => isJobCanceled(db, job.id),
  };
  try {
    const loader = JOB_HANDLERS[job.type as keyof typeof JOB_HANDLERS];
    if (!loader) throw Object.assign(new Error(`No handler for job type ${job.type}`), { permanent: true });
    const handler = await loader();
    const result = await handler(ctx);
    if (await isJobCanceled(db, job.id)) return "canceled";
    await completeJob(db, job.id, result);
    return "succeeded";
  } catch (err) {
    if (err instanceof JobCanceledError || (await isJobCanceled(db, job.id))) return "canceled";
    const message = err instanceof Error ? err.message : String(err);
    const permanent = !!(err as { permanent?: boolean })?.permanent;
    logger.warn("job.failed", { jobId: job.id, type: job.type, error: message, permanent });
    const retry = await failJob(db, job, message, permanent);
    return retry ? "retry" : "failed";
  }
}

/** Process queued jobs until none are runnable (tests / CLI). */
export async function drainQueue(db: Db, workerId = "drain", max = 50) {
  const results: string[] = [];
  for (let i = 0; i < max; i++) {
    const job = await claimNextJob(db, workerId);
    if (!job) break;
    results.push(await runJob(db, job));
  }
  return results;
}

/**
 * Long-running worker loop. Used by `npm run worker` (VPS) and by the inline dev worker.
 */
export function startWorker(opts: { concurrency?: number; pollMs?: number; schedule?: boolean } = {}): WorkerHandle {
  const id = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 7)}`;
  const concurrency = opts.concurrency ?? env().WORKER_CONCURRENCY;
  const pollMs = opts.pollMs ?? 2000;
  let stopped = false;
  let wake: (() => void) | null = null;
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        clearTimeout(t);
        wake = null;
        resolve();
      };
    });
  const unsubscribe = onLocalWake(() => wake?.());

  let bullWorker: { close: () => Promise<void> } | null = null;
  if (env().QUEUE_DRIVER === "bullmq" && env().REDIS_URL) {
    import("bullmq")
      .then(({ Worker }) => {
        bullWorker = new Worker(BULL_QUEUE_NAME, async () => wake?.(), { connection: { url: env().REDIS_URL } });
        logger.info("worker.bullmq_connected", { id });
      })
      .catch((e) => logger.error("worker.bullmq_error", { error: String(e) }));
  }

  const loops: Promise<void>[] = [];
  let lastMaintenance = 0;

  const loop = async (slot: number) => {
    while (!stopped) {
      try {
        const db = await getDb();
        if (slot === 0 && Date.now() - lastMaintenance > 60_000) {
          lastMaintenance = Date.now();
          const n = await recoverStaleJobs(db);
          if (n) logger.warn("worker.recovered_stale", { count: n });
          if (opts.schedule !== false) {
            const { runDueSchedules } = await import("@/lib/automation/engine");
            await runDueSchedules(db).catch((e) => logger.error("worker.schedule_error", { error: String(e) }));
          }
        }
        const job = await claimNextJob(db, `${id}#${slot}`);
        if (!job) {
          await sleep(pollMs);
          continue;
        }
        logger.info("job.start", { jobId: job.id, type: job.type, attempt: job.attempts });
        const outcome = await runJob(db, job);
        logger.info("job.end", { jobId: job.id, type: job.type, outcome });
      } catch (err) {
        logger.error("worker.loop_error", { error: err instanceof Error ? err.message : String(err) });
        await sleep(pollMs * 2);
      }
    }
  };
  for (let i = 0; i < concurrency; i++) loops.push(loop(i));
  logger.info("worker.started", { id, concurrency });

  return {
    id,
    stop: async () => {
      stopped = true;
      wake?.();
      unsubscribe();
      await Promise.allSettled(loops);
      await bullWorker?.close();
    },
  };
}
