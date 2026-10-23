import type { GenerateRequest, Job, JobResult } from "../types";

/** A render "takes" this long in demo mode, so the progress bar has something to show. */
export const RENDER_MS = 4200;

/** Enough history for a session; oldest jobs are dropped first. */
const MAX_JOBS = 50;

const jobs = new Map<string, Job>();

/**
 * The one interface both back ends implement. The API route never knows which one it holds.
 */
export type Generator = {
  submit(request: GenerateRequest): Promise<Job>;
  poll(job: Job): Promise<Job>;
};

export function createJob(request: GenerateRequest, demo: boolean): Job {
  const job: Job = {
    id: crypto.randomUUID(),
    status: "queued",
    progress: 0,
    createdAt: Date.now(),
    request,
    demo,
  };

  jobs.set(job.id, job);
  if (jobs.size > MAX_JOBS) {
    evictOne();
  }

  return job;
}

/** Drop one job: the oldest finished one first, so a render that is still being polled survives. */
function evictOne(): void {
  let fallback: string | undefined;

  for (const [id, job] of jobs) {
    if (job.status === "succeeded" || job.status === "failed") {
      jobs.delete(id);
      return;
    }
    fallback ??= id;
  }

  if (fallback !== undefined) {
    jobs.delete(fallback);
  }
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/**
 * Recompute status and progress from elapsed time on every read. There are no timers, so
 * nothing keeps running and nothing leaks.
 */
export function refresh(job: Job): Job {
  if (!job.demo || job.status === "succeeded" || job.status === "failed") {
    return job;
  }

  const ratio = Math.min(1, (Date.now() - job.createdAt) / RENDER_MS);
  job.progress = Math.round(ratio * 100);

  if (ratio < 0.12) {
    job.status = "queued";
  } else if (ratio < 1) {
    job.status = "running";
  } else if (job.result) {
    job.status = "succeeded";
  } else {
    job.status = "failed";
    job.error = "demo render produced no result";
  }

  return job;
}

export function finish(job: Job, result: JobResult): Job {
  job.result = result;
  job.progress = 100;
  job.status = "succeeded";
  return job;
}

export function fail(job: Job, error: string): Job {
  job.error = error;
  job.status = "failed";
  return job;
}
