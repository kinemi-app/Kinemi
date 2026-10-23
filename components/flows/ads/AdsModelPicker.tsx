"use client";

import { estimateCredits, formatCredits } from "../../../lib/cost";
import { modelsForMode } from "../../../lib/models";
import type { ModelKind } from "../../../lib/types";
import { cx } from "../../ui";
import flowStyles from "../flow.module.css";

export type AdsModelPickerProps = {
  kind: ModelKind;
  durationS: number;
  value: string;
  onChange: (modelId: string) => void;
};

/**
 * The ads models of one kind: the still panels list image models, the video panel lists clip
 * models. The registry serves both for the mode, so each picker filters instead of offering a
 * model whose result would be the wrong kind.
 */
export function AdsModelPicker({ kind, durationS, value, onChange }: AdsModelPickerProps) {
  const options = modelsForMode("ads").filter((model) => model.kind === kind);
  const selected = options.find((model) => model.id === value) ?? options[0];

  if (!selected) {
    return <p className={flowStyles.error}>No {kind} model in the registry serves ads.</p>;
  }

  const seconds = Math.min(durationS, selected.maxDurationS);

  return (
    <div className={flowStyles.models} role="listbox" aria-label={`${kind} model`}>
      {options.map((model) => {
        const active = model.id === selected.id;
        return (
          <button
            key={model.id}
            type="button"
            role="option"
            aria-selected={active}
            onClick={() => onChange(model.id)}
            className={cx(flowStyles.model, active && flowStyles.modelOn)}
          >
            <span className={flowStyles.modelTop}>
              <span>{model.name}</span>
              <span className={flowStyles.openFlag}>{model.open ? "open" : "closed"}</span>
            </span>
            <span className={flowStyles.modelMeta}>
              {model.vendor} · {model.creditsPerSecond.toFixed(2)} credits/s · up to{" "}
              {model.maxDurationS}s
            </span>
          </button>
        );
      })}

      <p className={flowStyles.costRow}>
        <span>Estimated run</span>
        <span className={flowStyles.costValue}>
          {formatCredits(estimateCredits(selected, seconds))} · {seconds}s
        </span>
      </p>
    </div>
  );
}
