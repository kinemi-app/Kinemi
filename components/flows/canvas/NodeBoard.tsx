"use client";

import type { CanvasBoard, CanvasNode } from "./board";
import { boardHeight, boardWidth, nodeWidth } from "./board";
import { NodeCard } from "./NodeCard";
import { EmptyState } from "../../ui";
import styles from "./canvas.module.css";

type BoardAction = {
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<CanvasNode>) => void;
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
  onRun: (id: string) => void;
  onToggleLock: (id: string) => void;
};

type NodeBoardProps = BoardAction & {
  board: CanvasBoard;
  selectedId: string | undefined;
  selfId: string;
  running: boolean;
  onTitle: (title: string) => void;
  onAdd: () => void;
};

type Edge = { from: CanvasNode; to: CanvasNode };

const EDGE_ANCHOR_Y = 56;

function BoardEdges({ edges }: { edges: Edge[] }) {
  return (
    <svg className={styles.edges} width="100%" height="100%" aria-hidden="true">
      <defs>
        <marker id="canvas-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path className={styles.arrowHead} d="M0 0 L8 4 L0 8 z" />
        </marker>
      </defs>
      {edges.map(({ from, to }) => {
        const startX = from.x + nodeWidth();
        const startY = from.y + EDGE_ANCHOR_Y;
        const endX = to.x;
        const endY = to.y + EDGE_ANCHOR_Y;
        const bend = Math.max(40, Math.abs(endX - startX) / 2);
        return (
          <path
            key={`${from.id}-${to.id}`}
            className={styles.edge}
            markerEnd="url(#canvas-arrow)"
            d={`M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`}
          />
        );
      })}
    </svg>
  );
}

function BoardTitle({
  title,
  nodes,
  onTitle,
}: {
  title: string;
  nodes: number;
  onTitle: (title: string) => void;
}) {
  return (
    <div className={styles.boardBar}>
      <label className={styles.boardTitle}>
        <span className={styles.fieldLabel}>Board</span>
        <input
          className={styles.titleInput}
          value={title}
          aria-label="Board title"
          onChange={(event) => onTitle(event.target.value)}
        />
      </label>
      <span className={styles.boardCount}>
        {nodes} {nodes === 1 ? "step" : "steps"} · parents run first
      </span>
    </div>
  );
}

/** The scrollable board: edges under the cards, cards positioned by their saved coordinates. */
export function NodeBoard({
  board,
  selectedId,
  selfId,
  running,
  onTitle,
  onAdd,
  onSelect,
  onPatch,
  onMove,
  onRemove,
  onRun,
  onToggleLock,
}: NodeBoardProps) {
  const byId = new Map(board.nodes.map((node) => [node.id, node]));
  const edges: Edge[] = [];
  for (const node of board.nodes) {
    const from = node.inputId ? byId.get(node.inputId) : undefined;
    if (from) edges.push({ from, to: node });
  }

  return (
    <div className={styles.boardViewport}>
      <BoardTitle title={board.title} nodes={board.nodes.length} onTitle={onTitle} />
      <div
        className={styles.boardCanvas}
        style={{ width: boardWidth(board), height: boardHeight(board) }}
      >
        <BoardEdges edges={edges} />
        {board.nodes.length === 0 ? (
          <div className={styles.emptyBoard}>
            <EmptyState
              title="No steps yet"
              body="A board is a chain of model steps: a still, a move, an edit, a score."
              action={
                <button type="button" className={styles.nodeButton} onClick={onAdd}>
                  Add the first step
                </button>
              }
            />
          </div>
        ) : null}
        {board.nodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            board={board}
            selected={node.id === selectedId}
            selfId={selfId}
            running={running}
            onSelect={() => onSelect(node.id)}
            onPatch={(patch) => onPatch(node.id, patch)}
            onMove={(x, y) => onMove(node.id, x, y)}
            onRemove={() => onRemove(node.id)}
            onRun={() => onRun(node.id)}
            onToggleLock={() => onToggleLock(node.id)}
          />
        ))}
      </div>
    </div>
  );
}
