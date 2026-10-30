// Top bar: logo, sidebar toggle, the four spaces, the render queue and the compute chip.
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { account } from '../cloud/session';
import { BASE, CLOUD, GUESTS } from '../deploy';
import { go, href, route, toolHref } from '../router';
import { renderTarget } from '../compute';
import { activeJobs, jobs, patchSettings, settings } from '../store';
import { closeOnLeave } from '../ui/hover-close';
import { LogoMark, PxIcon } from '../ui/icons';
import { PixelText } from '../ui/PixelText';
import { cx } from '../lib/util';
import { QueuePanel } from './Queue';

/** Mobile: the sidebar as a drawer. */
export const drawer = signal(false);
export const queueOpen = signal(false);

/** The render queue button and its panel. Opened with the mouse, it closes when the mouse leaves both. */
function QueueButton() {
  const wrap = useRef<HTMLDivElement>(null);
  const open = queueOpen.value;
  useEffect(() => {
    const el = wrap.current;
    if (!open || !el) return;
    return closeOnLeave((t) => el.contains(t), () => (queueOpen.value = false), { armed: el.matches(':hover') });
  }, [open]);
  const running = activeJobs.value;
  const current = running.find((j) => j.status === 'rendering');
  const done = jobs.value.filter((j) => j.status === 'done').length;
  return (
    <div class="queue-wrap" ref={wrap}>
      <button
        type="button"
        class={cx('pill-btn', 'queue-btn', running.length > 0 && 'is-busy')}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (queueOpen.value = !open)}
      >
        <span class="queue-ring" style={{ '--p': current ? current.progress : 0 } as Record<string, number>} aria-hidden="true">
          <PxIcon name="queue" size={16} />
        </span>
        <span class="queue-label">Render queue</span>
        {running.length > 0 ? <span class="badge badge-live">{running.length}</span> : done > 0 ? <span class="badge">{done}</span> : null}
      </button>
      {open && <QueuePanel onClose={() => (queueOpen.value = false)} />}
    </div>
  );
}

export function TopBar() {
  const r = route.value;
  const tabs = [
    { key: 'chat', label: 'Chat', href: href({ view: 'chat' }), on: r.view === 'chat' },
    { key: 'tools', label: 'Tools', href: href({ view: 'tools' }), on: r.view === 'tools' || (r.view === 'tool' && r.tool !== 'academy') },
    { key: 'assets', label: 'Assets', href: href({ view: 'assets' }), on: r.view === 'assets' },
    { key: 'academy', label: 'Academy', href: toolHref('academy'), on: r.view === 'tool' && r.tool === 'academy' },
  ];
  const nav = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const active = tabs.findIndex((t) => t.on);

  useLayoutEffect(() => {
    const place = () => {
      const el = nav.current?.querySelector<HTMLElement>('.tab.is-on');
      setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null);
    };
    place();
    const ro = new ResizeObserver(place);
    if (nav.current) ro.observe(nav.current);
    return () => ro.disconnect();
  }, [active]);

  const s = settings.value;
  const target = renderTarget();

  return (
    <header class="topbar">
      <div class="brand">
        <button type="button" class="icon-btn drawer-btn" aria-label="Open the sidebar" onClick={() => (drawer.value = true)}>
          <PxIcon name="menu" />
        </button>
        <a class="brand-link" href={href({ view: 'chat' })} aria-label="Kinemi studio, home">
          <LogoMark size={28} />
          <PixelText text="KINEMI" stops={['#ffffff', '#ffffff']} decorative class="brand-word" />
        </a>
        <button
          type="button"
          class="icon-btn sidebar-toggle"
          aria-label={s.sidebar ? 'Collapse the sidebar' : 'Expand the sidebar'}
          aria-pressed={s.sidebar}
          aria-keyshortcuts="["
          data-tip={s.sidebar ? 'Collapse sidebar · [' : 'Expand sidebar · ['}
          onClick={() => patchSettings({ sidebar: !s.sidebar })}
        >
          <PxIcon name="sidebar" />
        </button>
      </div>

      <nav ref={nav} class="tabs" aria-label="Studio">
        {pill && <span class="tabs-pill" style={{ transform: `translateX(${pill.x}px)`, width: `${pill.w}px` }} aria-hidden="true" />}
        {tabs.map((t) => (
          <a key={t.key} class={cx('tab', t.on && 'is-on')} href={t.href} aria-current={t.on ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>

      <div class="top-actions">
        <QueueButton />
        {CLOUD && GUESTS && !account.value && (
          <a class="pill-btn signin-btn" href={`${BASE}signin/?next=${encodeURIComponent(typeof location === 'undefined' ? `${BASE}app/` : location.pathname)}`}>
            <PxIcon name="user" size={15} />
            <span>Sign in</span>
          </a>
        )}
        <button type="button" class={cx('pill-btn', 'compute-chip', target.demo && 'is-off')} onClick={() => go({ view: 'settings', section: 'providers' })}>
          <span class="compute-ico" aria-hidden="true">
            <PxIcon name={target.icon} size={16} />
          </span>
          <span class="compute-text">
            <b>{target.name}</b>
            <small class="mono">{target.detail}</small>
          </span>
        </button>
      </div>
    </header>
  );
}
