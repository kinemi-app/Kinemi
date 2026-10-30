// Form controls in the Kinemi style: segmented switches, pixel sliders, toggles and dropdowns.
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { UiIconName } from '../lib/px-icons';
import { cx } from '../lib/util';
import { PxIcon } from './icons';
import { openMenu, type MenuItem } from './layers';

export function Field({ label, hint, children, class: cls }: { label: string; hint?: string; children: ComponentChildren; class?: string }) {
  return (
    <div class={cx('field', cls)}>
      <div class="field-head">
        <span class="field-label">{label}</span>
        {hint && <span class="field-hint mono">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** A row of options with a pill that slides to the chosen one. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  class: cls,
}: {
  value: T;
  options: Array<T | { value: T; label: ComponentChildren; icon?: UiIconName }>;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
  class?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    const ro = new ResizeObserver(() => {
      const on = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
      if (on) setPill({ x: on.offsetLeft, w: on.offsetWidth });
    });
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [value, options.length]);
  return (
    <div ref={ref} class={cx('seg', `seg-${size}`, cls)} role="radiogroup" aria-label={label}>
      {pill && <span class="seg-pill" style={{ transform: `translateX(${pill.x}px)`, width: `${pill.w}px` }} aria-hidden="true" />}
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          class={cx('seg-opt', o.value === value && 'is-on')}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const i = opts.findIndex((x) => x.value === value);
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              const n = opts[(i + (e.key === 'ArrowRight' ? 1 : opts.length - 1)) % opts.length];
              onChange(n.value);
              requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
            }
          }}
          tabIndex={o.value === value ? 0 : -1}
        >
          {o.icon && <PxIcon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A range slider with a pixel thumb and a stepped green fill. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  format = (v: number) => String(v),
  marks,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  format?: (v: number) => string;
  marks?: [string, string];
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const zero = min < 0 ? ((0 - min) / (max - min)) * 100 : 0;
  return (
    <div class="slider">
      <div class="slider-track" style={{ '--a': `${Math.min(zero, pct)}%`, '--b': `${Math.max(zero, pct)}%` } as Record<string, string>}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          aria-valuetext={format(value)}
          onInput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))}
        />
      </div>
      <div class="slider-foot mono">
        <span>{marks?.[0] ?? format(min)}</span>
        <b>{format(value)}</b>
        <span>{marks?.[1] ?? format(max)}</span>
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, label, sub }: { on: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} class={cx('toggle', on && 'is-on')} onClick={() => onChange(!on)}>
      <span class="toggle-track" aria-hidden="true">
        <span class="toggle-thumb" />
      </span>
      <span class="toggle-text">
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </span>
    </button>
  );
}

/** A dropdown that opens a Kinemi menu. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  icon,
  render,
  class: cls,
  compact,
}: {
  value: T;
  options: Array<T | { value: T; label: string; hint?: string; heading?: string }>;
  onChange: (v: T) => void;
  label: string;
  icon?: UiIconName;
  render?: (v: T) => ComponentChildren;
  class?: string;
  compact?: boolean;
}) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const current = opts.find((o) => o.value === value);
  return (
    <button
      type="button"
      class={cx('select', compact && 'select-compact', cls)}
      aria-haspopup="menu"
      aria-label={`${label}: ${current?.label ?? value}`}
      onClick={(e) => {
        const items: MenuItem[] = [];
        let lastHeading: string | undefined;
        for (const o of opts) {
          if ('heading' in o && o.heading && o.heading !== lastHeading) {
            items.push({ heading: o.heading });
            lastHeading = o.heading;
          }
          items.push({ label: o.label, hint: 'hint' in o ? o.hint : undefined, checked: o.value === value, onSelect: () => onChange(o.value) });
        }
        openMenu(e.currentTarget as HTMLElement, items);
      }}
    >
      {icon && <PxIcon name={icon} size={14} />}
      <span class="select-value">{render ? render(value) : current?.label ?? value}</span>
      <PxIcon name="chevron-down" size={12} class="select-caret" />
    </button>
  );
}

/** Runtime and credits, always shown before anything renders. */
export function Estimate({ runtime, credits, class: cls }: { runtime: number; credits: number; class?: string }) {
  const time = runtime < 60 ? `${runtime} s` : `${Math.floor(runtime / 60)} min ${runtime % 60 ? `${runtime % 60} s` : ''}`.trim();
  return (
    <span class={cx('estimate', cls)}>
      <span class="estimate-item" data-tip="GPU runtime">
        <PxIcon name="clock" size={13} />
        {time}
      </span>
      <span class="estimate-item" data-tip="Credits">
        <PxIcon name="coin" size={13} />
        {credits} credits
      </span>
    </span>
  );
}
