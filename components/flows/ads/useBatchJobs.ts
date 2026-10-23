"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerateRequest, Job, JobResponse } from "../../../lib/types";

/**
 * Run several generation requests at once and report each one's status on its own. The single
 * useJob hook retires the previous submit by design, so a panel that needs one job per variant or
 * per model drives POST /api/generate and GET /api/jobs here instead.
 *
 * Shared by the Marketing Studio and the Fashion Factory; it moves to components/ui once that
 * folder is in scope for this work.
 */

const POLL_MS = 700;

export type BatchItem = {
  status: Job["status"];
  progress: number;
  result?: Job["result"];
  error?: string;
};

export type BatchRun = {
  items: BatchItem[];
  running: boolean;
  run(requests: GenerateRequest[]): void;
};

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "the run failed";
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Submit one request, then poll it to a verdict. Failures land on the item, never on the batch. */
async function runOne(request: GenerateRequest, update: (item: BatchItem) => void): Promise<void> {
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (response.status !== 202) {
      throw new Error(await errorText(response));
    }
    const { jobId } = (await response.json()) as JobResponse;
    update({ status: "queued", progress: 0 });

    for (;;) {
      await delay(POLL_MS);
      const poll = await fetch(`/api/jobs/${jobId}`);
      if (!poll.ok) {
        throw new Error(await errorText(poll));
      }
      const job = (await poll.json()) as Job;
      update({ status: job.status, progress: job.progress, result: job.result, error: job.error });
      if (job.status === "succeeded" || job.status === "failed") {
        return;
      }
    }
  } catch (cause) {
    update({ status: "failed", progress: 0, error: messageOf(cause) });
  }
}

export function useBatchJobs(): BatchRun {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  /** A newer run or an unmount invalidates every update the older one still has in flight. */
  const generation = useRef(0);

  useEffect(() => {
    return () => {
      generation.current += 1;
    };
  }, []);

  const run = useCallback((requests: GenerateRequest[]) => {
    const ticket = (generation.current += 1);
    setItems(requests.map(() => ({ status: "queued", progress: 0 })));
    setRunning(true);

    const updates = requests.map((request, index) =>
      runOne(request, (item) => {
        if (ticket !== generation.current) {
          return;
        }
        setItems((current) => current.map((entry, at) => (at === index ? item : entry)));
      }),
    );

    void Promise.all(updates).then(() => {
      if (ticket === generation.current) {
        setRunning(false);
      }
    });
  }, []);

  return { items, running, run };
}
