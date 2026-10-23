"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { CameraMove } from "../../../lib/types";
import { cameraFamilies } from "../../../lib/presets/load";
import { Button, Chip, EmptyState, Field } from "../../ui";
import flowStyles from "../flow.module.css";
import styles from "./presets.module.css";

/** How long "Copied" stays on the button before it returns to "Copy". */
const COPIED_MS = 1500;

/** Family filter value that keeps every move. */
const ALL_FAMILIES = "All";

type CopyState = "idle" | "copied" | "failed";

/** Small deterministic hash so each move's poster motion is stable across renders. */
function hashMove(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/** Subtle per-move poster motion, derived from the move id. */
function moveVars(move: CameraMove): CSSProperties {
  const hash = hashMove(move.id);
  const vars = {
    "--px": `${(hash % 21) - 10}%`,
    "--py": `${((hash >>> 4) % 17) - 8}%`,
    "--ps": (1.04 + ((hash >>> 8) % 9) * 0.01).toFixed(2),
    "--pr": `${((hash >>> 12) % 9) - 4}deg`,
  };
  return vars as CSSProperties;
}

/** Keep a move when it matches the family filter and the lowercase search text. */
function matchesFilters(move: CameraMove, needle: string, family: string): boolean {
  if (family !== ALL_FAMILIES && move.family !== family) {
    return false;
  }
  if (needle === "") {
    return true;
  }
  return (
    move.name.toLowerCase().includes(needle) ||
    move.family.toLowerCase().includes(needle) ||
    move.prompt.toLowerCase().includes(needle)
  );
}

function PresetCard({ move }: { move: CameraMove }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(move.prompt);
    } catch {
      setCopyState("failed");
      return;
    }
    setCopyState("copied");
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => setCopyState("idle"), COPIED_MS);
  }

  const copyLabel = {
    idle: "Copy",
    copied: "Copied",
    failed: "Copy failed",
  }[copyState];

  return (
    <article className={styles.card} style={moveVars(move)}>
      <div className={styles.poster} aria-hidden="true">
        <div className={styles.posterMark} />
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardTop}>
          <h2 className={styles.cardTitle}>{move.name}</h2>
          <Chip>{move.family}</Chip>
        </div>
        <p className={styles.prompt}>{move.prompt}</p>
        <div className={styles.cardActions}>
          <Button variant="quiet" onClick={copyPrompt}>
            {copyLabel}
          </Button>
        </div>
      </div>
    </article>
  );
}

export function PresetGallery({ moves }: { moves: CameraMove[] }) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string>(ALL_FAMILIES);
  const searchId = useId();
  const families = cameraFamilies();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return moves.filter((move) => matchesFilters(move, needle, family));
  }, [moves, query, family]);

  function clearFilters() {
    setQuery("");
    setFamily(ALL_FAMILIES);
  }

  return (
    <main className={flowStyles.page}>
      <header className={flowStyles.head}>
        <span className={flowStyles.kicker}>Move library</span>
        <h1>Presets</h1>
        <p className={flowStyles.lead}>
          Every camera move, written as the prompt fragment it is. Search, filter by family, and copy
          one into any shot.
        </p>
      </header>

      <div className={styles.toolbar}>
        <Field label="Search" hint="Name, family or prompt" htmlFor={searchId}>
          <input
            id={searchId}
            className={styles.search}
            type="search"
            value={query}
            placeholder="Search moves"
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <div className={styles.chips} role="group" aria-label="Filter by family">
          <Chip active={family === ALL_FAMILIES} onClick={() => setFamily(ALL_FAMILIES)}>
            All
          </Chip>
          {families.map((name) => (
            <Chip key={name} active={family === name} onClick={() => setFamily(name)}>
              {name}
            </Chip>
          ))}
        </div>
        <p className={styles.count} aria-live="polite">
          {visible.length} of {moves.length} moves
        </p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No moves match"
          body="Try a different search, or clear the filters to see the whole library again."
          action={
            <Button variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className={styles.grid}>
          {visible.map((move) => (
            <PresetCard key={move.id} move={move} />
          ))}
        </div>
      )}
    </main>
  );
}
