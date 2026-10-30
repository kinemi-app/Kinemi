// Visual camera controls: a rig pad for moves, a lens test for focal length and aperture,
// and picture cards for the body, the look and the frame. They write the same values the
// chat sets, so a shot set up by hand or by chat is the same shot.
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { APERTURES, ASPECTS, BODIES, BODY_INFO, LOOKS, LOOK_SWATCHES } from '../data/options';
import { MOVES, MOVE_GROUPS, moveById, type MoveFx } from '../data/moves';
import type { UiIconName } from '../lib/px-icons';
import { clamp, cx, rng } from '../lib/util';
import { PxIcon } from '../ui/icons';
import { openMenu } from '../ui/layers';

/** The move under the pointer: the rig and the monitor both play it. */
export const movePreview = signal<MoveFx | null>(null);

const preview = (id: string | null) => (movePreview.value = id ? (moveById(id)?.fx ?? null) : null);
const hoverProps = (id: string) => ({
  onPointerEnter: () => preview(id),
  onPointerLeave: () => preview(null),
  onFocus: () => preview(id),
  onBlur: () => preview(null),
});

/* ------------------------------------------------------------------ */
/* Optics                                                              */
/* ------------------------------------------------------------------ */

export const focalOf = (lens: string) => parseInt(lens, 10) || 35;
export const isAnamorphic = (lens: string) => /anamorphic/i.test(lens);
/** Horizontal field of view: full frame for spherical lenses, Super 35 with a 2x squeeze for anamorphic. */
export const fovOf = (lens: string) => Math.round((2 * Math.atan((isAnamorphic(lens) ? 24.9 : 18) / focalOf(lens)) * 180) / Math.PI);
const fNumber = (a: string) => parseFloat(String(a).replace('f/', '')) || 2.8;
/** 0 at 14mm, 1 at 135mm, on a log scale like a zoom ring. */
const tele = (lens: string) => clamp((Math.log(focalOf(lens)) - Math.log(14)) / (Math.log(135) - Math.log(14)), 0, 1);

const BLUR: Record<string, number> = {
  'f/1.4': 5,
  'f/1.8': 4,
  'f/2.8': 2.6,
  'f/4': 1.6,
  'f/8': 0.6,
  'f/16': 0,
};
const DOF: Record<string, number> = {
  'f/1.4': 10,
  'f/1.8': 14,
  'f/2.8': 22,
  'f/4': 32,
  'f/8': 58,
  'f/16': 88,
};

/* ------------------------------------------------------------------ */
/* Radio groups of cards                                               */
/* ------------------------------------------------------------------ */

/** Arrow keys move through a grid of radio cards, like a segmented control. */
function radioKeys(options: string[], value: string, set: (v: string) => void, cols: number) {
  return (e: KeyboardEvent) => {
    const step = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: cols,
      ArrowUp: -cols,
    }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = Math.max(0, options.indexOf(value));
    set(options[(i + step + options.length) % options.length]);
    const group = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
}

function Cards({
  label,
  options,
  value,
  set,
  cols,
  class: cls,
  children,
}: {
  label: string;
  options: string[];
  value: string;
  set: (v: string) => void;
  cols: number;
  class?: string;
  children: (o: string) => ComponentChildren;
}) {
  return (
    <div class={cx('cards', cls)} role="radiogroup" aria-label={label} style={{ '--cols': cols } as Record<string, number>} onKeyDown={radioKeys(options, value, set, cols)}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} tabIndex={o === value ? 0 : -1} class={cx('card-opt', o === value && 'is-on')} onClick={() => set(o)}>
          {children(o)}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The rig pad                                                         */
/* ------------------------------------------------------------------ */

interface PadKey {
  id: string;
  icon: UiIconName;
  rot?: number;
  flip?: boolean;
  /** centre in the top-view plan, in plan units (0-100) */
  x?: number;
  y?: number;
}

// The plan is a 100 x 100 top view: the subject at the ring's centre, the camera resting on the ring straight
// below it. Every key sits outside the ring and clear of the camera's swing, so nothing overlaps.
const RING = { x: 50, y: 41, r: 23 };
const CAM = { x: RING.x, y: RING.y + RING.r };
const PLAN: PadKey[] = [
  { id: 'dolly-in', icon: 'arrow-right', rot: -90, x: 50, y: 10 },
  { id: 'orbit-left', icon: 'refresh', flip: true, x: 11, y: 41 },
  { id: 'orbit-right', icon: 'refresh', x: 89, y: 41 },
  { id: 'truck-left', icon: 'arrow-right', rot: 180, x: 22, y: 76 },
  { id: 'truck-right', icon: 'arrow-right', x: 78, y: 76 },
  { id: 'dolly-out', icon: 'arrow-right', rot: 90, x: 50, y: 91 },
];
const LIFT: PadKey[] = [
  { id: 'crane-up', icon: 'arrow-right', rot: -90 },
  { id: 'crane-down', icon: 'arrow-right', rot: 90 },
];
const HEAD: Array<PadKey | null> = [
  { id: 'dutch-roll', icon: 'roll' },
  { id: 'tilt-up', icon: 'chevron-up' },
  { id: 'zoom-in', icon: 'zoom-in' },
  { id: 'pan-left', icon: 'chevron-left' },
  null,
  { id: 'pan-right', icon: 'chevron-right' },
  { id: 'handheld', icon: 'shake' },
  { id: 'tilt-down', icon: 'chevron-down' },
  { id: 'zoom-out', icon: 'zoom-out' },
];

interface PadState { single?: boolean; order: (id: string) => number; toggle: (id: string) => void }

/** The sightline: a cone from the camera that reaches just past the subject, as wide as the lens sees. */
function Beam({ lens }: { lens: string }) {
  const half = (fovOf(lens) / 2) * (Math.PI / 180);
  const reach = RING.r + 8;
  const dx = Math.min(44, Math.tan(half) * reach);
  return <path class="rp-beam" d={`M${CAM.x} ${CAM.y} L${(CAM.x - dx).toFixed(1)} ${CAM.y - reach} L${(CAM.x + dx).toFixed(1)} ${CAM.y - reach} Z`} />;
}

function PadButton({ k, pad, style }: { k: PadKey; pad: PadState; style?: Record<string, string> }) {
  const n = pad.order(k.id);
  const name = moveById(k.id)!.name;
  return (
    <button type="button" class={cx('pad-key', n > 0 && 'is-on')} style={style} aria-pressed={n > 0} aria-label={name} data-tip={name} onClick={() => pad.toggle(k.id)} {...hoverProps(k.id)}>
      <span style={{ transform: `${k.flip ? 'scaleX(-1) ' : ''}rotate(${k.rot ?? 0}deg)` }}>
        <PxIcon name={k.icon} size={12} />
      </span>
      {n > 0 && !pad.single && <b class="pad-n mono">{n}</b>}
    </button>
  );
}

/** The plan: ring, sightline, camera and subject in one svg, drawn bottom to top, with the keys over it. */
function TopView({ lens, pad }: { lens: string; pad: PadState }) {
  const { x, y, r } = RING;
  return (
    <div class="rp-plan">
      <svg class="rp-art" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id="rp-beam-fill" x1="0" y1="1" x2="0" y2="0">
            <stop class="rp-beam-near" offset="0" />
            <stop class="rp-beam-far" offset="1" />
          </linearGradient>
        </defs>
        <circle class="rp-halo" cx={x} cy={y} r="11" />
        <circle class="rp-ring" data-rig="ring" cx={x} cy={y} r={r} />
        <g class="rp-move"><Beam lens={lens} /></g>
        <g class="rp-move" data-rig="camera" shape-rendering="crispEdges">
          <rect class="rp-cam-lens" x={CAM.x - 3} y={CAM.y - 8} width="6" height="4" />
          <rect class="rp-cam-body" x={CAM.x - 6} y={CAM.y - 4} width="12" height="8" />
        </g>
        <g data-rig="subject" shape-rendering="crispEdges">
          <rect class="rp-subject-body" x={x - 7} y={y - 1} width="14" height="6" />
          <rect class="rp-subject-head" x={x - 3} y={y - 5} width="6" height="6" />
        </g>
      </svg>
      {PLAN.map((k) => <PadButton key={k.id} k={k} pad={pad} style={{ left: `${k.x}%`, top: `${k.y}%` }} />)}
    </div>
  );
}

const Crane = ({ pad }: { pad: PadState }) => (
  <div class="rp-crane">
    <PadButton k={LIFT[0]} pad={pad} />
    <span class="rp-rail" aria-hidden="true">
      <i class="rp-lift-cam" />
    </span>
    <PadButton k={LIFT[1]} pad={pad} />
  </div>
);

const HeadPad = ({ pad }: { pad: PadState }) => (
  <div class="rp-head">
    {HEAD.map((k, i) =>
      k ? (
        <PadButton key={k.id} k={k} pad={pad} />
      ) : (
        <span key={i} class="rp-lens" aria-hidden="true">
          <PxIcon name="lens" size={18} />
        </span>
      ),
    )}
  </div>
);

const Cell = ({ label, children }: { label: string; children: ComponentChildren }) => (
  <div class="rp-cell">
    {children}
    <span class="rp-cap mono">{label}</span>
  </div>
);

export function MovePad({ value, onChange, single, lens }: { value: string[]; onChange: (ids: string[]) => void; single?: boolean; lens: string }) {
  const toggle = (id: string) => {
    if (single) onChange([id]);
    else onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id].slice(-3));
  };
  const pad: PadState = { single, toggle, order: (id) => value.indexOf(id) + 1 };
  const library = (el: HTMLElement) =>
    openMenu(
      el,
      MOVE_GROUPS.map((g) => ({
        label: g,
        items: MOVES.filter((m) => m.group === g).map((m) => ({
          label: m.name,
          checked: value.includes(m.id),
          onSelect: () => toggle(m.id),
        })),
      })),
      { minWidth: 220 },
    );

  return (
    <div class="rig" data-play={movePreview.value ?? undefined}>
      <div class="rp-pads">
        <Cell label="Top view">
          <TopView lens={lens} pad={pad} />
        </Cell>
        <Cell label="Crane">
          <Crane pad={pad} />
        </Cell>
        <Cell label="Head · zoom">
          <HeadPad pad={pad} />
        </Cell>
      </div>

      <div class="rig-stack">
        {value.map((id, i) => {
          const m = moveById(id);
          if (!m) return null;
          return (
            <span key={id} class="move-chip" {...hoverProps(id)}>
              {!single && <span class="move-n mono">{i + 1}</span>}
              {m.name}
              {!single && (
                <button type="button" class="icon-btn icon-btn-sm" aria-label={`Remove ${m.name}`} onClick={() => onChange(value.filter((x) => x !== id))}>
                  <PxIcon name="x" size={10} />
                </button>
              )}
            </span>
          );
        })}
        {!value.length && <span class="rig-none mono">Locked off</span>}
        <button type="button" class="move-add" aria-haspopup="menu" onClick={(e) => library(e.currentTarget as HTMLElement)}>
          <PxIcon name="layers" size={12} />
          All {MOVES.length} moves
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The lens test                                                       */
/* ------------------------------------------------------------------ */

// a pixel skyline, drawn once: buildings plus three colours of lit windows
const CITY = (() => {
  const r = rng(11);
  const blocks: string[] = [];
  const lit: string[][] = [[], [], []];
  let x = -4;
  while (x < 164) {
    const w = 8 + Math.floor(r() * 12);
    const h = 16 + Math.floor(r() * 34);
    blocks.push(`M${x} ${60 - h}h${w}v${h}h-${w}z`);
    for (let wy = 60 - h + 3; wy < 56; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) if (r() < 0.32) lit[Math.floor(r() * 3)].push(`M${wx} ${wy}h1.6v1.6h-1.6z`);
    x += w + 1 + Math.floor(r() * 3);
  }
  return { blocks: blocks.join(''), lit: lit.map((l) => l.join('')) };
})();

const BOKEH: Array<[number, number, number]> = [
  [12, 62, 2],
  [24, 70, 3],
  [33, 58, 4],
  [46, 66, 2],
  [58, 60, 3],
  [67, 71, 4],
  [79, 63, 2],
  [88, 69, 3],
  [95, 59, 4],
];

function Iris({ aperture }: { aperture: string }) {
  const r = 2.2 + 6.2 * Math.pow(1.4 / fNumber(aperture), 0.55);
  const pts = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
    return `${(10 + Math.cos(a) * r).toFixed(2)},${(10 + Math.sin(a) * r).toFixed(2)}`;
  }).join(' ');
  return (
    <svg class="iris" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" />
      <polygon points={pts} />
    </svg>
  );
}

/** One ruler of stops: a range input with every stop printed under it. */
function Stops({ label, stops, index, onChange, dim }: { label: string; stops: string[]; index: number; onChange: (i: number) => void; dim?: boolean }) {
  const n = stops.length - 1;
  const pct = (index / n) * 100;
  return (
    <div class={cx('slider', 'stops', dim && 'is-dim')}>
      <div class="slider-track" style={{ '--a': '0%', '--b': `${pct}%` } as Record<string, string>}>
        <input type="range" min={0} max={n} step={1} value={index} aria-label={label} aria-valuetext={stops[index]} onInput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))} />
      </div>
      <div class="stops-ruler mono" aria-hidden="true">
        {stops.map((s, i) => (
          <span key={s} class={cx(i === index && 'is-on')} style={{ left: `${(i / n) * 100}%` }} onClick={() => onChange(i)}>
            {s.replace('mm', '')}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Optics({
  lens,
  aperture,
  look,
  lenses,
  onLens,
  onAperture,
}: {
  lens: string;
  aperture?: string;
  look?: string;
  lenses: string[];
  onLens: (v: string) => void;
  onAperture?: (v: string) => void;
}) {
  const ana = isAnamorphic(lens);
  const stops = lenses.filter((l) => !isAnamorphic(l));
  const anaLens = lenses.find(isAnamorphic);
  const t = tele(lens);
  const li = ana ? stops.indexOf('35mm') : Math.max(0, stops.indexOf(lens));
  const blur = aperture ? (BLUR[aperture] ?? 2) * (0.55 + 0.9 * t) : 0.4;
  const dof = aperture ? clamp((DOF[aperture] ?? 30) * (1.25 - 0.6 * t), 6, 96) : 60;
  const sw = LOOK_SWATCHES[look ?? ''] ?? LOOK_SWATCHES['Neon noir'];
  const vars = {
    '--bg-s': (1 + 2.3 * t).toFixed(3),
    '--subj-s': (0.78 + 0.55 * t).toFixed(3),
    '--blur': `${blur.toFixed(2)}px`,
    ...Object.fromEntries(sw.map((c, i) => [`--c${i}`, c])),
  } as Record<string, string>;
  const depth = !aperture ? '' : dof < 20 ? 'shallow' : dof < 45 ? 'medium' : 'deep';

  return (
    <div class="optics">
      <div class={cx('lens-test', ana && 'is-ana')} style={vars} aria-hidden="true">
        <div class="lt-sky" />
        <div class="lt-far">
          <svg class="lt-city" viewBox="0 0 160 60" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges">
            <path class="lt-blocks" d={CITY.blocks} />
            {CITY.lit.map((d, i) => (
              <path key={i} class={`lt-w${i}`} d={d} />
            ))}
          </svg>
          {BOKEH.map(([x, y, c], i) => (
            <i
              key={i}
              class="lt-ball"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                background: `var(--c${c})`,
              }}
            />
          ))}
        </div>
        <div class="lt-street" />
        <svg class="lt-subject" viewBox="0 0 12 24" shape-rendering="crispEdges">
          <rect x="4" y="1" width="4" height="1" fill="#f2d45c" />
          <rect x="3" y="2" width="6" height="4" fill="#f2d45c" />
          <rect x="5" y="3" width="2" height="2" fill="#e8b48a" />
          <rect x="2" y="6" width="8" height="9" fill="#f2d45c" />
          <rect x="2" y="11" width="8" height="1" fill="#c9a93a" />
          <rect x="1" y="7" width="1" height="6" fill="#d9bb45" />
          <rect x="10" y="7" width="1" height="6" fill="#d9bb45" />
          <rect x="4" y="15" width="2" height="6" fill="#1a2230" />
          <rect x="6" y="15" width="2" height="6" fill="#141b26" />
          <rect x="3" y="21" width="3" height="1" fill="#0b0f16" />
          <rect x="6" y="21" width="3" height="1" fill="#0b0f16" />
        </svg>
        <i class="lt-flare" />
        <i class="vf vf-tl" />
        <i class="vf vf-tr" />
        <i class="vf vf-bl" />
        <i class="vf vf-br" />
        <span class="lt-hud lt-hud-l mono">
          {focalOf(lens)}MM{ana ? ' ANA' : ''} · {fovOf(lens)}°
        </span>
        {aperture && (
          <span class="lt-hud lt-hud-r mono">
            {aperture.toUpperCase()} · {depth.toUpperCase()}
          </span>
        )}
      </div>

      <div class="optics-row">
        <span class="optics-k">
          <PxIcon name="lens" size={14} />
          Focal length
        </span>
        <span class="optics-v mono">{ana ? `${focalOf(lens)}mm ana` : lens}</span>
      </div>
      <Stops label="Focal length" stops={stops} index={li} dim={ana} onChange={(i) => onLens(stops[i])} />
      {anaLens && (
        <button type="button" class={cx('chip', 'chip-ana', ana && 'is-on')} aria-pressed={ana} onClick={() => onLens(ana ? '35mm' : anaLens)}>
          <span class="ana-glyph" aria-hidden="true" />
          Anamorphic {focalOf(anaLens)}mm · oval bokeh, blue flares
        </button>
      )}

      {aperture && onAperture && (
        <>
          <div class="optics-row">
            <span class="optics-k">
              <Iris aperture={aperture} />
              Aperture
            </span>
            <span class="optics-v mono">{aperture}</span>
          </div>
          <Stops label="Aperture" stops={APERTURES} index={Math.max(0, APERTURES.indexOf(aperture))} onChange={(i) => onAperture(APERTURES[i])} />
          <div class="dof" aria-hidden="true">
            <span class="mono">near</span>
            <span class="dof-bar">
              <span class="dof-zone" style={{ width: `${dof}%` }} />
              <i class="dof-subject" />
            </span>
            <span class="mono">far</span>
          </div>
          <p class="field-note">
            {depth === 'shallow'
              ? 'Shallow focus: the background melts, the subject pops.'
              : depth === 'medium'
                ? 'Some depth: the background softens but stays readable.'
                : 'Deep focus: everything from front to back stays sharp.'}
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Body, look and frame                                                */
/* ------------------------------------------------------------------ */

function Sprockets({ x0, x1, y }: { x0: number; x1: number; y: number }) {
  const holes = [];
  for (let x = x0; x <= x1; x += 4) holes.push(<rect key={x} x={x} y={y} width="2" height="2" class="g-hole" />);
  return <>{holes}</>;
}

function BodyGlyph({ body }: { body: string }) {
  const art = (() => {
    switch (body) {
      case 'Large format digital':
        return (
          <>
            <rect x="5" y="2" width="30" height="20" class="g-edge" />
            <rect x="7" y="4" width="26" height="16" class="g-chip" />
            <path d="M7 8h26M7 12h26M7 16h26M13 4v16M20 4v16M27 4v16" class="g-grid" />
          </>
        );
      case 'Super 35 digital':
        return (
          <>
            <rect x="5" y="2" width="30" height="20" class="g-ghost" />
            <rect x="10" y="6" width="20" height="12" class="g-edge" />
            <rect x="12" y="8" width="16" height="8" class="g-chip" />
            <path d="M12 12h16M17 8v8M23 8v8" class="g-grid" />
          </>
        );
      case '35mm film stock':
        return (
          <>
            <rect x="2" y="3" width="36" height="18" class="g-film" />
            <Sprockets x0={4} x1={34} y={4} />
            <Sprockets x0={4} x1={34} y={18} />
            <rect x="7" y="7" width="12" height="10" class="g-frame" />
            <rect x="21" y="7" width="12" height="10" class="g-frame" />
          </>
        );
      case '16mm film stock':
        return (
          <>
            <rect x="6" y="5" width="28" height="14" class="g-film" />
            <Sprockets x0={8} x1={30} y={6} />
            <rect x="9" y="9" width="10" height="8" class="g-frame" />
            <rect x="21" y="9" width="10" height="8" class="g-frame" />
          </>
        );
      case 'Super 8 home movie':
        return (
          <>
            <rect x="10" y="6" width="20" height="12" class="g-film" />
            <rect x="12" y="10" width="2" height="3" class="g-hole" />
            <rect x="16" y="8" width="11" height="8" class="g-frame g-warm" />
          </>
        );
      default:
        return (
          <>
            <rect x="4" y="4" width="32" height="16" class="g-film" />
            <rect x="8" y="6" width="24" height="3" class="g-label" />
            <rect x="11" y="11" width="6" height="6" class="g-reel" />
            <rect x="23" y="11" width="6" height="6" class="g-reel" />
            <rect x="17" y="12" width="6" height="4" class="g-window" />
          </>
        );
    }
  })();
  return (
    <svg class="body-glyph" viewBox="0 0 40 24" shape-rendering="crispEdges" aria-hidden="true">
      {art}
    </svg>
  );
}

export function BodyCards({ value, set }: { value: string; set: (v: string) => void }) {
  return (
    <Cards label="Camera body" options={BODIES} value={value} set={set} cols={3} class="cards-body">
      {(b) => (
        <>
          <BodyGlyph body={b} />
          <span class="card-name">{BODY_INFO[b]?.short ?? b}</span>
          <span class="card-note mono">{BODY_INFO[b]?.note}</span>
        </>
      )}
    </Cards>
  );
}

export function LookCards({ value, set }: { value: string; set: (v: string) => void }) {
  return (
    <Cards label="Look" options={LOOKS} value={value} set={set} cols={3} class="cards-look">
      {(l) => (
        <>
          <span class="look-strip" aria-hidden="true">
            {(LOOK_SWATCHES[l] ?? []).map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
          <span class="card-name">{l}</span>
        </>
      )}
    </Cards>
  );
}

export function AspectCards({ value, set }: { value: string; set: (v: string) => void }) {
  return (
    <Cards label="Aspect" options={ASPECTS} value={value} set={set} cols={5} class="cards-aspect">
      {(a) => {
        const [w, h] = a.split(':').map(Number);
        const r = w / h;
        const box = r >= 34 / 24 ? { width: 34, height: 34 / r } : { width: 24 * r, height: 24 };
        return (
          <>
            <span class="aspect-box" aria-hidden="true">
              <i
                style={{
                  width: `${box.width.toFixed(1)}px`,
                  height: `${box.height.toFixed(1)}px`,
                }}
              />
            </span>
            <span class="card-name mono">{a}</span>
          </>
        );
      }}
    </Cards>
  );
}
