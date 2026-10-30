// Pixel icons: interface icons and the 16 tool icons, one merged path per colour.
import { toPath } from '../../lib/pixel-font';
import { ICONS, ICON_COLORS, type IconName } from '../../lib/pixel-icons';
import { UI_ICONS, type UiIconName } from '../lib/px-icons';
import { LOGO_VIEWBOX, K_PATH, PIXEL_ROWS, SEAM_PATH, BRAND } from '../../lib/logo';
import { hash, rng } from '../lib/util';

type Runs = Array<[string, string]>;
const cache = new Map<string, Runs>();

function runs(key: string, grid: string[]): Runs {
  const hit = cache.get(key);
  if (hit) return hit;
  const by = new Map<string, Array<{ x: number; y: number; g: number }>>();
  grid.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === '.' || x > 8) return;
      if (!by.has(c)) by.set(c, []);
      by.get(c)!.push({ x, y, g: 0 });
    }),
  );
  const out: Runs = [...by].map(([c, cells]) => [c, toPath(cells)]);
  cache.set(key, out);
  return out;
}

interface IconProps {
  size?: number;
  class?: string;
  label?: string;
}

export function PxIcon({ name, size = 18, class: cls, label }: IconProps & { name: UiIconName }) {
  return (
    <svg
      class={cls ? `px ${cls}` : 'px'}
      viewBox="0 0 9 9"
      width={size}
      height={size}
      shape-rendering="crispEdges"
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {runs(`ui:${name}`, UI_ICONS[name]).map(([c, d]) => (
        <path key={c} d={d} fill={c === '+' ? 'var(--px-accent, #39d879)' : 'currentColor'} />
      ))}
    </svg>
  );
}

export function ToolIcon({ id, size = 28, class: cls }: IconProps & { id: IconName }) {
  return (
    <svg class={cls ? `px tool-px ${cls}` : 'px tool-px'} viewBox="0 0 9 9" width={size} height={size} shape-rendering="crispEdges" aria-hidden="true">
      {runs(`tool:${id}`, ICONS[id]).map(([c, d]) => (
        <path key={c} d={d} fill={ICON_COLORS[c]} />
      ))}
    </svg>
  );
}

export function LogoMark({ size = 24, class: cls }: { size?: number; class?: string }) {
  return (
    <svg class={cls ? `logo-mark ${cls}` : 'logo-mark'} viewBox={LOGO_VIEWBOX} width={size} height={(size * 597) / 697} aria-hidden="true">
      <path d={K_PATH} fill="currentColor" />
      <g class="logo-pixels">
        {PIXEL_ROWS.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={BRAND.green} style={`--i:${i}`} />
        ))}
      </g>
      <path d={SEAM_PATH} fill="none" stroke={BRAND.seam} stroke-width="4" stroke-dasharray="9.6 3.9" />
    </svg>
  );
}

/** A 5 x 5 mirrored pixel avatar from a name: every user gets their own little sprite. */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const r = rng(hash(name));
  const colors = ['#39d879', '#2ee6c4', '#a0eec2', '#5aa9e6', '#f2f7f4'];
  const fg = colors[Math.floor(r() * colors.length)];
  const cells: Array<[number, number]> = [];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++)
      if (r() > 0.45) {
        cells.push([x, y]);
        if (x < 2) cells.push([4 - x, y]);
      }
  return (
    <svg class="avatar" viewBox="-1 -1 7 7" width={size} height={size} shape-rendering="crispEdges" aria-hidden="true">
      <rect x="-1" y="-1" width="7" height="7" fill="#0d3b25" />
      <path d={cells.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('')} fill={fg} />
    </svg>
  );
}
