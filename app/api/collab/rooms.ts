import {
  MAX_CLIENTS_PER_ROOM,
  MAX_HISTORY,
  MAX_ROOMS,
  type CollabPatch,
  type CollabPatchInput,
} from "./protocol";

/**
 * The live canvas rooms, held in this server process. The entry has no database: a restart
 * starts every room empty, and a second instance would keep a second set of rooms.
 */

/** One subscriber's way back to its response stream. */
export type CollabSend = (event: string, data: unknown) => void;

type Subscriber = {
  clientId: string;
  send: CollabSend;
};

export type Room = {
  id: string;
  openedAt: number;
  subscribers: Map<string, Subscriber>;
  patches: CollabPatch[];
  nextSeq: number;
};

const rooms = new Map<string, Room>();

/** The oldest room with nobody in it, the first to drop when the room cap is reached. */
function oldestEmptyRoom(): Room | undefined {
  let oldest: Room | undefined;
  for (const room of rooms.values()) {
    const isOlder = oldest === undefined || room.openedAt < oldest.openedAt;
    if (room.subscribers.size === 0 && isOlder) {
      oldest = room;
    }
  }
  return oldest;
}

/** The room named in the URL, opened on first use. Null when every room is taken and busy. */
export function getOrCreateRoom(roomId: string): Room | null {
  const existing = rooms.get(roomId);
  if (existing) {
    return existing;
  }
  if (rooms.size >= MAX_ROOMS) {
    const evicted = oldestEmptyRoom();
    if (!evicted) {
      return null;
    }
    rooms.delete(evicted.id);
  }
  const room: Room = {
    id: roomId,
    openedAt: Date.now(),
    subscribers: new Map(),
    patches: [],
    nextSeq: 1,
  };
  rooms.set(roomId, room);
  return room;
}

/** A client that already holds this id is reconnecting, so it does not need a second slot. */
export function isRoomFull(room: Room, clientId: string): boolean {
  return room.subscribers.size >= MAX_CLIENTS_PER_ROOM && !room.subscribers.has(clientId);
}

function roomPeers(room: Room): string[] {
  return [...room.subscribers.keys()];
}

/** What a fresh subscriber needs: who is here, and every patch worth replaying. */
export function roomSnapshot(room: Room): { peers: string[]; patches: CollabPatch[] } {
  return { peers: roomPeers(room), patches: [...room.patches] };
}

/**
 * Register one stream in the room and tell the others somebody joined. The returned leave
 * function only acts while this very connection is the client's current one, so a reconnect
 * that already replaced it cannot remove the newer stream.
 */
export function joinRoom(room: Room, clientId: string, send: CollabSend): () => void {
  const subscriber: Subscriber = { clientId, send };
  room.subscribers.set(clientId, subscriber);

  const peers = roomPeers(room);
  for (const other of room.subscribers.values()) {
    if (other !== subscriber) {
      other.send("presence", { peers });
    }
  }

  return () => {
    if (room.subscribers.get(clientId) !== subscriber) {
      return;
    }
    room.subscribers.delete(clientId);
    const remaining = roomPeers(room);
    for (const other of room.subscribers.values()) {
      other.send("presence", { peers: remaining });
    }
  };
}

/** Append a patch to the room log and fan it out; the sender gets it too, to learn its sequence. */
export function publishPatch(room: Room, clientId: string, input: CollabPatchInput): CollabPatch {
  const patch: CollabPatch = { seq: room.nextSeq, clientId, at: Date.now(), ...input };
  room.nextSeq += 1;
  room.patches.push(patch);
  if (room.patches.length > MAX_HISTORY) {
    room.patches.splice(0, room.patches.length - MAX_HISTORY);
  }
  for (const subscriber of room.subscribers.values()) {
    subscriber.send("patch", patch);
  }
  return patch;
}
