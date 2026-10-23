"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Button, cx } from "../ui";
import styles from "./flow.module.css";

export type ReferenceItem = {
  id: string;
  name: string;
  url: string;
  weight: number;
};

export type ReferenceTrayProps = {
  max: number;
  items: ReferenceItem[];
  onChange: (items: ReferenceItem[]) => void;
  label?: string;
  hint?: string;
};

type ReorderHandlers = {
  startDrag: (index: number, event: DragEvent<HTMLDivElement>) => void;
  dragOver: (index: number, event: DragEvent<HTMLDivElement>) => void;
  drop: (index: number, event: DragEvent<HTMLDivElement>) => void;
  endDrag: () => void;
};

/**
 * Reorder state for one tray. The dragged index lives in a ref so the drop handler reads the
 * gesture's source even when React has not rendered the dragover state yet.
 */
function useReorder(items: ReferenceItem[], onChange: (items: ReferenceItem[]) => void) {
  const dragIndexRef = useRef<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  /** The only reorder path: a fresh list with the item at `from` reinserted at `to`. */
  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
      return;
    }
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (!moved) {
      return;
    }
    next.splice(to, 0, moved);
    onChange(next);
  }

  function startDrag(index: number, event: DragEvent<HTMLDivElement>) {
    dragIndexRef.current = index;
    event.dataTransfer.effectAllowed = "move";
    // Firefox starts no drag without a payload; the index itself keeps the payload harmless.
    event.dataTransfer.setData("text/plain", String(index));
  }

  function dragOver(index: number, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndex(index);
  }

  function drop(index: number, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const from = dragIndexRef.current;
    if (from !== null) {
      move(from, index);
    }
    dragIndexRef.current = null;
    setDropIndex(null);
  }

  function endDrag() {
    dragIndexRef.current = null;
    setDropIndex(null);
  }

  return { dropIndex, move, startDrag, dragOver, drop, endDrag };
}

type ReferenceCardProps = {
  item: ReferenceItem;
  index: number;
  isLast: boolean;
  isDropTarget: boolean;
  move: (from: number, to: number) => void;
  reorder: ReorderHandlers;
  onRemove: (id: string) => void;
  onWeight: (id: string, weight: number) => void;
};

/** One reference: preview, remove, the two move buttons and the weight slider. */
function ReferenceCard({
  item,
  index,
  isLast,
  isDropTarget,
  move,
  reorder,
  onRemove,
  onWeight,
}: ReferenceCardProps) {
  return (
    <div
      className={cx(styles.ref, isDropTarget && styles.refDrop)}
      draggable
      onDragStart={(event) => reorder.startDrag(index, event)}
      onDragOver={(event) => reorder.dragOver(index, event)}
      onDrop={(event) => reorder.drop(index, event)}
      onDragEnd={reorder.endDrag}
    >
      <img className={styles.refImage} src={item.url} alt={item.name} />
      <button
        type="button"
        className={styles.refRemove}
        onClick={() => onRemove(item.id)}
        aria-label={`Remove ${item.name}`}
      >
        ×
      </button>
      <div className={styles.refMoves}>
        <button
          type="button"
          className={styles.refMove}
          onClick={() => move(index, index - 1)}
          disabled={index === 0}
          aria-label={`Move ${item.name} earlier`}
        >
          Earlier
        </button>
        <button
          type="button"
          className={styles.refMove}
          onClick={() => move(index, index + 1)}
          disabled={isLast}
          aria-label={`Move ${item.name} later`}
        >
          Later
        </button>
      </div>
      <input
        className={styles.refWeight}
        type="range"
        min={0}
        max={2}
        step={0.1}
        value={item.weight}
        aria-label={`Weight for ${item.name}`}
        onChange={(event) => onWeight(item.id, Number(event.target.value))}
      />
      <span className={styles.refMeta}>
        <span>{item.weight.toFixed(1)}</span>
        <span>{item.name}</span>
      </span>
    </div>
  );
}

/**
 * Capped image references with a preview and a weight each, reorderable by button or by drag.
 * Object URLs are revoked on remove and on unmount; the parent only holds the list.
 */
export function ReferenceTray({
  max,
  items,
  onChange,
  label = "References",
  hint,
}: ReferenceTrayProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const { dropIndex, move, startDrag, dragOver, drop, endDrag } = useReorder(items, onChange);

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        URL.revokeObjectURL(item.url);
      }
    };
  }, []);

  function add(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }
    const room = max - items.length;
    if (room <= 0) {
      return;
    }

    const next: ReferenceItem[] = [];
    for (const file of Array.from(files).slice(0, room)) {
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        url: URL.createObjectURL(file),
        weight: 1,
      });
    }
    onChange([...items, ...next]);
  }

  function remove(id: string) {
    const item = items.find((entry) => entry.id === id);
    if (item) {
      URL.revokeObjectURL(item.url);
    }
    onChange(items.filter((entry) => entry.id !== id));
  }

  function setWeight(id: string, weight: number) {
    onChange(items.map((entry) => (entry.id === id ? { ...entry, weight } : entry)));
  }

  return (
    <div className={styles.refs}>
      <div className={styles.refHead}>
        <span className={styles.refLabel}>{label}</span>
        <span className={styles.refCount}>
          {items.length} / {max}
        </span>
      </div>
      {hint ? <p className={styles.refHint}>{hint}</p> : null}

      {items.length > 0 ? (
        <div className={styles.refGrid}>
          {items.map((item, index) => (
            <ReferenceCard
              key={item.id}
              item={item}
              index={index}
              isLast={index === items.length - 1}
              isDropTarget={dropIndex === index}
              move={move}
              reorder={{ startDrag, dragOver, drop, endDrag }}
              onRemove={remove}
              onWeight={setWeight}
            />
          ))}
        </div>
      ) : null}

      <Button
        variant="ghost"
        onClick={() => inputRef.current?.click()}
        disabled={items.length >= max}
      >
        {items.length >= max ? `Limit ${max} reached` : "Add references"}
      </Button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          add(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
