import { HEARTBEAT_MS, formatEvent } from "./protocol";
import { joinRoom, roomSnapshot, type Room } from "./rooms";

export type RoomStream = {
  response: Response;
  /** Remove the subscriber and stop the heartbeat; safe to call more than once. */
  close: () => void;
};

/**
 * One subscriber's SSE response: "hello" with the room snapshot first, a heartbeat comment every
 * HEARTBEAT_MS, then the "presence" and "patch" frames the room pushes.
 */
export function openRoomStream(room: Room, roomId: string, clientId: string): RoomStream {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let leave: (() => void) | null = null;
  let isClosed = false;

  const close = () => {
    if (isClosed) {
      return;
    }
    isClosed = true;
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    leave?.();
    leave = null;
  };

  const write = (frame: string) => {
    if (isClosed || controller === null) {
      return;
    }
    try {
      controller.enqueue(encoder.encode(frame));
    } catch {
      // The response died between two frames (a dropped socket); drop the subscriber too.
      close();
    }
  };

  const send = (event: string, data: unknown) => write(formatEvent(event, data));

  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      leave = joinRoom(room, clientId, send);
      const snapshot = roomSnapshot(room);
      send("hello", { room: roomId, clientId, peers: snapshot.peers, patches: snapshot.patches });
      heartbeat = setInterval(() => write(": alive\n\n"), HEARTBEAT_MS);
    },
    cancel() {
      close();
      controller = null;
    },
  });

  const response = new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform also keeps the compression middleware from buffering short frames.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });

  return { response, close };
}
