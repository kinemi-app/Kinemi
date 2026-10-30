import type { Job } from "../types";
import { cloudCredits } from "./comfy-cost";
import type { JobLive } from "./comfy-progress";
import type { ProgressFeed } from "./comfy-progress-feed";

/** Cloud's own run timestamps, epoch ms, as /jobs/:id answers them. */
export type CloudTimes = { execution_start_time?: unknown; execution_end_time?: unknown };

/**
 * The feed's last reading, closed. Cloud's timestamps, when both are there, set the GPU time and
 * price it at the published rate; without them the feed's gpuMs stays and no credits are claimed.
 */
export function finishedLive(feed: ProgressFeed, job: Job, promptId: string, times?: CloudTimes): JobLive | undefined {
  const seen = feed.live(promptId);
  const { execution_start_time: startedAt, execution_end_time: endedAt } = times ?? {};
  const isTimed =
    typeof startedAt === "number" && typeof endedAt === "number" && Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt;
  if (!isTimed) {
    return seen && { ...seen, phase: "done", fraction: 1, remainingMs: undefined };
  }
  const gpuMs = endedAt - startedAt;
  const base: JobLive = { queuedAt: job.createdAt, source: "cloud", gpuMs, ...seen, phase: "done", fraction: 1, remainingMs: undefined };
  return { ...base, startedAt, endedAt, gpuMs, credits: cloudCredits(gpuMs) };
}

/** A failed run's last reading: finished, with no time left, and the fraction it reached. */
export function closedLive(live?: JobLive): JobLive | undefined {
  return live && { ...live, phase: "done", remainingMs: undefined };
}

type HistoryMessage = [unknown, Record<string, unknown>?];

/** The first status message of this kind in one history entry, if there is one. */
function statusMessage(messages: unknown, kind: string): HistoryMessage | undefined {
  if (!Array.isArray(messages)) {
    return undefined;
  }
  return (messages as HistoryMessage[]).find((message) => Array.isArray(message) && message[0] === kind);
}

/**
 * Why a local run ended in an error, or undefined while it has not. ComfyUI marks it in
 * /history/<id> (`status.status_str` "error", with the execution_error message), and the socket
 * feed marks it with a finished live that still carries a message, which can arrive first.
 */
export function localRunFailure(history: unknown, promptId: string, live?: JobLive): string | undefined {
  const entry = (history as Record<string, { status?: { status_str?: unknown; messages?: unknown } }> | undefined)?.[promptId];
  if (entry?.status?.status_str === "error") {
    const error = statusMessage(entry.status.messages, "execution_error")?.[1];
    for (const text of [error?.exception_message, error?.node_type]) {
      if (typeof text === "string" && text !== "") {
        return text;
      }
    }
    // An interrupted run is marked "error" in /history but carries no execution_error.
    return statusMessage(entry.status.messages, "execution_interrupted") ? "the run was interrupted" : "ComfyUI reported an error";
  }
  return live?.phase === "done" && live.message ? live.message : undefined;
}
