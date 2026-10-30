import { applyMessage, createRunState, liveOf, type JobLive, type RunState } from "./comfy-progress";

/**
 * Keeps one WebSocket per ComfyUI deployment and turns what it streams into a JobLive per tracked
 * prompt id, through the pure reducer in ./comfy-progress. The socket opens on the first `track`,
 * and while runs are tracked it comes back after a close or an error, waiting longer each time.
 *
 * Comfy Cloud takes its key as `&token=` on the socket URL, so the URL is never logged or put into
 * an error message here.
 */

/** The part of a ComfyConfig the feed needs. */
type FeedConfig = { url: string; apiKey?: string; isCloud: boolean };

type FeedDeps = {
  WebSocket?: typeof WebSocket;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  clientId?: string;
};

export type ProgressFeed = {
  clientId: string;
  /** Starts following a run; the socket opens now if it is not open yet. */
  track(promptId: string, weights: Record<string, number>, queuedAt: number): void;
  live(promptId: string): JobLive | undefined;
  forget(promptId: string): void;
  /** Closes the socket and stops reconnecting; the feed is not meant to be used after this. */
  close(): void;
};

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;
/** A run nobody has read for this long is dropped, so a tab closed mid-render does not keep the socket open. */
const IDLE_RUN_MS = 15 * 60_000;
/** The sweep waits a little longer than the idle window, so its first firing already finds the run expired. */
const SWEEP_MS = IDLE_RUN_MS + 1_000;

/** Cloud serves its socket at the host root, not under the /api path of its REST calls. */
function socketUrl(config: FeedConfig, clientId: string): string {
  const url = new URL(config.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = config.isCloud ? "/ws" : `${url.pathname.replace(/\/+$/, "")}/ws`;
  url.search = "";
  url.searchParams.set("clientId", clientId);
  if (config.isCloud && config.apiKey) {
    url.searchParams.set("token", config.apiKey);
  }
  return url.toString();
}

/** A text frame holding a JSON object with a string `type`; previews (binary) and junk give undefined. */
function parseFrame(data: unknown): { type: string; data?: unknown } | undefined {
  if (typeof data !== "string") {
    return undefined;
  }
  try {
    const frame: unknown = JSON.parse(data);
    const isObject = typeof frame === "object" && frame !== null;
    return isObject && typeof (frame as { type?: unknown }).type === "string"
      ? (frame as { type: string; data?: unknown })
      : undefined;
  } catch {
    // Not JSON: a frame this feed has no use for, same as a preview image.
    return undefined;
  }
}

/** The one socket of a feed, and what decides when it is opened again. */
type Link = {
  url: string;
  SocketClass: typeof WebSocket;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  onData(data: unknown): void;
  /** True while there is a run to follow; forgets the runs nobody has read for too long first. */
  isWanted(): boolean;
  socket?: WebSocket;
  retryTimer?: ReturnType<typeof setTimeout>;
  /** Forgets idle runs on its own, so a feed nobody calls still lets go of the socket and the retries. */
  sweepTimer?: ReturnType<typeof setTimeout>;
  attempts: number;
  isClosed: boolean;
};

function scheduleReconnect(link: Link): void {
  if (link.isClosed || link.retryTimer !== undefined || !link.isWanted()) {
    return;
  }
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** link.attempts, RECONNECT_MAX_MS);
  link.attempts += 1;
  link.retryTimer = link.setTimeout(() => {
    link.retryTimer = undefined;
    connect(link);
  }, delay);
}

function connect(link: Link): void {
  if (link.isClosed || !link.isWanted()) {
    return;
  }
  const current = new link.SocketClass(link.url);
  link.socket = current;
  // A socket that is no longer the current one must not move the feed's state.
  const onGone = () => {
    if (link.socket === current) {
      link.socket = undefined;
      scheduleReconnect(link);
    }
  };
  current.addEventListener("message", (event) => {
    if (link.socket === current) {
      // Only a frame proves the server keeps the socket: one that accepts and drops at once must keep backing off.
      link.attempts = 0;
      link.onData(event.data);
    }
  });
  current.addEventListener("close", onGone);
  current.addEventListener("error", onGone);
}

function clearSweep(link: Link): void {
  if (link.sweepTimer !== undefined) {
    link.clearTimeout(link.sweepTimer);
    link.sweepTimer = undefined;
  }
}

function closeLink(link: Link): void {
  link.isClosed = true;
  clearSweep(link);
  if (link.retryTimer !== undefined) {
    link.clearTimeout(link.retryTimer);
    link.retryTimer = undefined;
  }
  const closing = link.socket;
  link.socket = undefined;
  closing?.close();
}

/** Closes the socket because nothing is tracked; unlike closeLink the feed stays usable and the next track reopens it. */
function idleLink(link: Link): void {
  clearSweep(link);
  if (link.retryTimer !== undefined) {
    link.clearTimeout(link.retryTimer);
    link.retryTimer = undefined;
  }
  link.attempts = 0;
  // Cleared first, so the closing socket's own close event is ignored by onGone.
  const closing = link.socket;
  link.socket = undefined;
  closing?.close();
}

/** Offers one socket frame to every tracked run; the reducer ignores what is not for a run. */
function applyFrame(runs: Map<string, RunState>, data: unknown, at: number): void {
  const frame = parseFrame(data);
  if (frame === undefined) {
    return;
  }
  for (const [promptId, state] of runs) {
    runs.set(promptId, applyMessage(state, frame, at));
  }
}

export function createProgressFeed(config: FeedConfig, deps: FeedDeps = {}): ProgressFeed {
  const now = deps.now ?? Date.now;
  const clientId = deps.clientId ?? crypto.randomUUID();
  const source: JobLive["source"] = config.isCloud ? "cloud" : "local";
  const runs = new Map<string, RunState>();
  const lastReadAt = new Map<string, number>();
  const forget = (promptId: string): void => {
    runs.delete(promptId);
    lastReadAt.delete(promptId);
    if (runs.size === 0) {
      idleLink(link);
    }
  };
  const pruneIdleRuns = (): void => {
    const at = now();
    for (const [promptId, readAt] of [...lastReadAt]) {
      if (at - readAt > IDLE_RUN_MS) {
        forget(promptId);
      }
    }
  };
  const armSweep = (): void => {
    const timer = link.setTimeout(() => {
      link.sweepTimer = undefined;
      pruneIdleRuns();
      if (runs.size > 0 && !link.isClosed) {
        armSweep();
      }
    }, SWEEP_MS);
    // Housekeeping only: a pending sweep must not keep a script or a test process alive for 15 minutes.
    (timer as unknown as { unref?: () => void }).unref?.();
    link.sweepTimer = timer;
  };
  const link: Link = {
    url: socketUrl(config, clientId),
    SocketClass: deps.WebSocket ?? globalThis.WebSocket,
    setTimeout: deps.setTimeout ?? setTimeout,
    clearTimeout: deps.clearTimeout ?? clearTimeout,
    onData: (data) => {
      pruneIdleRuns();
      applyFrame(runs, data, now());
    },
    // Pruning here covers a reconnect that comes due while nothing reads the feed.
    isWanted: () => {
      pruneIdleRuns();
      return runs.size > 0;
    },
    attempts: 0,
    isClosed: false,
  };

  return {
    clientId,
    track(promptId, weights, queuedAt) {
      pruneIdleRuns();
      if (link.isClosed || runs.has(promptId)) {
        return;
      }
      runs.set(promptId, createRunState({ promptId, weights, queuedAt, source }));
      lastReadAt.set(promptId, now());
      if (link.sweepTimer === undefined) {
        armSweep();
      }
      if (link.socket === undefined && link.retryTimer === undefined) {
        connect(link);
      }
    },
    live(promptId) {
      pruneIdleRuns();
      const state = runs.get(promptId);
      if (state === undefined) {
        return undefined;
      }
      lastReadAt.set(promptId, now());
      return liveOf(state, now());
    },
    forget,
    close: () => closeLink(link),
  };
}
