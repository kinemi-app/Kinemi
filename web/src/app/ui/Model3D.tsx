// A slot for one of the studio's 3D models. The fallback paints first; three.js arrives after
// the page is interactive and draws every slot through one shared renderer.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { ModelName, ModelOptions } from '../three/types';
import { cx } from '../lib/util';

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** The GPU's name from a throwaway WebGL 2 context, or null without WebGL 2. */
function rendererName(): string | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return null;
  }
}

// the same probe, run in a worker so a slow driver never blocks the page
const WORKER_PROBE = `try{const gl=new OffscreenCanvas(1,1).getContext('webgl2');if(!gl)postMessage(null);else{const i=gl.getExtension('WEBGL_debug_renderer_info');postMessage(String(gl.getParameter(i?i.UNMASKED_RENDERER_WEBGL:gl.RENDERER)));const l=gl.getExtension('WEBGL_lose_context');l&&l.loseContext()}}catch(e){postMessage(null)}`;

const idle = (fn: () => void, timeout = 1200) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 200);
};

let probe: Promise<boolean> | null = null;

/** WebGL 2 on a real GPU. Software rasterisers (SwiftShader, llvmpipe) keep the pixel fallbacks:
 *  there every frame would block the main thread. `?3d=on` (or Settings → Interface) forces the 3D on. */
function gpuReady(): Promise<boolean> {
  if (probe) return probe;
  probe = new Promise<boolean>((resolve) => {
    try {
      if (new URLSearchParams(location.search).get('3d') === 'on') localStorage.setItem('kinemi.3d', 'on');
      // Settings → Interface → 3D models: on, off, or (nothing saved) auto
      const pref = localStorage.getItem('kinemi.3d');
      if (pref === 'on') return resolve(true);
      if (pref === 'off') return resolve(false);
    } catch {
      /* storage blocked */
    }
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return resolve(false);
    const onMain = () => idle(() => {
      const name = rendererName();
      resolve(!!name && !SOFTWARE.test(name));
    });
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return onMain();
    try {
      const url = URL.createObjectURL(new Blob([WORKER_PROBE], { type: 'text/javascript' }));
      const worker = new Worker(url);
      const done = (name: string | null) => {
        worker.terminate();
        URL.revokeObjectURL(url);
        // no WebGL in workers (older Safari): ask on the main thread instead
        if (name === null) onMain();
        else resolve(!SOFTWARE.test(name));
      };
      worker.onmessage = (e) => done(e.data);
      worker.onerror = () => done(null);
    } catch {
      onMain();
    }
  });
  return probe;
}

interface Props {
  model: ModelName;
  opts?: ModelOptions;
  class?: string;
  /** shown until the 3D is drawn, and instead of it without WebGL */
  children?: ComponentChildren;
  label?: string;
}

export function Model3D({ model, opts, class: cls, children, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<{ update: (o: ModelOptions) => void; dispose: () => void } | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const optKey = JSON.stringify(opts ?? {});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    gpuReady().then((ok) => {
      if (!ok || cancelled) return;
      idle(() =>
        import('../three/stage')
          .then((m) => {
            if (cancelled) return;
            handle.current = m.mountModel(el, model, optsRef.current ?? {}, () => el.classList.add('is-live'));
          })
          .catch(() => {}),
      );
    });
    return () => {
      cancelled = true;
      handle.current?.dispose();
      handle.current = null;
      el.classList.remove('is-live');
    };
  }, [model]);

  useEffect(() => {
    handle.current?.update(opts ?? {});
  }, [optKey]);

  return (
    <div ref={ref} class={cx('m3d', `m3d-${model}`, cls)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      <div class="m3d-fallback">{children}</div>
    </div>
  );
}
