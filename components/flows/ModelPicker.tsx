"use client";

import { estimateCredits, formatCredits } from "../../lib/cost";
import { modelsForMode } from "../../lib/models";
import type { Mode } from "../../lib/types";
import { cx } from "../ui";
import styles from "./flow.module.css";

export type ModelPickerProps = {
  mode: Mode;
  value: string;
  durationS: number;
  onChange: (modelId: string) => void;
};

/**
 * The model list for one mode, with the real limit and the price of this run.
 * Every flow shows this before its generate button, so cost is never a surprise.
 */
export function ModelPicker({ mode, value, durationS, onChange }: ModelPickerProps) {
  const options = modelsForMode(mode);
  const selected = options.find((model) => model.id === value) ?? options[0];

  if (!selected) {
    return <p className={styles.error}>No model in the registry serves {mode}.</p>;
  }

  const seconds = Math.min(durationS, selected.maxDurationS);

  return (
    <div className={styles.models} role="listbox" aria-label="Model">
      {options.map((model) => {
        const active = model.id === selected.id;
        return (
          <button
            key={model.id}
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => onChange(model.id)}
            className={cx(styles.model, active && styles.modelOn)}
          >
            <span className={styles.modelTop}>
              <span>{model.name}</span>
              <span className={styles.openFlag}>{model.open ? "open" : "closed"}</span>
            </span>
            <span className={styles.modelMeta}>
              {model.vendor} · {model.creditsPerSecond.toFixed(2)} credits/s · up to{" "}
              {model.maxDurationS}s
            </span>
          </button>
        );
      })}

      <p className={styles.costRow}>
        <span>Estimated run</span>
        <span className={styles.costValue}>
          {formatCredits(estimateCredits(selected, seconds))} · {seconds}s
        </span>
      </p>
    </div>
  );
}
