"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * N3 live rooms: subscribe to /api/collab/:room and publish board patches through it. The room
 * keeps presence and the patch log in memory, so this is the shared-room path next to the
 * BroadcastChannel one in ./collab; a board operation inside a patch stays the caller's shape.
 */

/** Matches the server's replay cap: the log a fresh subscriber receives and then appends to. */
const MAX_PATCHES = 200;
const REQUEST_TIMEOUT_MS = 30_000;

export type CollabPatch = {
  seq: number;
  clientId: string;
  at: number;
  type: string;
  data?: unknown;
};

export type CollabStatus = "connecting" | "live" | "reconnecting" | "closed";

export type CollabRoom = {
  /** This browser's id in the room, sent with every patch. */
  clientId: string;
  status: CollabStatus;
  /** Everyone in the room, this client included, as the server last reported it. */
  peers: string[];
  /** The board log: the server's replay on open, then live patches, oldest first. */
  patches: CollabPatch[];
  /** Publish one board patch; it returns over the stream with the room's sequence on it. */
  sendPatch(type: string, data?: unknown): Promise<void>;
};

function createClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `client-${Date.now().toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMessage(event: Event): unknown {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    return null;
  }
  try {
    return JSON.parse(event.data);
  } catch {
    // A frame we cannot parse is dropped; the stream itself is still healthy.
    return null;
  }
}

function readPeers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((peer): peer is string => typeof peer === "string");
}

function readPatch(value: unknown): CollabPatch | null {
  if (!isRecord(value)) {
    return null;
  }
  const { seq, clientId, at, type, data } = value;
  if (
    typeof seq !== "number" ||
    typeof at !== "number" ||
    typeof clientId !== "string" ||
    typeof type !== "string"
  ) {
    return null;
  }
  return data === undefined ? { seq, clientId, at, type } : { seq, clientId, at, type, data };
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Not JSON; fall through to the status line.
  }
  return `HTTP ${response.status}`;
}

/** A live room for one board: connect on mount, reconnect by EventSource, leave on unmount. */
export function useCollabRoom(roomId: string): CollabRoom {
  const [clientId] = useState(createClientId);
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [peers, setPeers] = useState<string[]>([]);
  const [patches, setPatches] = useState<CollabPatch[]>([]);

  useEffect(() => {
    if (roomId === "") {
      setStatus("closed");
      setPeers([]);
      setPatches([]);
      return;
    }

    const source = new EventSource(
      `/api/collab/${encodeURIComponent(roomId)}?clientId=${encodeURIComponent(clientId)}`,
    );
    setStatus("connecting");
    setPeers([]);
    setPatches([]);

    source.onopen = () => setStatus("live");
    source.onerror = () => {
      // EventSource retries a dropped stream itself; CLOSED means it gave up, for example on a 400.
      setStatus(source.readyState === EventSource.CLOSED ? "closed" : "reconnecting");
    };

    source.addEventListener("hello", (event) => {
      const message = readMessage(event);
      if (!isRecord(message)) {
        return;
      }
      const history = Array.isArray(message.patches)
        ? message.patches.map(readPatch).filter((patch): patch is CollabPatch => patch !== null)
        : [];
      setPeers(readPeers(message.peers));
      setPatches(history.slice(-MAX_PATCHES));
      setStatus("live");
    });

    source.addEventListener("presence", (event) => {
      const message = readMessage(event);
      if (isRecord(message)) {
        setPeers(readPeers(message.peers));
      }
    });

    source.addEventListener("patch", (event) => {
      const patch = readPatch(readMessage(event));
      if (patch) {
        setPatches((previous) => [...previous, patch].slice(-MAX_PATCHES));
      }
    });

    return () => {
      source.close();
    };
  }, [roomId, clientId]);

  const sendPatch = useCallback(
    async (type: string, data?: unknown) => {
      const response = await fetch(`/api/collab/${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, patch: data === undefined ? { type } : { type, data } }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(await readError(response));
      }
    },
    [roomId, clientId],
  );

  return { clientId, status, peers, patches, sendPatch };
}
