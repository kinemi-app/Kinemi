// A render's poster: pixel art painted to fit its box in whole-number pixels.
// Painting is spread over frames and cached, so a grid of thirty cards never stalls a frame.
import { useEffect, useRef, useState } from 'preact/hooks';
import { fileURL } from '../lib/files';
import { renderLow, type PosterSpec } from '../lib/poster';
import type { Asset } from '../store';

type PosterAsset = Pick<Asset, 'id' | 'scene' | 'seed' | 'palette' | 'panels' | 'kind' | 'file' | 'url' | 'media'>;

/** A server render's own picture: its url when the file is an image or a video (audio keeps the pixel poster). */
const serverPicture = (a: PosterAsset) => (a.url && (a.media === 'image' || a.media === 'video') ? a.url : null);

/** Assets that should appear pixel by pixel the first time they are painted. */
const fresh = new Set<string>();
export const markFresh = (ids: string[]) => ids.forEach((i) => fresh.add(i));

const queue: Array<() => void> = [];
let scheduled = false;
function schedule(job: () => void) {
  queue.push(job);
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 10) queue.shift()!();
    if (queue.length) requestAnimationFrame(run);
    else scheduled = false;
  };
  requestAnimationFrame(run);
}

interface Props {
  asset: PosterAsset;
  class?: string;
  /** roughly how many pixel columns across, 110 by default */
  density?: number;
  alt?: string;
}

export function Poster({ asset, class: cls, density = 110, alt }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [isBroken, setBroken] = useState(false);
  const palette = (asset.palette ?? []).join();
  const picture = isBroken ? null : serverPicture(asset);

  useEffect(() => setBroken(false), [asset.url]);

  useEffect(() => {
    if (picture) return;
    if (asset.file) {
      let live = true;
      fileURL(asset.id)
        .then((u) => live && setUrl(u))
        .catch(() => {});
      return () => {
        live = false;
      };
    }
    const canvas = ref.current;
    if (!canvas) return;
    const spec: PosterSpec & { kind?: string } = { scene: asset.scene, seed: asset.seed, palette: asset.palette, panels: asset.panels, kind: asset.kind };
    let last = '';
    let alive = true;
    const draw = () => {
      if (!alive) return;
      const r = canvas.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(r.width * dpr);
      const H = Math.round(r.height * dpr);
      const key = `${W}x${H}`;
      if (key === last) return;
      last = key;
      const cssPixel = Math.max(2, Math.min(7, Math.round(r.width / density)));
      const pixel = Math.max(1, Math.round(cssPixel * dpr));
      schedule(() => {
        if (!alive) return;
        const low = renderLow(spec, Math.ceil(W / pixel), Math.ceil(H / pixel));
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        if (fresh.has(asset.id)) {
          fresh.delete(asset.id);
          dissolve(ctx, low, pixel);
        } else ctx.drawImage(low, 0, 0, low.width * pixel, low.height * pixel);
        canvas.classList.add('is-painted');
      });
    };
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [asset.id, asset.seed, asset.scene, asset.kind, asset.panels, palette, !!asset.file, picture, density]);

  // A link that will not load (a keyed ComfyUI, an expired file) falls back to the pixel poster.
  const broken = () => setBroken(true);
  if (picture) {
    return asset.media === 'video' ? (
      <video class={`poster poster-file ${cls ?? ''}`} src={picture} muted playsInline preload="metadata" aria-label={alt} onError={broken} />
    ) : (
      <img class={`poster poster-file ${cls ?? ''}`} src={picture} alt={alt ?? ''} onError={broken} />
    );
  }
  if (asset.file) {
    if (!url) return <span class={`poster poster-file ${cls ?? ''}`} />;
    return asset.file.type.startsWith('video') ? (
      <video class={`poster poster-file ${cls ?? ''}`} src={url} muted playsInline preload="metadata" aria-label={alt} />
    ) : (
      <img class={`poster poster-file ${cls ?? ''}`} src={url} alt={alt ?? ''} />
    );
  }
  return <canvas ref={ref} class={`poster ${cls ?? ''}`} role={alt ? 'img' : undefined} aria-label={alt} aria-hidden={alt ? undefined : 'true'} />;
}

/** The pixel art appearing a pixel at a time. */
function dissolve(ctx: CanvasRenderingContext2D, low: HTMLCanvasElement, pixel: number, ms = 650) {
  const cols = low.width;
  const n = cols * low.height;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  ctx.fillStyle = '#04090f';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  let done = 0;
  const t0 = performance.now();
  const step = (now: number) => {
    const target = Math.min(n, Math.round(((now - t0) / ms) * n));
    for (; done < target; done++) {
      const k = order[done];
      const x = k % cols;
      const y = (k / cols) | 0;
      ctx.drawImage(low, x, y, 1, 1, x * pixel, y * pixel, pixel, pixel);
    }
    if (done < n) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
