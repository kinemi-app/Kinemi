"use client";

import { defaultModelForMode, findModel, MODES } from "../../../lib/models";
import type { Mode } from "../../../lib/types";
import { cx } from "../../ui";
import type { CanvasBoard, CanvasNode } from "./board";
import { nodeModels } from "./board";
import { useNodeDrag } from "./useNodeDrag";
import flowStyles from "../flow.module.css";
import styles from "./canvas.module.css";

export type NodeCardProps = {
  node: CanvasNode;
  board: CanvasBoard;
  selected: boolean;
  selfId: string;
  running: boolean;
  onSelect: () => void;
  onPatch: (patch: Partial<CanvasNode>) => void;
  onMove: (x: number, y: number) => void;
  onRemove: () => void;
  onRun: () => void;
  onToggleLock: () => void;
};

type FieldProps = {
  node: CanvasNode;
  disabled: boolean;
  onPatch: (patch: Partial<CanvasNode>) => void;
};

const PROMPT_MAX = 2000;

function statusClass(status: CanvasNode["status"]): string | undefined {
  switch (status) {
    case "running":
      return styles.statusRunning;
    case "succeeded":
      return styles.statusSucceeded;
    case "failed":
      return styles.statusFailed;
    case "idle":
      return undefined;
  }
}

function ModeInputFields({ node, board, disabled, onPatch }: FieldProps & { board: CanvasBoard }) {
  const inputs = board.nodes.filter((other) => other.id !== node.id);

  function takeMode(value: string) {
    const mode = value as Mode;
    const next = defaultModelForMode(mode);
    onPatch({
      mode,
      modelId: next.id,
      durationS: Math.min(node.durationS, next.maxDurationS),
    });
  }

  return (
    <div className={styles.nodeRow}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Mode</span>
        <select
          className={styles.select}
          value={node.mode}
          aria-label={`Mode for ${node.title}`}
          disabled={disabled}
          onChange={(event) => takeMode(event.target.value)}
        >
          {MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Input</span>
        <select
          className={styles.select}
          value={node.inputId ?? ""}
          aria-label={`Input step for ${node.title}`}
          disabled={disabled}
          onChange={(event) =>
            onPatch({ inputId: event.target.value === "" ? undefined : event.target.value })
          }
        >
          <option value="">Start</option>
          {inputs.map((other) => (
            <option key={other.id} value={other.id}>
              {other.title}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ModelField({ node, disabled, onPatch }: FieldProps) {
  const model = findModel(node.modelId) ?? defaultModelForMode(node.mode);

  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>Model</span>
      <select
        className={styles.select}
        value={model.id}
        aria-label={`Model for ${node.title}`}
        disabled={disabled}
        onChange={(event) => {
          const next = findModel(event.target.value);
          onPatch({
            modelId: event.target.value,
            durationS: next ? Math.min(node.durationS, next.maxDurationS) : node.durationS,
          });
        }}
      >
        {nodeModels(node).map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} · {option.maxDurationS}s · {option.creditsPerSecond.toFixed(2)} credits/s
          </option>
        ))}
      </select>
    </label>
  );
}

function LengthField({ node, disabled, onPatch }: FieldProps) {
  const model = findModel(node.modelId) ?? defaultModelForMode(node.mode);

  return (
    <div className={styles.nodeRow}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Length</span>
        <input
          className={styles.number}
          type="number"
          min={1}
          max={model.maxDurationS}
          value={node.durationS}
          aria-label={`Duration for ${node.title}`}
          disabled={disabled}
          onChange={(event) =>
            onPatch({
              durationS: Math.min(
                model.maxDurationS,
                Math.max(1, Math.round(Number(event.target.value) || 1)),
              ),
            })
          }
        />
      </label>
      <span className={styles.hint}>
        {model.maxDurationS}s max on {model.name}
      </span>
    </div>
  );
}

function NodeSettings({ node, board, disabled, onPatch }: FieldProps & { board: CanvasBoard }) {
  return (
    <>
      <ModeInputFields node={node} board={board} disabled={disabled} onPatch={onPatch} />
      <ModelField node={node} disabled={disabled} onPatch={onPatch} />
      <LengthField node={node} disabled={disabled} onPatch={onPatch} />
    </>
  );
}

function NodeResult({ node }: { node: CanvasNode }) {
  if (node.error) {
    return <p className={flowStyles.error}>{node.error}</p>;
  }
  if (!node.resultUrl) {
    return null;
  }
  if (node.resultKind === "audio") {
    return (
      <audio className={styles.resultAudio} src={node.resultUrl} controls aria-label="Step result" />
    );
  }
  if (node.resultKind === "video") {
    return <video className={styles.result} src={node.resultUrl} controls muted playsInline />;
  }
  return <img className={styles.result} src={node.resultUrl} alt={`Result from ${node.title}`} />;
}

function NodeHeader({
  node,
  lockedByOther,
  drag,
  onPatch,
}: {
  node: CanvasNode;
  lockedByOther: boolean;
  drag: ReturnType<typeof useNodeDrag>;
  onPatch: (patch: Partial<CanvasNode>) => void;
}) {
  return (
    <header className={styles.nodeHead}>
      <button
        type="button"
        className={styles.drag}
        aria-label={`Move ${node.title}`}
        disabled={lockedByOther}
        onPointerDown={drag.start}
        onPointerMove={drag.move}
        onPointerUp={drag.end}
        onPointerCancel={drag.end}
      >
        ⠿
      </button>
      <input
        className={styles.nodeTitle}
        value={node.title}
        aria-label={`Title for ${node.title}`}
        disabled={lockedByOther}
        onChange={(event) => onPatch({ title: event.target.value })}
      />
      <span className={cx(styles.status, statusClass(node.status))}>{node.status}</span>
    </header>
  );
}

function NodeActions({
  node,
  running,
  lockedByOther,
  onRun,
  onToggleLock,
  onRemove,
}: {
  node: CanvasNode;
  running: boolean;
  lockedByOther: boolean;
  onRun: () => void;
  onToggleLock: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={styles.nodeActions}>
      <button
        type="button"
        className={styles.nodeButton}
        onClick={onRun}
        disabled={running || node.prompt.trim() === ""}
        title={node.prompt.trim() === "" ? "Add a prompt first" : undefined}
      >
        Run step
      </button>
      <button
        type="button"
        className={styles.nodeButton}
        onClick={onToggleLock}
        disabled={lockedByOther}
      >
        {node.lock ? "Unlock" : "Lock"}
      </button>
      <button
        type="button"
        className={styles.nodeButton}
        onClick={onRemove}
        disabled={lockedByOther || node.status === "running"}
      >
        Remove
      </button>
      {node.lock ? <span className={styles.lockName}>Locked by {node.lock.name}</span> : null}
    </div>
  );
}

/** One board step: a small editor, a lock and its own result. */
export function NodeCard({
  node,
  board,
  selected,
  selfId,
  running,
  onSelect,
  onPatch,
  onMove,
  onRemove,
  onRun,
  onToggleLock,
}: NodeCardProps) {
  const drag = useNodeDrag(node.x, node.y, onSelect, onMove);
  const lockedByOther = node.lock !== undefined && node.lock.id !== selfId;

  return (
    <article
      className={cx(styles.node, selected && styles.nodeSelected)}
      style={{ left: node.x, top: node.y }}
      onFocusCapture={onSelect}
      aria-label={`${node.title} step`}
    >
      <NodeHeader node={node} lockedByOther={lockedByOther} drag={drag} onPatch={onPatch} />
      <div className={styles.nodeBody}>
        <NodeSettings node={node} board={board} disabled={lockedByOther} onPatch={onPatch} />
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Prompt</span>
          <textarea
            className={styles.prompt}
            rows={3}
            maxLength={PROMPT_MAX}
            value={node.prompt}
            placeholder="What does this step make?"
            aria-label={`Prompt for ${node.title}`}
            disabled={lockedByOther}
            onChange={(event) => onPatch({ prompt: event.target.value })}
          />
        </label>
        <NodeActions
          node={node}
          running={running}
          lockedByOther={lockedByOther}
          onRun={onRun}
          onToggleLock={onToggleLock}
          onRemove={onRemove}
        />
        <NodeResult node={node} />
      </div>
    </article>
  );
}
