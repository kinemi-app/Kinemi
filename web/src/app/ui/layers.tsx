// Overlays drawn once at the root: menus, dialogs and toasts.
// Menus are plain data, so any button, card or right-click can open one.
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { UiIconName } from '../lib/px-icons';
import { cx } from '../lib/util';
import { closeOnLeave, pointerOn } from './hover-close';
import { PxIcon } from './icons';
import { dismiss, toasts } from './toast';

/* ------------------------------------------------------------------ */
/* Menus                                                               */
/* ------------------------------------------------------------------ */

export interface MenuItem {
  label?: string;
  icon?: UiIconName;
  /** a colour dot instead of an icon (tags, palettes) */
  swatch?: string;
  hint?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** a small heading */
  heading?: string;
  /** keep the menu open after choosing (multi-select filters) */
  keep?: boolean;
  items?: MenuItem[];
  onSelect?: () => void;
}

interface MenuState {
  x: number;
  y: number;
  /** width of the trigger, so the menu can match it */
  w: number;
  items: MenuItem[];
  trigger?: HTMLElement | null;
  align?: 'start' | 'end';
  minWidth?: number;
  /** the trigger's top edge: a menu that opens upwards ends 6px above it */
  top: number;
  placement?: 'below' | 'above';
  /** opened at a point (a right-click), not from a button */
  point?: boolean;
}

export const menu = signal<MenuState | null>(null);

type MenuOpts = { align?: 'start' | 'end'; minWidth?: number; placement?: 'below' | 'above' };

/** The trigger says whether its menu is open, so a caret can turn with it. */
function markOpen(el: HTMLElement | null | undefined, open: boolean) {
  if (!el?.hasAttribute('aria-haspopup')) return;
  if (open) el.setAttribute('aria-expanded', 'true');
  else el.removeAttribute('aria-expanded');
}

export function openMenu(at: HTMLElement | { x: number; y: number }, items: MenuItem[], opts: MenuOpts = {}) {
  // a second click on the button that opened the menu closes it
  if (menu.value && !menu.value.point && menu.value.trigger === at) return closeMenu();
  markOpen(menu.value?.trigger, false);
  if ('getBoundingClientRect' in at) {
    const r = at.getBoundingClientRect();
    menu.value = { x: opts.align === 'end' ? r.right : r.left, y: r.bottom + 6, top: r.top, w: r.width, items, trigger: at, ...opts };
    markOpen(at, true);
  } else menu.value = { x: at.x, y: at.y, top: at.y, w: 0, items, trigger: document.activeElement as HTMLElement, point: true, ...opts };
}

export const closeMenu = () => {
  const t = menu.value?.trigger;
  menu.value = null;
  markOpen(t, false);
  t?.focus?.({ preventScroll: true });
};

type PanelProps = {
  items: MenuItem[];
  x: number;
  y: number;
  /** the trigger's top edge, for opening (or flipping) upwards */
  anchorTop?: number;
  placement?: 'below' | 'above';
  align?: 'start' | 'end';
  minWidth?: number;
  sub?: boolean;
  onClose: () => void;
};

function MenuPanel({ items, x, y, anchorTop, placement, align, minWidth, sub, onClose }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [open, setOpen] = useState<number | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    let left = align === 'end' ? x - r.width : x;
    // upwards, the menu ends just above its trigger and never covers it
    const above = Math.max(8, (anchorTop ?? y) - r.height - 6);
    let top = placement === 'above' ? above : y;
    if (left + r.width > innerWidth - 8) left = sub ? x - r.width - (ref.current?.parentElement ? 0 : 0) - 8 : innerWidth - r.width - 8;
    if (left < 8) left = 8;
    if (top + r.height > innerHeight - 8) top = sub ? Math.max(8, innerHeight - r.height - 8) : above;
    setPos({ left, top, ready: true });
    if (!sub) itemRefs.current.find((b) => b && !b.disabled)?.focus({ preventScroll: true });
  }, [x, y, items]);

  const focusable = () => itemRefs.current.filter((b): b is HTMLButtonElement => !!b && !b.disabled);

  const onKey = (e: KeyboardEvent) => {
    const list = focusable();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const n = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[n]?.focus();
    } else if (e.key === 'ArrowRight') {
      const idx = itemRefs.current.indexOf(document.activeElement as HTMLButtonElement);
      if (items[idx]?.items) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(idx);
      }
    } else if (e.key === 'ArrowLeft' && sub) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      ref={ref}
      class={cx('menu', pos.ready && 'is-ready', sub && 'menu-sub')}
      role="menu"
      style={{ left: `${pos.left}px`, top: `${pos.top}px`, minWidth: minWidth ? `${minWidth}px` : undefined }}
      onKeyDown={onKey}
    >
      {items.map((it, i) => {
        if (it.separator) return <div key={i} class="menu-sep" role="separator" />;
        if (it.heading) return <div key={i} class="menu-heading mono">{it.heading}</div>;
        const hasSub = !!it.items?.length;
        return (
          <div key={i} class="menu-row" onMouseEnter={() => setOpen(hasSub ? i : null)}>
            <button
              ref={(b) => {
                itemRefs.current[i] = b;
              }}
              type="button"
              class={cx('menu-item', it.danger && 'is-danger', open === i && 'is-open')}
              role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={it.checked !== undefined ? it.checked : undefined}
              aria-haspopup={hasSub ? 'menu' : undefined}
              aria-expanded={hasSub ? open === i : undefined}
              disabled={it.disabled}
              onClick={() => {
                if (hasSub) {
                  setOpen(open === i ? null : i);
                  return;
                }
                it.onSelect?.();
                if (!it.keep) closeMenu();
              }}
            >
              <span class="menu-ico">
                {it.checked !== undefined ? (
                  <span class={cx('menu-check', it.checked && 'is-on')}>{it.checked && <PxIcon name="check" size={12} />}</span>
                ) : it.swatch ? (
                  <span class="swatch" style={{ background: it.swatch }} />
                ) : it.icon ? (
                  <PxIcon name={it.icon} size={14} />
                ) : null}
              </span>
              <span class="menu-label">{it.label}</span>
              {it.hint && <span class="menu-hint mono">{it.hint}</span>}
              {hasSub && <PxIcon name="chevron-right" size={12} class="menu-caret" />}
            </button>
            {hasSub && open === i && (
              <SubMenu items={it.items!} anchor={itemRefs.current[i]} onClose={() => {
                setOpen(null);
                itemRefs.current[i]?.focus();
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SubMenu({ items, anchor, onClose }: { items: MenuItem[]; anchor: HTMLElement | null; onClose: () => void }) {
  const r = anchor?.getBoundingClientRect();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    (ref.current?.querySelector('.menu-item:not([disabled])') as HTMLElement | null)?.focus({ preventScroll: true });
  }, []);
  if (!r) return null;
  const right = r.right + 4;
  const fits = right + 220 < innerWidth;
  return (
    <div ref={ref}>
      <MenuPanel items={items} x={fits ? right : r.left - 4} y={r.top - 6} align={fits ? 'start' : 'end'} sub onClose={onClose} />
    </div>
  );
}

export function MenuLayer() {
  const m = menu.value;
  useEffect(() => {
    if (!m) return;
    // a press on the menu's own button is left to its click, which toggles the menu
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element;
      if (!el.closest('.menu') && !(m.trigger && !m.point && m.trigger.contains(el))) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu();
    // close only when the scroll moved the trigger: panning a graph elsewhere leaves the menu open
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Element && t.closest('.menu')) return;
      const trigger = menu.value?.trigger;
      if (!trigger || !(t instanceof Node) || t.contains(trigger)) closeMenu();
    };
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', onDown, true);
      window.addEventListener('resize', closeMenu);
      document.addEventListener('scroll', onScroll, true);
    });
    document.addEventListener('keydown', onKey);
    // a menu opened with the mouse closes when the mouse leaves it and its button
    const trigger = m.point ? null : m.trigger;
    const stopLeave = closeOnLeave((el) => !!el.closest('.menu') || !!trigger?.contains(el), closeMenu, { armed: !!trigger?.matches(':hover') || pointerOn(trigger) });
    return () => {
      stopLeave();
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', closeMenu);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [m]);
  if (!m) return null;
  return <MenuPanel items={m.items} x={m.x} y={m.y} anchorTop={m.top} placement={m.placement} align={m.align} minWidth={m.minWidth ?? Math.max(200, m.w)} onClose={closeMenu} />;
}

/* ------------------------------------------------------------------ */
/* Rail tooltips                                                       */
/* ------------------------------------------------------------------ */

/** The collapsed sidebar scrolls, so its labels float in a fixed layer rather than clip. */
export function RailTips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const wide = matchMedia('(min-width: 861px)');
    const target = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-rail-tip]');
      return el && wide.matches && el.closest('.no-sidebar') ? el : null;
    };
    const show = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      setTip({ text: el.dataset.railTip!, x: r.right + 12, y: r.top + r.height / 2 });
    };
    const hide = () => setTip(null);
    const onOver = (e: PointerEvent) => {
      const el = e.pointerType === 'mouse' ? target(e) : null;
      el ? show(el) : hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = target(e);
      el?.matches(':focus-visible') ? show(el) : hide();
    };
    const onOut = (e: PointerEvent) => !e.relatedTarget && hide();
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('scroll', hide, true);
    };
  }, []);
  if (!tip || menu.value) return null;
  return (
    <div class="rail-tip" style={{ left: `${tip.x}px`, top: `${tip.y}px` }} aria-hidden="true">
      {tip.text}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

interface DialogState {
  title: string;
  body: (close: () => void) => ComponentChildren;
  wide?: boolean;
}

export const dialog = signal<DialogState | null>(null);
export const openDialog = (d: DialogState) => (dialog.value = d);
export const closeDialog = () => (dialog.value = null);

export function DialogLayer() {
  const d = dialog.value;
  const ref = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!d) return;
    back.current = document.activeElement as HTMLElement;
    const el = ref.current!;
    (el.querySelector('[autofocus], input, textarea, button.btn-primary, button') as HTMLElement | null)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDialog();
      if (e.key !== 'Tab') return;
      const f = [...el.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex="0"]')].filter((x) => !x.hasAttribute('disabled'));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      back.current?.focus?.({ preventScroll: true });
    };
  }, [d]);
  if (!d) return null;
  return (
    <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div ref={ref} class={cx('dialog', d.wide && 'dialog-wide')} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <i class="vf vf-tl" aria-hidden="true" />
        <i class="vf vf-tr" aria-hidden="true" />
        <i class="vf vf-bl" aria-hidden="true" />
        <i class="vf vf-br" aria-hidden="true" />
        <header class="dialog-head">
          <h2 id="dialog-title">{d.title}</h2>
          <button type="button" class="icon-btn" aria-label="Close" onClick={closeDialog}>
            <PxIcon name="x" size={14} />
          </button>
        </header>
        <div class="dialog-body">{d.body(closeDialog)}</div>
      </div>
    </div>
  );
}

/** Ask for a name: new folder, rename, new tag. */
export function promptName(title: string, opts: { value?: string; label: string; cta: string; onSubmit: (v: string) => void }) {
  openDialog({
    title,
    body: (close) => (
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          const v = (new FormData(e.currentTarget as HTMLFormElement).get('name') as string).trim();
          if (!v) return;
          opts.onSubmit(v);
          close();
        }}
      >
        <label class="field">
          <span class="field-label">{opts.label}</span>
          <input class="input" name="name" value={opts.value ?? ''} maxLength={60} autoComplete="off" autofocus onFocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
        </label>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" class="btn btn-primary">
            {opts.cta}
          </button>
        </div>
      </form>
    ),
  });
}

export function confirmDialog(title: string, opts: { body: string; cta: string; cancel?: string; danger?: boolean; onConfirm: () => void }) {
  openDialog({
    title,
    body: (close) => (
      <div class="form">
        <p class="dialog-text">{opts.body}</p>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onClick={close}>
            {opts.cancel ?? 'Cancel'}
          </button>
          <button
            type="button"
            class={cx('btn', opts.danger ? 'btn-danger' : 'btn-primary')}
            autofocus
            onClick={() => {
              opts.onConfirm();
              close();
            }}
          >
            {opts.cta}
          </button>
        </div>
      </div>
    ),
  });
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

export function Toasts({ onOpenAsset }: { onOpenAsset: (id: string) => void }) {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={t.leaving ? 'toast is-leaving' : 'toast'}>
          <span class="toast-dot" aria-hidden="true" />
          <div class="toast-text">
            <b>{t.title}</b>
            {t.body && <span>{t.body}</span>}
          </div>
          {t.asset && (
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              onClick={() => {
                onOpenAsset(t.asset!);
                dismiss(t.id);
              }}
            >
              View
            </button>
          )}
          {t.action && (
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" class="icon-btn icon-btn-sm" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <PxIcon name="x" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
