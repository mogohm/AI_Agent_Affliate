import type { Db } from "@/db/client";
import type { JobRow } from "./queue";

export type JobContext = {
  db: Db;
  job: JobRow;
  progress: (pct: number, message?: string) => Promise<void>;
  log: (level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>) => Promise<void>;
  /** Handlers should check this between expensive steps and stop early. */
  isCanceled: () => Promise<boolean>;
};

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

/** Throw to fail a job without retrying (bad input, budget exceeded, missing permission...). */
export class PermanentJobError extends Error {
  readonly permanent = true;
}

export class JobCanceledError extends Error {
  readonly canceled = true;
}
