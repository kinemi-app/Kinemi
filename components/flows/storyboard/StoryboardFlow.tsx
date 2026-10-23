"use client";

import { useCallback, useId, useState } from "react";
import { estimateCredits, formatCredits } from "../../../lib/cost";
import { defaultModelForMode, findModel } from "../../../lib/models";
import { MAX_SHOTS, newShot } from "../../../lib/storyboard";
import type { ShotStatus } from "../../../lib/storyboard";
import { Button, EmptyState, Field, Panel, Progress, Slider, TextArea, cx } from "../../ui";
import { ModelPicker } from "../index";
import flowStyles from "../flow.module.css";
import styles from "./storyboard.module.css";
import { useShotQueue, type QueuedShot, type ShotPatch } from "./useShotQueue";

/** The storyboard renders cinematic shots, so its model list is the cinematic one. */
const STORYBOARD_MODE = "cinematic";

/** Seconds a fresh shot asks for; the row clamps it down if a smaller model is picked. */
const INITIAL_DURATION_S = 5;

const MIN_DURATION_S = 1;

/** The largest value a 32-bit noise field holds, so every graph can read the seed as given. */
const MAX_SEED = 4_294_967_295;

const STATUS_LABELS: Record<ShotStatus, string> = {
  idle: "Waiting",
  running: "Rendering",
  succeeded: "Done",
  failed: "Failed",
};

function createShot(seed: number): QueuedShot {
  return { ...newShot(defaultModelForMode(STORYBOARD_MODE).id, INITIAL_DURATION_S), seed };
}

/** The next unused seed on the board, so two shots never share one by accident. */
function nextSeed(shots: QueuedShot[]): number {
  const highest = shots.reduce((max, shot) => Math.max(max, shot.seed), 0);
  return Math.min(MAX_SEED, highest + 1);
}

/** A seed from the number field; a cleared or out-of-range entry becomes the nearest valid value. */
function readSeed(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(MAX_SEED, Math.max(0, parsed));
}

function randomSeed(): number {
  return Math.floor(Math.random() * (MAX_SEED + 1));
}

/** A shot's model, falling back to the registry default if its id ever leaves the picker. */
function modelFor(modelId: string) {
  return findModel(modelId) ?? defaultModelForMode(STORYBOARD_MODE);
}

/** The length a shot actually renders: its own request, never above its model's cap. */
function durationOf(shot: QueuedShot): number {
  return Math.min(shot.durationS, modelFor(shot.modelId).maxDurationS);
}

function costOf(shot: QueuedShot): number {
  return estimateCredits(modelFor(shot.modelId), durationOf(shot));
}

function statusClass(status: ShotStatus): string | undefined {
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

type ShotCardProps = {
  index: number;
  shot: QueuedShot;
  onUpdate: (id: string, patch: ShotPatch) => void;
  onRemove: (id: string) => void;
};

/** One row of the shot list: its prompt and controls above its own render state. */
function ShotCard({ index, shot, onUpdate, onRemove }: ShotCardProps) {
  const model = modelFor(shot.modelId);
  const durationS = durationOf(shot);
  const seedId = useId();

  function changeModel(modelId: string) {
    const next = modelFor(modelId);
    onUpdate(shot.id, { modelId, durationS: Math.min(durationS, next.maxDurationS) });
  }

  function changeDuration(next: number) {
    onUpdate(shot.id, { durationS: Math.min(next, model.maxDurationS) });
  }

  return (
    <Panel
      title={`Shot ${index + 1}`}
      subtitle={`${model.name} · ${durationS}s`}
      right={
        <>
          <span className={cx(styles.status, statusClass(shot.status))} data-status={shot.status}>
            {STATUS_LABELS[shot.status]}
          </span>
          <Button variant="quiet" onClick={() => onRemove(shot.id)}>
            Remove
          </Button>
        </>
      }
    >
      <div className={styles.shotBody}>
        <TextArea
          label="Prompt"
          value={shot.prompt}
          onChange={(prompt) => onUpdate(shot.id, { prompt })}
          placeholder="Describe this shot"
          rows={4}
        />
        <div className={styles.shotControls}>
          <ModelPicker
            mode={STORYBOARD_MODE}
            value={shot.modelId}
            durationS={durationS}
            onChange={changeModel}
          />
          <Slider
            label="Duration"
            value={durationS}
            min={MIN_DURATION_S}
            max={model.maxDurationS}
            step={1}
            unit="s"
            onChange={changeDuration}
          />
          <Field label="Seed" hint="Every shot submits its own seed." htmlFor={seedId}>
            <div className={styles.seedRow}>
              <input
                id={seedId}
                className={styles.input}
                type="number"
                min={0}
                max={MAX_SEED}
                step={1}
                value={shot.seed}
                onChange={(event) => onUpdate(shot.id, { seed: readSeed(event.target.value) })}
              />
              <Button variant="quiet" onClick={() => onUpdate(shot.id, { seed: randomSeed() })}>
                Shuffle
              </Button>
            </div>
          </Field>
          <p className={flowStyles.costRow}>
            <span>Estimate</span>
            <span className={flowStyles.costValue}>{formatCredits(costOf(shot))}</span>
          </p>
        </div>
        <ShotOutcome index={index} shot={shot} />
      </div>
    </Panel>
  );
}

type ShotOutcomeProps = {
  index: number;
  shot: QueuedShot;
};

/** A shot's render state: progress while it runs, its result or link when done, its error when not. */
function ShotOutcome({ index, shot }: ShotOutcomeProps) {
  if (shot.status === "idle") {
    return null;
  }

  return (
    <div className={styles.outcome}>
      {shot.status === "running" ? (
        <Progress value={shot.progress ?? 0} label={`Rendering shot ${index + 1}`} />
      ) : null}
      {shot.status === "succeeded" && shot.resultUrl ? (
        <>
          <img className={styles.result} src={shot.resultUrl} alt={`Shot ${index + 1} result`} />
          <a className={styles.resultLink} href={shot.resultUrl} target="_blank" rel="noreferrer">
            Open result
          </a>
        </>
      ) : null}
      {shot.status === "failed" ? (
        <p className={flowStyles.error}>{shot.error ?? "The shot failed."}</p>
      ) : null}
    </div>
  );
}

type BoardSummaryProps = {
  shotCount: number;
  readyCount: number;
  totalCredits: number;
  running: boolean;
  canRun: boolean;
  onAdd: () => void;
  onCancel: () => void;
  onRun: () => void;
};

/** The board's total above the list, with the controls that act on the whole list. */
function BoardSummary({
  shotCount,
  readyCount,
  totalCredits,
  running,
  canRun,
  onAdd,
  onCancel,
  onRun,
}: BoardSummaryProps) {
  const atCap = shotCount >= MAX_SHOTS;

  return (
    <section className={styles.summary} aria-label="Board estimate">
      <div className={styles.total}>
        <span className={styles.totalLabel}>Board estimate</span>
        <span className={styles.totalValue}>{formatCredits(totalCredits)}</span>
        <span className={styles.totalHint}>
          {readyCount} of {shotCount} ready
        </span>
      </div>
      <div className={styles.actions}>
        <Button
          variant="ghost"
          onClick={onAdd}
          disabled={atCap}
          title={atCap ? `A board holds ${MAX_SHOTS} shots` : undefined}
        >
          Add shot
        </Button>
        {running ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          onClick={onRun}
          disabled={!canRun}
          loading={running}
          title={
            running
              ? "A run is in progress"
              : canRun
                ? undefined
                : "Write a prompt on at least one shot"
          }
        >
          Run all
        </Button>
      </div>
    </section>
  );
}

export function StoryboardFlow() {
  const [shots, setShots] = useState<QueuedShot[]>(() => [createShot(1)]);

  const updateShot = useCallback((id: string, patch: ShotPatch) => {
    setShots((current) => current.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)));
  }, []);

  const { run, cancel, running } = useShotQueue(updateShot);

  const readyShots = shots.filter((shot) => shot.prompt.trim() !== "");
  const totalCredits = readyShots.reduce((sum, shot) => sum + costOf(shot), 0);
  const canRun = !running && readyShots.length > 0;

  function addShot() {
    setShots((current) =>
      current.length >= MAX_SHOTS ? current : [...current, createShot(nextSeed(current))],
    );
  }

  function removeShot(id: string) {
    setShots((current) => current.filter((shot) => shot.id !== id));
  }

  function runAll() {
    run(shots);
  }

  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}>
        <span className={flowStyles.kicker}>Shot list</span>
        <h1>Storyboard</h1>
        <p className={flowStyles.lead}>
          Queue up to eight shots and render them in order, one at a time. Every shot keeps its
          own prompt, model and duration, so the list reads like a scene before anything is
          generated.
        </p>
      </header>

      <div className={styles.board}>
        <BoardSummary
          shotCount={shots.length}
          readyCount={readyShots.length}
          totalCredits={totalCredits}
          running={running}
          canRun={canRun}
          onAdd={addShot}
          onCancel={cancel}
          onRun={runAll}
        />

        {shots.length === 0 ? (
          <EmptyState
            title="No shots on the board"
            body="Add a shot to start the list; every shot keeps its own prompt, model and duration."
          />
        ) : (
          <div className={styles.shots}>
            {shots.map((shot, index) => (
              <ShotCard
                key={shot.id}
                index={index}
                shot={shot}
                onUpdate={updateShot}
                onRemove={removeShot}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
