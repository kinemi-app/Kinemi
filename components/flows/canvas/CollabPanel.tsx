"use client";

import type { Peer } from "./collab";
import { Button, cx } from "../../ui";
import styles from "./canvas.module.css";

export type CopyState = "idle" | "copied" | "failed";

type CollabPanelProps = {
  name: string;
  peers: Peer[];
  supported: boolean;
  shareUrl: string;
  copyState: CopyState;
  lockedCount: number;
  onName: (name: string) => void;
  onCopy: () => void;
};

function copyLabel(state: CopyState): string {
  if (state === "copied") return "Link copied";
  if (state === "failed") return "Copy failed";
  return "Copy live link";
}

function PresenceList({ peers }: { peers: Peer[] }) {
  if (peers.length === 0) {
    return (
      <p className={styles.note}>
        No other tab is here yet. Open this board in a second tab to see presence and locks travel.
      </p>
    );
  }
  return (
    <ul className={styles.peers}>
      {peers.map((peer, index) => (
        <li key={peer.id} className={styles.peer}>
          <span className={cx(styles.peerDot, styles[`peerDot${index % 4}`])} aria-hidden="true" />
          <span>{peer.name}</span>
          <span className={styles.peerMeta}>editing</span>
        </li>
      ))}
    </ul>
  );
}

/** N3: presence and advisory element locks between tabs, plus a snapshot link for another machine. */
export function CollabPanel({
  name,
  peers,
  supported,
  shareUrl,
  copyState,
  lockedCount,
  onName,
  onCopy,
}: CollabPanelProps) {
  return (
    <div className={styles.stack}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Your name</span>
        <input
          className={styles.input}
          value={name}
          aria-label="Your name"
          maxLength={40}
          onChange={(event) => onName(event.target.value)}
        />
      </label>
      <div className={styles.row}>
        <input
          className={styles.shareLink}
          value={shareUrl}
          readOnly
          aria-label="Share link"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button variant="ghost" onClick={onCopy}>
          {copyLabel(copyState)}
        </Button>
      </div>
      <p className={styles.note}>
        {supported
          ? "Presence and node locks sync between tabs of this browser over BroadcastChannel."
          : "This browser has no BroadcastChannel, so presence and locks stay local."}{" "}
        The link carries a snapshot of the board; another machine can load it but cannot join live
        without a room server. {lockedCount} {lockedCount === 1 ? "step is" : "steps are"} locked.
      </p>
      <PresenceList peers={peers} />
    </div>
  );
}
