"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Shot } from "../../../lib/storyboard";
import type { GenerateRequest, Job, JobResponse, Mode } from "../../../lib/types";

/** The storyboard is a shot list, so every queued request is a cinematic run. */
const STORYBOARD_MODE: Mode = "cinematic";

const POLL_MS = 600;

/** Network blips and 5xx answers are retried; only a 404 or this many in a row stops the shot. */
const MAX_FAILURES = 5;

/** A shot that has not finished in this long is failed rather than polled forever. */
const JOB_TIMEOUT_MS = 15 * 60_000;

/** A board shot with the seed it carries into its own submit. */
export type QueuedShot = Shot & { seed: number };

export type ShotPatch = Partial<QueuedShot>;

export type ShotQueue = {
  run(shots: QueuedShot[]): void;
  cancel(): void;
  running: boolean;
};

type UpdateShot = (id: string, patch: ShotPatch) => void;

/** A job the server no longer knows: retrying cannot help. */
class JobGoneError extends Error {}

async function errorText(response: Response): Promise<string> {
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

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "the request failed";
}

/** Wait between two polls; an abort cuts the wait short so a cancel does not hold for a full poll. */
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

async function submitShot(shot: QueuedShot, signal: AbortSignal): Promise<string> {
  const request: GenerateRequest = {
    mode: STORYBOARD_MODE,
    modelId: shot.modelId,
    prompt: shot.prompt,
    durationS: shot.durationS,
    seed: shot.seed,
  };
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (response.status !== 202) {
    throw new Error(await errorText(response));
  }
  const body = (await response.json()) as JobResponse;
  return body.jobId;
}

/**
 * Poll one job until it finishes. Stops quietly when the hook went away or the shot was cancelled,
 * gives up after `MAX_FAILURES` failed poll in a row, and fails a job that outlives its deadline.
 */
async function pollJob(
  jobId: string,
  onJob: (job: Job) => void,
  isLive: () => boolean,
  signal: AbortSignal,
): Promise<Job | undefined> {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let failures = 0;

  while (isLive()) {
    if (Date.now() > deadline) {
      throw new Error("the shot did not finish within 15 minutes");
    }

    try {
      const response = await fetch(`/api/jobs/${jobId}`, { signal });
      if (!isLive()) {
        return undefined;
      }
      if (response.status === 404) {
        throw new JobGoneError("this job is no longer on the server");
      }
      if (!response.ok) {
        throw new Error(await errorText(response));
      }
      const job = (await response.json()) as Job;
      if (!isLive()) {
        return undefined;
      }
      failures = 0;
      onJob(job);
      if (job.status === "succeeded" || job.status === "failed") {
        return job;
      }
    } catch (cause) {
      if (!isLive()) {
        return undefined;
      }
      failures += 1;
      if (cause instanceof JobGoneError || failures >= MAX_FAILURES) {
        throw cause;
      }
    }

    await wait(POLL_MS, signal);
  }
  return undefined;
}

/** Submit and poll one shot, guiding it through running, progress and its terminal state. */
async function runShot(
  shot: QueuedShot,
  update: UpdateShot,
  isLive: () => boolean,
  signal: AbortSignal,
): Promise<void> {
  update(shot.id, { status: "running", progress: 0, resultUrl: undefined, error: undefined });

  // A cancelled shot must not keep its "Rendering" card: put it back to idle, ready to run again.
  const stopQuietly = () => update(shot.id, { status: "idle", progress: 0 });

  try {
    const jobId = await submitShot(shot, signal);
    if (!isLive()) {
      stopQuietly();
      return;
    }

    const job = await pollJob(
      jobId,
      (next) => update(shot.id, { progress: next.progress }),
      isLive,
      signal,
    );
    if (job === undefined) {
      stopQuietly();
      return;
    }

    if (job.status === "succeeded") {
      update(shot.id, { status: "succeeded", progress: 100, resultUrl: job.result?.url });
      return;
    }
    update(shot.id, { status: "failed", error: job.error ?? "the run failed" });
  } catch (cause) {
    if (!isLive()) {
      stopQuietly();
      return;
    }
    update(shot.id, { status: "failed", error: messageOf(cause) });
  }
}

/** Run the queue in order; a failed shot does not stop the list, and `release` always runs. */
async function runQueue(
  queue: QueuedShot[],
  update: UpdateShot,
  isLive: () => boolean,
  signal: AbortSignal,
  release: () => void,
): Promise<void> {
  try {
    for (const shot of queue) {
      if (!isLive()) {
        return;
      }
      await runShot(shot, update, isLive, signal);
    }
  } finally {
    release();
  }
}

/**
 * Runs a storyboard one shot at a time: submit, poll, patch the shot, then move to the next.
 * A failed shot does not stop the list; only `cancel` does, and it aborts the shot in flight.
 */
export function useShotQueue(onUpdate: (id: string, patch: ShotPatch) => void): ShotQueue {
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const runIdRef = useRef(0);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const update = useCallback((id: string, patch: ShotPatch) => {
    if (mountedRef.current) {
      onUpdateRef.current(id, patch);
    }
  }, []);

  const run = useCallback(
    (shots: QueuedShot[]) => {
      if (runningRef.current || !mountedRef.current) {
        return;
      }
      const queue = shots.filter((shot) => shot.prompt.trim() !== "");
      if (queue.length === 0) {
        return;
      }

      const controller = new AbortController();
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      abortRef.current = controller;
      runningRef.current = true;
      cancelledRef.current = false;
      setRunning(true);

      const isLive = () =>
        mountedRef.current && !cancelledRef.current && !controller.signal.aborted;

      void runQueue(queue, update, isLive, controller.signal, () => {
        // A cancelled run must not clear the flags of a newer one that already started.
        if (runIdRef.current === runId) {
          runningRef.current = false;
          if (mountedRef.current) {
            setRunning(false);
          }
        }
        if (abortRef.current === controller) {
          abortRef.current = undefined;
        }
      });
    },
    [update],
  );

  const cancel = useCallback(() => {
    // Bumping the id makes the run in flight stale, so its exit cannot block a new Run all.
    runIdRef.current += 1;
    cancelledRef.current = true;
    runningRef.current = false;
    abortRef.current?.abort();
    if (mountedRef.current) {
      setRunning(false);
    }
  }, []);

  return { run, cancel, running };
}
