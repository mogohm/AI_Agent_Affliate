/**
 * Queue wake-up signalling. With QUEUE_DRIVER=db the worker simply polls Postgres.
 * With QUEUE_DRIVER=bullmq a BullMQ job (id only) is pushed so workers wake immediately;
 * the authoritative state still lives in the `jobs` table.
 */
import { env } from "@/lib/env";

export const BULL_QUEUE_NAME = "affiliate-jobs";

type BullQueue = { add: (name: string, data: unknown, opts?: unknown) => Promise<unknown>; close: () => Promise<void> };
const g = globalThis as unknown as { __bullQueue?: Promise<BullQueue | null>; __localWake?: Set<() => void> };

async function getBullQueue(): Promise<BullQueue | null> {
  const e = env();
  if (e.QUEUE_DRIVER !== "bullmq" || !e.REDIS_URL) return null;
  if (!g.__bullQueue) {
    g.__bullQueue = (async () => {
      const { Queue } = await import("bullmq");
      return new Queue(BULL_QUEUE_NAME, { connection: { url: e.REDIS_URL } }) as unknown as BullQueue;
    })();
  }
  return g.__bullQueue;
}

/** In-process wake-ups (inline worker). */
export function onLocalWake(fn: () => void) {
  g.__localWake ??= new Set();
  g.__localWake.add(fn);
  return () => g.__localWake?.delete(fn);
}

export async function notifyQueue(jobId: string) {
  g.__localWake?.forEach((fn) => fn());
  const q = await getBullQueue();
  if (q) await q.add("wake", { jobId }, { removeOnComplete: true, removeOnFail: 1000, jobId: `wake-${jobId}-${Date.now()}` });
}
