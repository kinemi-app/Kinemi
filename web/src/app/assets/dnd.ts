// Drag assets onto folders, tags, favourites or the trash.
import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';

export const DRAG_TYPE = 'application/x-kinemi-assets';
/** The ids being dragged right now, so drop targets can light up. */
export const dragging = signal<string[] | null>(null);

export function startDrag(e: DragEvent, ids: string[], label: string) {
  const dt = e.dataTransfer;
  if (!dt) return;
  dt.setData(DRAG_TYPE, JSON.stringify(ids));
  dt.setData('text/plain', label);
  dt.effectAllowed = 'move';
  // a small pixel badge as the drag image
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = ids.length > 1 ? `${ids.length} assets` : label;
  document.body.appendChild(ghost);
  dt.setDragImage(ghost, 16, 16);
  setTimeout(() => ghost.remove());
  dragging.value = ids;
}

export const endDrag = () => (dragging.value = null);

export function useDrop(onDrop: (ids: string[]) => void) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => !!e.dataTransfer?.types.includes(DRAG_TYPE);
  return {
    over,
    props: {
      onDragEnter: (e: DragEvent) => {
        if (accepts(e)) {
          e.preventDefault();
          setOver(true);
        }
      },
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
        if (!over) setOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        if (!(e.currentTarget as Element).contains(e.relatedTarget as Node)) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        setOver(false);
        dragging.value = null;
        try {
          const ids = JSON.parse(e.dataTransfer!.getData(DRAG_TYPE)) as string[];
          if (ids.length) onDrop(ids);
        } catch {
          /* not ours */
        }
      },
    },
  };
}
