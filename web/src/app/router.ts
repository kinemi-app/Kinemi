// A tiny router: every route is a pre-rendered page, links swap the view without a reload.
import { signal } from '@preact/signals';
import { sectionById, type SectionId } from './data/sections';
import { toolById, toolBySlug, type ToolId } from './data/tools';
import { isBrowser, transition } from './lib/util';

export type Route = { view: 'chat' } | { view: 'tools' } | { view: 'tool'; tool: ToolId } | { view: 'assets' } | { view: 'settings'; section: SectionId };

export const APP_BASE = `${(import.meta.env.BASE_URL ?? '/').replace(/\/$/, '')}/app`;

export function parse(path: string): Route {
  const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (parts[0] === 'tools' && parts[1]) {
    const t = toolBySlug(parts[1]);
    if (t) return { view: 'tool', tool: t.id };
  }
  if (parts[0] === 'tools') return { view: 'tools' };
  if (parts[0] === 'assets') return { view: 'assets' };
  if (parts[0] === 'settings') return { view: 'settings', section: sectionById(parts[1] ?? '')?.id ?? 'account' };
  return { view: 'chat' };
}

export function href(r: Route) {
  switch (r.view) {
    case 'tools':
      return `${APP_BASE}/tools/`;
    case 'tool':
      return `${APP_BASE}/tools/${toolById(r.tool).slug}/`;
    case 'assets':
      return `${APP_BASE}/assets/`;
    case 'settings':
      return `${APP_BASE}/settings/${r.section}/`;
    default:
      return `${APP_BASE}/`;
  }
}

export const route = signal<Route>({ view: 'chat' });

const fromLocation = () => parse(location.pathname.slice(location.pathname.indexOf('/app') + 4));

export function go(to: Route | string, opts: { replace?: boolean; hash?: string } = {}) {
  const r = typeof to === 'string' ? parse(to.slice(to.indexOf('/app') + 4)) : to;
  const url = href(r);
  if (isBrowser && url !== location.pathname) history[opts.replace ? 'replaceState' : 'pushState'](null, '', url + (opts.hash ? `#${opts.hash}` : ''));
  if (JSON.stringify(r) === JSON.stringify(route.value)) return;
  transition(() => {
    route.value = r;
    document.querySelector('.main-scroll, .main')?.scrollTo?.({ top: 0 });
  });
}

export const settingsHref = (section: SectionId = 'account') => href({ view: 'settings', section });

let started = false;
/** Intercept in-app links and the back button. */
export function startRouter() {
  if (started || !isBrowser) return;
  started = true;
  window.addEventListener('popstate', () => transition(() => (route.value = fromLocation())));
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.('a');
    if (!a || a.target || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith(APP_BASE)) return;
    e.preventDefault();
    go(url.pathname);
  });
}

export const toolHref = (id: ToolId) => href({ view: 'tool', tool: id });
