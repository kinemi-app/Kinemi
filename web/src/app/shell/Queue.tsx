// The render queue popover: what is rendering, what is waiting, what just landed.
import { useEffect, useRef } from 'preact/hooks';
import { toolById } from '../data/tools';
import { formatRuntime } from '../data/models';
import { cx } from '../lib/util';
import { cancelJob, clearFinished, rendersStarted } from '../render';
import { clock, liveLine } from '../render-live';
import { go } from '../router';
import { renderTarget } from '../compute';
import { assetById, jobs, openAssetId } from '../store';
import { PxIcon, ToolIcon } from '../ui/icons';
import { Model3D } from '../ui/Model3D';
import { Poster } from '../ui/Poster';
import { PixelProgress } from '../ui/PixelProgress';

export function QueuePanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.queue-wrap')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const list = [...jobs.value].reverse();
  const waiting = list.filter((j) => j.status === 'queued').length;

  return (
    <div ref={ref} class="queue-panel" role="dialog" aria-label="Render queue" tabIndex={-1}>
      <header class="queue-head">
        <Model3D model="clapper" opts={{ clap: rendersStarted.value }} class="queue-clapper">
          <PxIcon name="queue" size={28} />
        </Model3D>
        <div>
          <h2>Render queue</h2>
          <p class="mono">
            {list.length ? `${list.filter((j) => j.status === 'rendering').length} rendering · ${waiting} waiting` : 'Nothing rendering'}
          </p>
        </div>
      </header>
      {list.length === 0 ? (
        <p class="queue-empty">Press Render in the chat or on any tool. Jobs line up here, one at a time, with their runtime and credits.</p>
      ) : (
        <ul class="queue-list">
          {list.map((j) => {
            const a = j.assetIds?.[0] ? assetById(j.assetIds[0]) : undefined;
            return (
              <li key={j.id} class={cx('queue-item', `is-${j.status}`)}>
                <span class="queue-thumb">
                  {a ? <Poster asset={a} density={30} /> : <ToolIcon id={j.spec.tool} size={22} />}
                </span>
                <span class="queue-info">
                  <b>{j.spec.name}</b>
                  <span class="mono">
                    {toolById(j.spec.tool).name} ·{' '}
                    {j.status === 'rendering'
                      ? liveLine(j, `${Math.round(j.progress * 100)}%`, clock.value)
                      : j.status === 'queued'
                        ? `queued · ${formatRuntime(j.spec.estimate.runtime)}`
                        : j.status === 'done'
                          ? liveLine(j, 'done', clock.value)
                          : j.status}
                  </span>
                  {j.status === 'rendering' && <PixelProgress value={j.progress} />}
                  {j.status === 'failed' && (
                    <span class="form-error" role="alert">
                      {j.error}
                    </span>
                  )}
                </span>
                {(j.status === 'queued' || j.status === 'rendering') && (
                  <button type="button" class="icon-btn icon-btn-sm" aria-label={`Cancel ${j.spec.name}`} onClick={() => cancelJob(j.id)}>
                    <PxIcon name="x" size={12} />
                  </button>
                )}
                {j.status === 'done' && a && (
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost"
                    onClick={() => {
                      openAssetId.value = a.id;
                      go({ view: 'assets' });
                      onClose();
                    }}
                  >
                    View
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <footer class="queue-foot">
        <span class="mono">{`${renderTarget().name} · ${renderTarget().detail}`}</span>
        {list.some((j) => j.status === 'done' || j.status === 'cancelled' || j.status === 'failed') && (
          <button type="button" class="btn btn-sm btn-ghost" onClick={clearFinished}>
            Clear finished
          </button>
        )}
      </footer>
    </div>
  );
}
