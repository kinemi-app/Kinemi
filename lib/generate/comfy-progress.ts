/**
 * Live progress of a ComfyUI run, read from the messages ComfyUI streams on its WebSocket
 * (`/ws?clientId=…`; Comfy Cloud adds `&token=<apiKey>`). `applyMessage` is a pure reducer from one
 * message to the next state, and `liveOf` reads a JobLive out of a state. The socket that feeds it,
 * one state per tracked prompt id, lives in comfy-progress-feed.ts.
 *
 * Progress is weighed, not counted: every node weighs one unit, a sampler weighs its `steps`, and
 * the fraction is the finished (or cached) weight plus the running sampler's value/max of its own
 * weight, over the total. Nothing here is estimated beyond that: the time left is the remaining
 * weight at the rate the sampler steps of this run have actually taken.
 */

export type JobLive = {
  phase: "queued" | "running" | "done";
  message?: string;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  step?: number;
  steps?: number;
  node?: string;
  fraction: number;
  remainingMs?: number;
  gpuMs: number;
  credits?: number;
  source: "cloud" | "local";
};

/** The sampler whose `progress` is being followed, with the clock readings its rate comes from. */
type Sampler = { node: string; value: number; max: number; startedAt: number; baseValue: number; lastAt: number };

/** Opaque to callers: build it with createRunState, move it with applyMessage, read it with liveOf. */
export type RunState = Readonly<{
  promptId: string;
  weights: Readonly<Record<string, number>>;
  totalWeight: number;
  source: JobLive["source"];
  queuedAt: number;
  phase: JobLive["phase"];
  message?: string;
  startedAt?: number;
  endedAt?: number;
  finished: ReadonlySet<string>;
  finishedWeight: number;
  /** The node the latest `executing` named, and when. */
  current?: string;
  currentSince?: number;
  running?: Sampler;
  /** Sampler time and weight of samplers that are finished, the base of ms per weight unit. */
  measuredMs: number;
  measuredWeight: number;
  step?: number;
  steps?: number;
  node?: string;
  fraction: number;
}>;

const EXECUTION_FAILED = "The render failed.";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** A node weighs its `steps` when that is a positive number, else one unit. */
export function graphWeights(graph: Record<string, { inputs?: Record<string, unknown> }>): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const [id, node] of Object.entries(graph)) {
    const steps = finiteNumber(node.inputs?.steps);
    weights[id] = steps !== undefined && steps > 0 ? steps : 1;
  }
  return weights;
}

export function createRunState(opts: {
  promptId: string;
  weights: Record<string, number>;
  queuedAt: number;
  source: JobLive["source"];
}): RunState {
  const totalWeight = Object.values(opts.weights).reduce((sum, weight) => sum + weight, 0);
  return {
    promptId: opts.promptId,
    weights: opts.weights,
    totalWeight,
    source: opts.source,
    queuedAt: opts.queuedAt,
    phase: "queued",
    finished: new Set(),
    finishedWeight: 0,
    measuredMs: 0,
    measuredWeight: 0,
    fraction: 0,
  };
}

function weightOf(state: RunState, node: string): number {
  return Object.hasOwn(state.weights, node) ? (state.weights[node] ?? 0) : 0;
}

/** The weight a running sampler has finished so far. */
function partialWeight(state: RunState, sampler: Sampler | undefined): number {
  return sampler === undefined ? 0 : weightOf(state, sampler.node) * (sampler.value / sampler.max);
}

/** The time and weight of the steps this sampler really ran; steps seen before we watched do not count. */
function samplerMeasure(state: RunState, sampler: Sampler): { ms: number; weight: number } {
  const unit = weightOf(state, sampler.node) / sampler.max;
  return { ms: sampler.lastAt - sampler.startedAt, weight: unit * (sampler.value - sampler.baseValue) };
}

function foldRunning(state: RunState): RunState {
  if (state.running === undefined) {
    return state;
  }
  const { ms, weight } = samplerMeasure(state, state.running);
  return { ...state, running: undefined, measuredMs: state.measuredMs + ms, measuredWeight: state.measuredWeight + weight };
}

function finishNode(state: RunState, node: string): RunState {
  if (state.finished.has(node)) {
    return state;
  }
  const base = state.running?.node === node ? foldRunning(state) : state;
  return {
    ...base,
    finished: new Set(base.finished).add(node),
    finishedWeight: base.finishedWeight + weightOf(base, node),
  };
}

/** Moves the running sampler to `value` of `max`; a first sighting starts its clock. */
function advance(state: RunState, node: string, value: number, max: number, now: number): RunState {
  if (max <= 0 || state.finished.has(node)) {
    return state;
  }
  const at = clamp(value, 0, max);
  const previous = state.running;
  if (previous?.node === node) {
    return at > previous.value ? { ...state, running: { ...previous, value: at, max, lastAt: now } } : state;
  }
  // `executing` named this node, so its clock started then and every step it reports is ours to time.
  const sawStart = state.current === node && state.currentSince !== undefined;
  const sampler: Sampler = {
    node,
    value: at,
    max,
    startedAt: sawStart ? (state.currentSince ?? now) : now,
    baseValue: sawStart ? 0 : at,
    lastAt: now,
  };
  return { ...foldRunning(state), running: sampler };
}

function started(state: RunState, now: number): RunState {
  return state.startedAt === undefined
    ? { ...state, phase: "running", startedAt: now, message: undefined }
    : state;
}

function onExecuting(state: RunState, data: Record<string, unknown>, now: number): RunState {
  // ComfyUI names the node, or sends null once the graph is through; anything else is not a frame of ours.
  if (typeof data.node !== "string" && data.node !== null) {
    return state;
  }
  const node = data.node ?? undefined;
  const base = started(state, now);
  const finished = base.current !== undefined && base.current !== node ? finishNode(base, base.current) : base;
  return { ...finished, current: node, currentSince: node === undefined ? undefined : now };
}

function onProgress(state: RunState, data: Record<string, unknown>, now: number): RunState {
  const value = finiteNumber(data.value);
  const max = finiteNumber(data.max);
  if (value === undefined || max === undefined || max <= 0) {
    return state;
  }
  const base = started(state, now);
  const node = typeof data.node === "string" ? data.node : base.current;
  if (node === undefined) {
    return base;
  }
  return { ...advance(base, node, value, max, now), step: clamp(value, 0, max), steps: max, node };
}

/** Cloud's per-node table: finished nodes are done, a running one with a range is followed. */
function onProgressState(state: RunState, data: Record<string, unknown>, now: number): RunState {
  let next = state;
  for (const [id, raw] of Object.entries(asRecord(data.nodes) ?? {})) {
    const entry = asRecord(raw);
    if (entry?.state === "finished") {
      next = finishNode(next, id);
    } else if (entry?.state === "running") {
      const value = finiteNumber(entry.value);
      const max = finiteNumber(entry.max);
      next = value === undefined || max === undefined ? next : advance(next, id, value, max, now);
    }
  }
  return next === state ? state : started(next, now);
}

function onNotification(state: RunState, data: Record<string, unknown>): RunState {
  return state.startedAt === undefined && typeof data.value === "string" ? { ...state, message: data.value } : state;
}

function reduce(state: RunState, type: string, data: Record<string, unknown>, now: number): RunState {
  switch (type) {
    case "notification":
      return onNotification(state, data);
    case "execution_start":
      return started(state, now);
    case "execution_cached": {
      const cached = Array.isArray(data.nodes) ? data.nodes : [];
      return cached.reduce((next: RunState, id) => (typeof id === "string" ? finishNode(next, id) : next), state);
    }
    case "executing":
      return onExecuting(state, data, now);
    case "progress":
      return onProgress(state, data, now);
    case "progress_state":
      return onProgressState(state, data, now);
    case "executed":
      return typeof data.node === "string" ? finishNode(state, data.node) : state;
    case "execution_success":
      return { ...state, phase: "done", message: undefined, endedAt: now, fraction: 1 };
    case "execution_error": {
      const reason = typeof data.exception_message === "string" ? data.exception_message : EXECUTION_FAILED;
      return { ...state, phase: "done", message: reason, endedAt: now };
    }
    default:
      return state;
  }
}

/** Raises the fraction to what the weights say; it never goes back down. */
function withFraction(state: RunState): RunState {
  if (state.totalWeight <= 0) {
    return state;
  }
  const done = (state.finishedWeight + partialWeight(state, state.running)) / state.totalWeight;
  const fraction = clamp(Math.max(state.fraction, done), 0, 1);
  return fraction === state.fraction ? state : { ...state, fraction };
}

/**
 * Cloud may stream every job in its workspace, so a message counts only with this run's prompt id.
 * A `notification` can come without one (the queue text before a prompt id is known).
 */
function isForRun(state: RunState, type: string, data: Record<string, unknown>): boolean {
  return typeof data.prompt_id === "string" ? data.prompt_id === state.promptId : type === "notification";
}

/** The next state after one message; unknown, foreign or malformed messages return `state` as it was. */
export function applyMessage(state: RunState, msg: { type: string; data?: unknown }, now: number): RunState {
  const frame = asRecord(msg);
  const data = asRecord(frame?.data) ?? {};
  if (state.phase === "done" || typeof frame?.type !== "string" || !isForRun(state, frame.type, data)) {
    return state;
  }
  const next = reduce(state, frame.type, data, now);
  return next.phase === "done" ? next : withFraction(next);
}

function gpuMsOf(state: RunState, now: number): number {
  if (state.startedAt === undefined) {
    return 0;
  }
  return Math.max(0, (state.endedAt ?? now) - state.startedAt);
}

/** Time left at the pace of the sampler steps that finished; unknown until one has. */
function remainingMsOf(state: RunState): number | undefined {
  if (state.phase !== "running") {
    return undefined;
  }
  const live = state.running === undefined ? { ms: 0, weight: 0 } : samplerMeasure(state, state.running);
  const ms = state.measuredMs + live.ms;
  const weight = state.measuredWeight + live.weight;
  return ms > 0 && weight > 0 ? state.totalWeight * (1 - state.fraction) * (ms / weight) : undefined;
}

export function liveOf(state: RunState, now: number): JobLive {
  const live: JobLive = {
    phase: state.phase,
    queuedAt: state.queuedAt,
    fraction: state.fraction,
    gpuMs: gpuMsOf(state, now),
    source: state.source,
  };
  const remainingMs = remainingMsOf(state);
  const optional = {
    message: state.message,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    step: state.step,
    steps: state.steps,
    node: state.node,
    remainingMs,
  };
  return { ...live, ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)) };
}
