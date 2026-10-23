"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerateRequest, Job, JobResponse } from "../../lib/types";

/**
 * The one polling hook every flow calls: submit a request, then watch the job until it is done.
 * One submit at a time: a newer submit or a reset retires whatever the older one was doing.
 *
 * The flow's last job id lives in localStorage, so a reload or a second tab reattaches to the run
 * instead of losing it. Storage is optional: a browser that blocks it simply does not reattach.
 */

const POLL_MS = 600;

/** Network blips and 5xx answers are retried; only a 404 or this many in a row stops the polling. */
const MAX_FAILURES = 5;

/** One key per flow, so Re-shoot never picks up a Cinematic run. */
const STORAGE_PREFIX = "kinemi.job.";

export type UseJob = {
  job: Job | undefined;
  error: string | undefined;
  running: boolean;
  submit(request: GenerateRequest): void;
  reset(): void;
};

/** Access throws when a browser blocks storage, not only when the key is missing. */
function getStorage(): Storage | undefined {
  try {
    if (typeof window === "undefined") {
      return undefined;
    }
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readJobId(key: string): string | undefined {
  try {
    const id = getStorage()?.getItem(STORAGE_PREFIX + key) ?? undefined;
    // An empty value is not a job id: it would wedge the stage on "Submitting" with no poll.
    return id !== undefined && id.trim() !== "" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** A failed write costs the reattach, never the run, so it is not worth surfacing. */
function writeJobId(key: string, id: string | undefined): void {
  try {
    const storage = getStorage();
    if (!storage) {
      return;
    }
    if (id === undefined) {
      storage.removeItem(STORAGE_PREFIX + key);
    } else {
      storage.setItem(STORAGE_PREFIX + key, id);
    }
  } catch {
    // Private mode or a full quota: the run itself is unaffected.
  }
}

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

type PollOptions = {
  id: string | undefined;
  onJob: (job: Job) => void;
  onError: (message: string) => void;
  onMissing: (id: string) => void;
  onFinish: () => void;
};

/** One poll at a time: the next request is scheduled when the previous answer is in. */
function usePolling({ id, onJob, onError, onMissing, onFinish }: PollOptions): void {
  useEffect(() => {
    if (!id) {
      return;
    }

    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${id}`);
        if (cancelled) {
          return;
        }
        if (response.status === 404) {
          onMissing(id);
          onFinish();
          return;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const next = (await response.json()) as Job;
        if (cancelled) {
          return;
        }
        failures = 0;
        onJob(next);
        if (next.status === "succeeded" || next.status === "failed") {
          onFinish();
          return;
        }
      } catch (cause) {
        if (cancelled) {
          return;
        }
        failures += 1;
        if (failures >= MAX_FAILURES) {
          onError(messageOf(cause));
          onFinish();
          return;
        }
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [id, onJob, onError, onMissing, onFinish]);
}

export function useJob(key: string): UseJob {
  const [job, setJob] = useState<Job | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pendingId, setPendingId] = useState<string | undefined>(undefined);
  const token = useRef(0);
  /** The id this mount restored, so its 404 stays silent and a newer job's 404 does not. */
  const restoredId = useRef<string | undefined>(undefined);
  /** The restore runs once per mount, in an effect, so server and client markup agree. */
  const restoreOnce = useRef(false);

  useEffect(() => {
    if (restoreOnce.current) {
      return;
    }
    restoreOnce.current = true;
    const stored = readJobId(key);
    if (stored !== undefined) {
      restoredId.current = stored;
      setPendingId(stored);
    }
  }, [key]);

  const submit = useCallback(
    (request: GenerateRequest) => {
      const ticket = (token.current += 1);
      restoredId.current = undefined;
      setError(undefined);
      setJob(undefined);
      setPendingId(undefined);

      void (async () => {
        try {
          const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
          });
          if (ticket !== token.current) {
            return;
          }
          if (response.status !== 202) {
            throw new Error(await errorText(response));
          }
          const body = (await response.json()) as JobResponse;
          if (ticket === token.current) {
            writeJobId(key, body.jobId);
            setPendingId(body.jobId);
          }
        } catch (cause) {
          if (ticket === token.current) {
            setError(messageOf(cause));
          }
        }
      })();
    },
    [key],
  );

  const reset = useCallback(() => {
    token.current += 1;
    restoredId.current = undefined;
    writeJobId(key, undefined);
    setJob(undefined);
    setError(undefined);
    setPendingId(undefined);
  }, [key]);

  const handleJob = useCallback((next: Job) => setJob(next), []);

  const handleError = useCallback((message: string) => setError(message), []);

  /**
   * A restored job the server no longer has is not an error; a 404 for this page's job is.
   * The stored id is only cleared when it is the one that went missing, so a late 404 for an
   * older job cannot wipe the id a newer submit just stored.
   */
  const handleMissing = useCallback(
    (id: string) => {
      if (readJobId(key) === id) {
        writeJobId(key, undefined);
      }
      if (restoredId.current === id) {
        restoredId.current = undefined;
        setError(undefined);
        return;
      }
      setError("this job is no longer on the server");
    },
    [key],
  );

  const handleFinish = useCallback(() => setPendingId(undefined), []);

  usePolling({
    id: pendingId,
    onJob: handleJob,
    onError: handleError,
    onMissing: handleMissing,
    onFinish: handleFinish,
  });

  return { job, error, running: pendingId !== undefined, submit, reset };
}
