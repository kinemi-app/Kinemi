// Kinemi studio: the dashboard. One island; the server renders the shell and the first view.
import { effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { AssetsView } from './assets/AssetsView';
import { startLibraryStore } from './assets/persist';
import { ChatView } from './chat/ChatView';
import { newChat } from './chat/actions';
import { startChatStore } from './chat/persist';
import { accountsRequired, signInHref, startAccounts, storedAccount } from './cloud/auth';
import { studioKeyFor } from './cloud/keys';
import { account, authReady } from './cloud/session';
import { loadSecrets } from './compute';
import { CLOUD, GUESTS } from './deploy';
import { cx, isBrowser } from './lib/util';
import { go, href, parse, route, startRouter, toolHref } from './router';
import { SettingsView } from './settings/SettingsView';
import { Sidebar } from './shell/Sidebar';
import { drawer, queueOpen, TopBar } from './shell/TopBar';
import { openCompute } from './shell/Compute';
import { loadState, openAssetId, patchSettings, settings, switchStudio } from './store';
import { ToolsView } from './tools/ToolsView';
import { Workspace } from './tools/Workspace';
import { DialogLayer, MenuLayer, RailTips, Toasts, dialog, menu } from './ui/layers';
import { PxIcon } from './ui/icons';

/** With accounts: a sign-in starts syncing that account's studio, a sign-out goes back to the guest's
 *  (or, when signing in is required, to the sign-in page). */
function bootAccounts() {
  if (!CLOUD) return;
  // signed in last time: open that account's studio straight away, before the session is checked
  const last = storedAccount();
  if (last) switchStudio(studioKeyFor(last.id));
  void startAccounts(async (next, prev) => {
    const { startSync, stopSync } = await import('./cloud/sync');
    if (next) return startSync(next);
    stopSync({ toGuest: GUESTS });
    if (prev && accountsRequired) location.replace(signInHref());
  }).then(() => {
    if (accountsRequired && authReady.value && !account.value) location.replace(signInHref());
  });
}

let booted = false;

function MobileTabs() {
  const r = route.value;
  const tabs = [
    { label: 'Chat', icon: 'chat' as const, href: href({ view: 'chat' }), on: r.view === 'chat' },
    { label: 'Tools', icon: 'tools' as const, href: href({ view: 'tools' }), on: r.view === 'tools' || (r.view === 'tool' && r.tool !== 'academy') },
    { label: 'Assets', icon: 'assets' as const, href: href({ view: 'assets' }), on: r.view === 'assets' },
    { label: 'Academy', icon: 'academy' as const, href: toolHref('academy'), on: r.view === 'tool' && r.tool === 'academy' },
  ];
  return (
    <nav class="mobile-tabs" aria-label="Studio">
      {tabs.map((t) => (
        <a key={t.label} href={t.href} class={cx('mtab', t.on && 'is-on')} aria-current={t.on ? 'page' : undefined}>
          <PxIcon name={t.icon} size={18} />
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

export default function App({ path }: { path: string }) {
  // the server renders every route; the browser starts from the one it was served
  if (!isBrowser) route.value = parse(path);
  else if (!booted) {
    booted = true;
    route.value = parse(path);
  }

  useEffect(() => {
    loadState();
    // with accounts, the account keeps chats and the library; on this computer, the local server does
    if (!CLOUD) {
      void startChatStore();
      void startLibraryStore();
    }
    loadSecrets();
    startRouter();
    bootAccounts();
    document.documentElement.classList.add('app-ready');
    // Settings → Interface → Motion: “Reduce” calms everything, whatever the device says
    const stopMotion = effect(() => {
      document.documentElement.classList.toggle('motion-reduce', settings.value.motion === 'reduce');
    });
    // the landing page's "Connect your Comfy" lands here with ?connect
    if (new URLSearchParams(location.search).has('connect')) {
      history.replaceState(null, '', location.pathname);
      openCompute();
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.closest('input, textarea, [contenteditable="true"]');
      if (e.key === 'Escape') {
        drawer.value = false;
        queueOpen.value = false;
      }
      // single-key shortcuts can be switched off in Settings → Interface
      if (typing || e.metaKey || e.ctrlKey || e.altKey || menu.value || dialog.value || !settings.value.keys) return;
      if (e.key === '/') {
        const target = document.querySelector<HTMLElement>('.composer textarea, .assets-search input');
        if (target) {
          e.preventDefault();
          target.focus();
        }
      } else if (e.key === 'n' && route.value.view === 'chat') {
        e.preventDefault();
        newChat();
      } else if (e.key === '[') patchSettings({ sidebar: !settings.value.sidebar });
      else if (e.key === ',') go({ view: 'settings', section: 'account' });
      else if (e.key === '1') go({ view: 'chat' });
      else if (e.key === '2') go({ view: 'tools' });
      else if (e.key === '3') go({ view: 'assets' });
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stopMotion();
    };
  }, []);

  const r = route.value;
  const s = settings.value;
  return (
    <div class={cx('app', !s.sidebar && 'no-sidebar', drawer.value && 'drawer-open')} data-view={r.view}>
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <div class="app-bg" aria-hidden="true" />
      <TopBar />
      <div class="frame">
        <Sidebar />
        <button type="button" class="drawer-scrim" aria-label="Close the sidebar" tabIndex={-1} onClick={() => (drawer.value = false)} />
        <main id="main" class="main" tabIndex={-1}>
          {r.view === 'chat' && <ChatView />}
          {r.view === 'tools' && <ToolsView />}
          {r.view === 'tool' && <Workspace key={r.tool} tool={r.tool} />}
          {r.view === 'assets' && <AssetsView />}
          {r.view === 'settings' && <SettingsView section={r.section} />}
        </main>
      </div>
      <MobileTabs />
      <MenuLayer />
      <RailTips />
      <DialogLayer />
      <Toasts
        onOpenAsset={(id) => {
          openAssetId.value = id;
          go({ view: 'assets' });
        }}
      />
    </div>
  );
}
