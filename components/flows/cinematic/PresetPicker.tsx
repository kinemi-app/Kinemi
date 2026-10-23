"use client";

import { useId, useState } from "react";
import type { CameraMove } from "../../../lib/types";
import { Chip, Field, cx } from "../../ui";
import styles from "./cinematic.module.css";

const MAX_MOVES = 3;
const ALL_FAMILIES = "All";

export type PresetPickerProps = {
  moves: CameraMove[];
  selected: string[];
  onChange: (ids: string[]) => void;
};

/** Families in the order the move file lists them, so the filter is stable. */
function familiesOf(moves: CameraMove[]): string[] {
  const families: string[] = [];
  for (const move of moves) {
    if (!families.includes(move.family)) {
      families.push(move.family);
    }
  }
  return families;
}

/**
 * The move library: search, filter by family, and stack at most three moves in click order.
 * The stack below the grid is the one place a move can be removed from.
 */
export function PresetPicker({ moves, selected, onChange }: PresetPickerProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState(ALL_FAMILIES);
  const [notice, setNotice] = useState("");

  const families = familiesOf(moves);
  const needle = query.trim().toLowerCase();
  const visible = moves.filter((move) => {
    const inFamily = family === ALL_FAMILIES || move.family === family;
    const searchable = `${move.name} ${move.family} ${move.prompt}`.toLowerCase();
    return inFamily && (needle === "" || searchable.includes(needle));
  });

  const selectedMoves = selected
    .map((id) => moves.find((move) => move.id === id))
    .filter((move): move is CameraMove => move !== undefined);

  function toggle(move: CameraMove) {
    if (selected.includes(move.id)) {
      setNotice("");
      onChange(selected.filter((id) => id !== move.id));
      return;
    }
    if (selected.length >= MAX_MOVES) {
      setNotice("Three moves at most");
      return;
    }
    setNotice("");
    onChange([...selected, move.id]);
  }

  function remove(id: string) {
    setNotice("");
    onChange(selected.filter((entry) => entry !== id));
  }

  return (
    <div className={styles.picker}>
      <Field
        label="Search moves"
        htmlFor={searchId}
        hint="Matches the name, the family or the prompt the move writes."
      >
        <input
          id={searchId}
          className={styles.search}
          type="search"
          value={query}
          placeholder="orbit, crane, handheld…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>

      <div className={styles.families} role="group" aria-label="Camera move family">
        {[ALL_FAMILIES, ...families].map((name) => (
          <Chip key={name} active={family === name} onClick={() => setFamily(name)}>
            {name}
          </Chip>
        ))}
      </div>

      <div className={styles.moveGrid}>
        {visible.map((move) => {
          const order = selected.indexOf(move.id);
          return (
            <button
              key={move.id}
              type="button"
              aria-pressed={order >= 0}
              onClick={() => toggle(move)}
              className={cx(styles.move, order >= 0 && styles.moveOn)}
            >
              <span className={styles.moveHead}>
                <span className={styles.moveName}>{move.name}</span>
                {order >= 0 ? <span className={styles.orderBadge}>{order + 1}</span> : null}
              </span>
              <span className={styles.moveFamily}>{move.family}</span>
              <span className={styles.movePrompt}>{move.prompt}</span>
            </button>
          );
        })}
        {visible.length === 0 ? (
          <p className={styles.empty}>No move matches that search.</p>
        ) : null}
      </div>

      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      <div className={styles.stackHead}>
        <span className={styles.stackLabel}>Stacked moves</span>
        <span className={styles.stackCount}>
          {selectedMoves.length} / {MAX_MOVES}
        </span>
      </div>

      {selectedMoves.length > 0 ? (
        <ol className={styles.stack}>
          {selectedMoves.map((move, index) => (
            <li key={move.id} className={styles.stackRow}>
              <span className={styles.stackIndex}>{index + 1}</span>
              <span className={styles.stackName}>{move.name}</span>
              <button
                type="button"
                className={styles.remove}
                onClick={() => remove(move.id)}
                aria-label={`Remove ${move.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.pickerHint}>Pick up to three; the moves play in click order.</p>
      )}
    </div>
  );
}
