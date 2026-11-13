/**
 * Durable job queue. PostgreSQL is the source of truth (jobs survive worker/web restarts);
 * claiming uses `FOR UPDATE SKIP LOCKED` so multiple workers can run safely.
 * When QUEUE_DRIVER=bullmq, BullMQ/Redis is used only as a low-latency wake-up signal.
 */
import { and, eq, sql, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobs, jobEvents } from "@/db/schema";
import { notifyQueue } from "./signal";

export type JobType =
  | "video.generate_script"
  | "video.render"
  | "product.analyze"
  | "automation.run"
  | "marketplace.sync";

export type JobRow = typeof jobs.$inferSelect;

export type EnqueueInput = {
  workspaceId: string;
  type: JobType;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  priority?: number;
  maxAttempts?: number;
  runAt?: Date;
  projectId?: string | null;
  createdBy?: string | null;
};

/** Enqueue a job. With an idempotency key, an existing non-failed job with the same key is returned instead. */
export async function enqueueJob(db: Db, input: EnqueueInput): Promise<{ job: JobRow; created: boolean }> {
  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.workspaceId, input.workspaceId), eq(jobs.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (existing) {
      if (existing.status === "failed" || existing.status === "canceled") {
        // allow a fresh attempt under the same key: release the key on the old row
        await db.update(jobs).set({ idempotencyKey: `${existing.idempotencyKey}#${existing.id.slice(0, 8)}` }).where(eq(jobs.id, existing.id));
      } else {
        return { job: existing, created: false };
      }
    }
  }
  const [job] = await db
    .insert(jobs)
    .values({
      workspaceId: input.workspaceId,
      type: input.type,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey ?? null,
      priority: input.priority ?? 0,
      maxAttempts: input.maxAttempts ?? 3,
      runAt: input.runAt ?? new Date(),
      projectId: input.projectId ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  await addJobEvent(db, job.id, "info", "Job queued", { type: job.type });
  await notifyQueue(job.id).catch(() => undefined);
  return { job, created: true };
}

/** Atomically claim the next runnable job. */
export async function claimNextJob(db: Db, workerId: string, types?: JobType[]): Promise<JobRow | null> {
  const typeFilter = types?.length ? sql`and type in (${sql.join(types.map((t) => sql`${t}`), sql`, `)})` : sql``;
  const res = await db.execute(sql`
    update jobs set status = 'running', locked_at = now(), locked_by = ${workerId},
      attempts = attempts + 1, updated_at = now(), progress = 0, progress_message = 'เริ่มทำงาน'
    where id = (
      select id from jobs
      where status = 'queued' and run_at <= now() ${typeFilter}
      order by priority desc, run_at asc, created_at asc
      for update skip locked
      limit 1
    )
    returning id`);
  const rows = (res as unknown as { rows: { id: string }[] }).rows;
  if (!rows?.length) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, rows[0].id));
  return job ?? null;
}

export async function updateJobProgress(db: Db, jobId: string, progress: number, message?: string) {
  await db
    .update(jobs)
    .set({ progress: Math.max(0, Math.min(100, Math.round(progress))), progressMessage: message ?? null, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

export async function completeJob(db: Db, jobId: string, result: Record<string, unknown> = {}) {
  await db
    .update(jobs)
    .set({ status: "succeeded", result, progress: 100, progressMessage: "เสร็จสิ้น", lockedAt: null, lockedBy: null, finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
  await addJobEvent(db, jobId, "info", "Job succeeded");
}

/** Exponential backoff: 15s, 60s, 240s ... */
export function backoffMs(attempt: number) {
  return Math.min(15_000 * 4 ** Math.max(0, attempt - 1), 30 * 60_000);
}

/** Mark failure; re-queue with backoff while attempts remain (unless `permanent`). Returns true if it will retry. */
export async function failJob(db: Db, job: Pick<JobRow, "id" | "attempts" | "maxAttempts">, error: string, permanent = false): Promise<boolean> {
  const retry = !permanent && job.attempts < job.maxAttempts;
  await db
    .update(jobs)
    .set(
      retry
        ? { status: "queued", lastError: error, lockedAt: null, lockedBy: null, runAt: new Date(Date.now() + backoffMs(job.attempts)), updatedAt: new Date(), progressMessage: "รอลองใหม่อัตโนมัติ" }
        : { status: "failed", lastError: error, lockedAt: null, lockedBy: null, finishedAt: new Date(), updatedAt: new Date(), progressMessage: "ล้มเหลว" },
    )
    .where(eq(jobs.id, job.id));
  await addJobEvent(db, job.id, retry ? "warn" : "error", retry ? `Attempt ${job.attempts} failed — retry scheduled` : "Job failed (dead letter)", { error });
  return retry;
}

/** Manual retry of a failed/canceled job (operator action). */
export async function retryJob(db: Db, jobId: string): Promise<JobRow | null> {
  const [job] = await db
    .update(jobs)
    .set({ status: "queued", attempts: 0, lastError: null, runAt: new Date(), finishedAt: null, progress: 0, progressMessage: "รอคิว (ลองใหม่)", updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["failed", "canceled"])))
    .returning();
  if (job) {
    await addJobEvent(db, jobId, "info", "Manually re-queued");
    await notifyQueue(job.id).catch(() => undefined);
  }
  return job ?? null;
}

export async function cancelJob(db: Db, jobId: string): Promise<JobRow | null> {
  const [job] = await db
    .update(jobs)
    .set({ status: "canceled", finishedAt: new Date(), lockedAt: null, lockedBy: null, progressMessage: "ยกเลิกแล้ว", updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["queued", "running"])))
    .returning();
  if (job) await addJobEvent(db, jobId, "warn", "Canceled by operator");
  return job ?? null;
}

export async function isJobCanceled(db: Db, jobId: string): Promise<boolean> {
  const [j] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId));
  return j?.status === "canceled";
}

/** Re-queue jobs whose worker died mid-run (lock older than `staleMs`). */
export async function recoverStaleJobs(db: Db, staleMs = 15 * 60_000): Promise<number> {
  const res = await db.execute(sql`
    update jobs set status = 'queued', locked_at = null, locked_by = null, updated_at = now(),
      progress_message = 'กู้คืนหลัง worker หยุดทำงาน'
    where status = 'running' and locked_at < now() - (${Math.round(staleMs / 1000)} * interval '1 second')
    returning id`);
  const rows = (res as unknown as { rows: { id: string }[] }).rows ?? [];
  for (const r of rows) await addJobEvent(db, r.id, "warn", "Recovered stale lock; re-queued");
  return rows.length;
}

export async function addJobEvent(db: Db, jobId: string, level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>) {
  await db.insert(jobEvents).values({ jobId, level, message, data });
}
