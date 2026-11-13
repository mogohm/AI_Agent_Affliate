import { and, count, desc, eq, inArray, max, min, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobEvents, jobs, videoProjects } from "@/db/schema";
import { cancelJob, retryJob, type JobRow } from "@/lib/jobs/queue";
import { env, isTrue } from "@/lib/env";

export type JobListFilters = { status?: string[]; type?: string; page?: number; pageSize?: number; projectId?: string };

export async function listJobs(db: Db, workspaceId: string, f: JobListFilters) {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 25));
  const where: SQL[] = [eq(jobs.workspaceId, workspaceId)];
  if (f.status?.length) where.push(inArray(jobs.status, f.status as JobRow["status"][]));
  if (f.type) where.push(eq(jobs.type, f.type));
  if (f.projectId) where.push(eq(jobs.projectId, f.projectId));
  const rows = await db
    .select({ job: jobs, projectTitle: videoProjects.title, projectStatus: videoProjects.status })
    .from(jobs)
    .leftJoin(videoProjects, eq(videoProjects.id, jobs.projectId))
    .where(and(...where))
    .orderBy(desc(jobs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ n }] = await db.select({ n: count() }).from(jobs).where(and(...where));
  return {
    items: rows.map((r) => ({ ...r.job, projectTitle: r.projectTitle, projectStatus: r.projectStatus })),
    total: n,
    page,
    pageSize,
  };
}

export async function jobSummary(db: Db, workspaceId: string) {
  const byStatus = await db
    .select({ status: jobs.status, n: count() })
    .from(jobs)
    .where(eq(jobs.workspaceId, workspaceId))
    .groupBy(jobs.status);
  const byType = await db
    .select({ type: jobs.type, status: jobs.status, n: count() })
    .from(jobs)
    .where(eq(jobs.workspaceId, workspaceId))
    .groupBy(jobs.type, jobs.status);
  const [act] = await db
    .select({ lastActivity: max(jobs.updatedAt), lastFinished: max(jobs.finishedAt) })
    .from(jobs)
    .where(and(eq(jobs.workspaceId, workspaceId), inArray(jobs.status, ["running", "succeeded", "failed"])));
  const [oldest] = await db
    .select({ oldest: min(jobs.createdAt) })
    .from(jobs)
    .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.status, "queued")));
  const counts: Record<string, number> = { queued: 0, running: 0, succeeded: 0, failed: 0, canceled: 0 };
  for (const r of byStatus) counts[r.status] = r.n;
  const e = env();
  const inlineFlag = e.WORKER_INLINE;
  return {
    counts,
    byType,
    lastActivity: act?.lastActivity ?? null,
    lastFinished: act?.lastFinished ?? null,
    oldestQueuedAt: oldest?.oldest ?? null,
    worker: {
      queueDriver: e.QUEUE_DRIVER,
      redisConfigured: !!e.REDIS_URL,
      inline: inlineFlag ? isTrue(inlineFlag) : e.DATABASE_URL.startsWith("pglite://"),
      concurrency: e.WORKER_CONCURRENCY,
    },
  };
}

export async function getJobWithEvents(db: Db, workspaceId: string, jobId: string) {
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.workspaceId, workspaceId)));
  if (!job) return null;
  const events = await db.select().from(jobEvents).where(eq(jobEvents.jobId, jobId)).orderBy(desc(jobEvents.createdAt)).limit(200);
  return { job, events };
}

/** Operator retry; keeps the linked video project's status consistent. */
export async function operatorRetry(db: Db, job: JobRow) {
  const updated = await retryJob(db, job.id);
  if (updated && job.projectId) {
    const status = job.type === "video.render" ? "queued_render" : job.type === "video.generate_script" ? "script_generating" : null;
    if (status) await db.update(videoProjects).set({ status, error: null, updatedAt: new Date() }).where(eq(videoProjects.id, job.projectId));
  }
  return updated;
}

/** Operator cancel; returns the linked video project to a resumable state. */
export async function operatorCancel(db: Db, job: JobRow) {
  const updated = await cancelJob(db, job.id);
  if (updated && job.projectId) {
    if (job.type === "video.render") {
      await db
        .update(videoProjects)
        .set({ status: "awaiting_approval", error: "ยกเลิกการเรนเดอร์โดยผู้ดูแล", updatedAt: new Date() })
        .where(eq(videoProjects.id, job.projectId));
    } else if (job.type === "video.generate_script") {
      await db
        .update(videoProjects)
        .set({ status: "created", error: "ยกเลิกการสร้างสคริปต์โดยผู้ดูแล", updatedAt: new Date() })
        .where(eq(videoProjects.id, job.projectId));
    }
  }
  return updated;
}
