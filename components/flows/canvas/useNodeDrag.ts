"use client";

import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type DragOrigin = { pointerX: number; pointerY: number; nodeX: number; nodeY: number };

/** Drag a board card by its handle; the card position is owned by the parent. */
export function useNodeDrag(
  x: number,
  y: number,
  onSelect: () => void,
  onMove: (x: number, y: number) => void,
) {
  const drag = useRef<DragOrigin | undefined>(undefined);

  function start(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    onSelect();
    drag.current = { pointerX: event.clientX, pointerY: event.clientY, nodeX: x, nodeY: y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const origin = drag.current;
    if (!origin) return;
    onMove(
      Math.max(0, origin.nodeX + event.clientX - origin.pointerX),
      Math.max(0, origin.nodeY + event.clientY - origin.pointerY),
    );
  }

  function end() {
    drag.current = undefined;
  }

  return { start, move, end };
}
