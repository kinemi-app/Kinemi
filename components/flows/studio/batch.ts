import { defaultModelForMode, models } from "../../../lib/models";
import type { GenerateRequest, Job, Mode } from "../../../lib/types";

export type PlannedShot = {
  index: number;
  title: string;
  prompt: string;
  mode: Mode;
  durationS: number;
};

export type BatchStatus = "idle" | "running" | "succeeded" | "failed";

export type BatchShot = PlannedShot & {
  status: BatchStatus;
  error?: string;
  resultUrl?: string;
};

export type UpdateShot = (index: number, patch: Partial<BatchShot>) => void;

const POLL_MS = 700;
const MAX_POLL_FAILURES = 5;
const JOB_TIMEOUT_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** The planner may only return a mode some model can serve. */
const KNOWN_MODES = new Set<Mode>(models.flatMap((model) => model.modes));

function isMode(value: unknown): value is Mode {
  return typeof value === "string" && KNOWN_MODES.has(value as Mode);
}

export function isPlannedShot(value: unknown): value is PlannedShot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const shot = value as Record<string, unknown>;
  return (
    typeof shot.index === "number" &&
    Number.isFinite(shot.index) &&
    typeof shot.title === "string" &&
    typeof shot.prompt === "string" &&
    shot.prompt.trim() !== "" &&
    isMode(shot.mode) &&
    typeof shot.durationS === "number" &&
    Number.isFinite(shot.durationS) &&
    shot.durationS > 0
  );
}

export async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Not JSON; fall through to the status line.
  }
  return `HTTP ${response.status}`;
}

export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "the request failed";
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

/** A deadline on one HTTP call, so a silent server cannot hold a batch worker forever. */
function withDeadline(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

async function submitShot(shot: PlannedShot, signal: AbortSignal): Promise<string> {
  const request: GenerateRequest = {
    mode: shot.mode,
    modelId: defaultModelForMode(shot.mode).id,
    prompt: shot.prompt,
    durationS: shot.durationS,
    params: { source: "studio" },
  };
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: withDeadline(signal),
  });
  if (response.status !== 202) {
    throw new Error(await readError(response));
  }
  const body = (await response.json()) as { jobId?: unknown };
  if (typeof body.jobId !== "string") {
    throw new Error("The server did not return a job id.");
  }
  return body.jobId;
}

/** Poll one job at the batch's pace. Network blips are retried; a 404 or too many failures stop it. */
async function pollJob(jobId: string, signal: AbortSignal): Promise<Job> {
  const startedAt = Date.now();
  let failures = 0;

  for (;;) {
    if (signal.aborted) {
      throw new DOMException("The batch was stopped.", "AbortError");
    }
    if (Date.now() - startedAt > JOB_TIMEOUT_MS) {
      throw new Error("The job did not finish in 15 minutes.");
    }

    const response = await fetch(`/api/jobs/${jobId}`, { signal: withDeadline(signal) });
    if (response.status === 404) {
      throw new Error("The server no longer knows this job.");
    }
    if (response.ok) {
      failures = 0;
      const job = (await response.json()) as Job;
      if (job.status === "succeeded" || job.status === "failed") {
        return job;
      }
    } else {
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) {
        throw new Error(await readError(response));
      }
    }

    await wait(POLL_MS, signal);
  }
}

/** Run the shots with at most `concurrency` in flight; each worker takes the next free index. */
export async function executeBatch(
  shots: readonly BatchShot[],
  concurrency: number,
  update: UpdateShot,
  signal: AbortSignal,
): Promise<void> {
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      if (signal.aborted) {
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      const shot = shots[index];
      if (!shot) {
        return;
      }

      update(index, { status: "running", error: undefined, resultUrl: undefined });
      try {
        const jobId = await submitShot(shot, signal);
        const job = await pollJob(jobId, signal);
        if (job.status === "failed") {
          update(index, { status: "failed", error: job.error ?? "The run failed." });
        } else {
          update(index, { status: "succeeded", resultUrl: job.result?.url });
        }
      } catch (cause) {
        if (signal.aborted || isAbort(cause)) {
          update(index, { status: "idle" });
          return;
        }
        update(index, { status: "failed", error: messageOf(cause) });
      }
    }
  }

  const workerCount = Math.min(concurrency, shots.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
