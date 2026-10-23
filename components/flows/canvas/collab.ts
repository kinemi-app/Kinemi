import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasBoard } from "./board";

/**
 * Presence and board sharing between tabs of the same browser over BroadcastChannel.
 * There is no room server: the share link carries a snapshot, and live edits stay on this machine.
 */

export type Peer = {
  id: string;
  name: string;
  lastSeen: number;
};

type PeerMessage = { type: "presence"; peer: Peer } | { type: "leave"; id: string };
type BoardMessage = { type: "board"; from: string; board: CanvasBoard };
type Message = PeerMessage | BoardMessage;

const CHANNEL_NAME = "kinemi.canvas";
const HEARTBEAT_MS = 4000;
const PEER_TTL_MS = 12000;

function createPeerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `peer-${Date.now().toString(36)}`;
}

export type CanvasCollab = {
  peers: Peer[];
  supported: boolean;
  peerId: string;
  publishBoard(board: CanvasBoard): void;
};

/** Keep the peer list fresh, and hand a remote board to the caller without echoing it back. */
export function useCanvasCollab(
  name: string,
  onRemoteBoard: (board: CanvasBoard) => void,
): CanvasCollab {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [supported, setSupported] = useState(false);
  const channelRef = useRef<BroadcastChannel | undefined>(undefined);
  const peerIdRef = useRef<string>("");
  if (peerIdRef.current === "") {
    peerIdRef.current = createPeerId();
  }
  const nameRef = useRef(name);
  nameRef.current = name;
  const onBoardRef = useRef(onRemoteBoard);
  onBoardRef.current = onRemoteBoard;

  const sendPresence = useCallback(() => {
    channelRef.current?.postMessage({
      type: "presence",
      peer: { id: peerIdRef.current, name: nameRef.current, lastSeen: Date.now() },
    } satisfies PeerMessage);
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      return;
    }
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    setSupported(true);

    channel.onmessage = (event: MessageEvent<Message>) => {
      const message = event.data;
      if (message.type === "presence") {
        if (message.peer.id === peerIdRef.current) return;
        setPeers((previous) => [
          ...previous.filter((peer) => peer.id !== message.peer.id),
          { ...message.peer, lastSeen: Date.now() },
        ]);
        return;
      }
      if (message.type === "leave") {
        setPeers((previous) => previous.filter((peer) => peer.id !== message.id));
        return;
      }
      if (message.from !== peerIdRef.current) {
        onBoardRef.current(message.board);
      }
    };

    sendPresence();
    const heartbeat = window.setInterval(() => {
      sendPresence();
      setPeers((previous) => previous.filter((peer) => Date.now() - peer.lastSeen < PEER_TTL_MS));
    }, HEARTBEAT_MS);

    return () => {
      window.clearInterval(heartbeat);
      channel.postMessage({ type: "leave", id: peerIdRef.current } satisfies PeerMessage);
      channel.close();
      channelRef.current = undefined;
    };
  }, [sendPresence]);

  useEffect(() => {
    if (supported) {
      sendPresence();
    }
  }, [name, supported, sendPresence]);

  const publishBoard = useCallback((board: CanvasBoard) => {
    channelRef.current?.postMessage({
      type: "board",
      from: peerIdRef.current,
      board,
    } satisfies BoardMessage);
  }, []);

  return { peers, supported, peerId: peerIdRef.current, publishBoard };
}
