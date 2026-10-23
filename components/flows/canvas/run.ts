import { findModel } from "../../../lib/models";
import type { GenerateRequest, Job } from "../../../lib/types";
import type { CanvasBoard, CanvasNode } from "./board";
import { orderNodes } from "./board";

export type NodeUpdate = (id: string, patch: Partial<CanvasNode>) => void;

const POLL_MS = 700;
const MAX_POLL_FAILURES = 5;
const JOB_TIMEOUT_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PROMPT = 2000;

async function readError(response: Response): Promise<string> {
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

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

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

function requestFor(node: CanvasNode, upstreamTitle: string | undefined): GenerateRequest {
  const model = findModel(node.modelId);
  if (!model || !model.modes.includes(node.mode)) {
    throw new Error(`The ${node.mode} step has no model that can run it.`);
  }
  const prompt = node.prompt.trim();
  if (prompt === "") {
    throw new Error("Add a prompt to this step first.");
  }
  return {
    mode: node.mode,
    modelId: model.id,
    prompt: prompt.slice(0, MAX_PROMPT),
    durationS: Math.min(Math.max(1, Math.round(node.durationS)), model.maxDurationS),
    params: { source: "canvas", upstream: upstreamTitle ?? "none" },
  };
}

async function submit(
  node: CanvasNode,
  upstreamTitle: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestFor(node, upstreamTitle)),
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

async function pollJob(jobId: string, signal: AbortSignal): Promise<Job> {
  const startedAt = Date.now();
  let failures = 0;

  for (;;) {
    if (signal.aborted) {
      throw new DOMException("The board was stopped.", "AbortError");
    }
    if (Date.now() - startedAt > JOB_TIMEOUT_MS) {
      throw new Error("The step did not finish in 15 minutes.");
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

async function runOne(
  node: CanvasNode,
  upstreamTitle: string | undefined,
  update: NodeUpdate,
  signal: AbortSignal,
): Promise<void> {
  update(node.id, {
    status: "running",
    error: undefined,
    resultUrl: undefined,
    resultKind: undefined,
  });
  try {
    const jobId = await submit(node, upstreamTitle, signal);
    const job = await pollJob(jobId, signal);
    if (job.status === "failed") {
      update(node.id, { status: "failed", error: job.error ?? "The step failed." });
      return;
    }
    update(node.id, {
      status: "succeeded",
      resultUrl: job.result?.url,
      resultKind: job.result?.kind,
    });
  } catch (cause) {
    if (signal.aborted || isAbort(cause)) {
      update(node.id, { status: "idle" });
      return;
    }
    update(node.id, { status: "failed", error: messageOf(cause) });
  }
}

/** Run every step once, parents first. One at a time, so a board can never fan out without a limit. */
export async function runBoard(
  board: CanvasBoard,
  update: NodeUpdate,
  signal: AbortSignal,
): Promise<void> {
  const byId = new Map(board.nodes.map((node) => [node.id, node]));
  for (const node of orderNodes(board.nodes)) {
    if (signal.aborted) {
      return;
    }
    const upstream = node.inputId ? byId.get(node.inputId) : undefined;
    await runOne(node, upstream?.title, update, signal);
  }
}

/** Run one step alone; its upstream title still travels so the prompt keeps its context. */
export async function runStep(
  board: CanvasBoard,
  nodeId: string,
  update: NodeUpdate,
  signal: AbortSignal,
): Promise<void> {
  const node = board.nodes.find((row) => row.id === nodeId);
  if (!node) {
    return;
  }
  const upstream = node.inputId
    ? board.nodes.find((row) => row.id === node.inputId)
    : undefined;
  await runOne(node, upstream?.title, update, signal);
}
