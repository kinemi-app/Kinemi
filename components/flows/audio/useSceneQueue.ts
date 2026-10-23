"use client";

import { useCallback, useEffect, useState } from "react";
import type { GenerateRequest, Job } from "../../../lib/types";

export type SceneClipStatus = "waiting" | "running" | "done" | "failed";

export type SceneClip = {
  speaker: string;
  text: string;
  status: SceneClipStatus;
  url?: string;
  error?: string;
};

export type SceneQueue = {
  clips: SceneClip[];
  running: boolean;
  failure?: string;
  start(requests: GenerateRequest[]): void;
  reset(): void;
};

/**
 * A5 submits one job per speaker line and never two at once. It rides the page's single
 * useJob channel, so there is still one polling path and one stored job id per page.
 */
export function useSceneQueue(
  job: Job | undefined,
  error: string | undefined,
  submit: (request: GenerateRequest) => void,
): SceneQueue {
  const [requests, setRequests] = useState<GenerateRequest[] | undefined>(undefined);
  const [index, setIndex] = useState(0);
  const [clips, setClips] = useState<SceneClip[]>([]);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const start = useCallback(
    (next: GenerateRequest[]) => {
      const first = next[0];
      if (!first) {
        return;
      }
      setFailure(undefined);
      setClips(
        next.map((request, at) => ({
          speaker: String(request.params?.speaker ?? ""),
          text: request.prompt,
          status: at === 0 ? "running" : "waiting",
        })),
      );
      setRequests(next);
      setIndex(0);
      submit(first);
    },
    [submit],
  );

  const reset = useCallback(() => {
    setRequests(undefined);
    setClips([]);
    setFailure(undefined);
  }, []);

  useEffect(() => {
    if (!requests) {
      return;
    }

    if (job?.status === "succeeded" && job.result?.kind === "audio") {
      const url = job.result.url;
      const next = index + 1;
      setClips((previous) =>
        previous.map((clip, at) => (at === index ? { ...clip, status: "done", url } : clip)),
      );

      if (next < requests.length) {
        const request = requests[next];
        if (!request) {
          return;
        }
        setIndex(next);
        setClips((previous) =>
          previous.map((clip, at) => (at === next ? { ...clip, status: "running" } : clip)),
        );
        submit(request);
        return;
      }

      setRequests(undefined);
      return;
    }

    if (job?.status === "failed") {
      const message = job.error ?? "the scene line failed";
      setClips((previous) =>
        previous.map((clip, at) =>
          at === index ? { ...clip, status: "failed", error: message } : clip,
        ),
      );
      setFailure(message);
      setRequests(undefined);
    }
  }, [index, job, requests, submit]);

  useEffect(() => {
    if (!requests || error === undefined) {
      return;
    }
    setClips((previous) =>
      previous.map((clip, at) => (at === index ? { ...clip, status: "failed", error } : clip)),
    );
    setFailure(error);
    setRequests(undefined);
  }, [error, index, requests]);

  return { clips, running: requests !== undefined, failure, start, reset };
}
