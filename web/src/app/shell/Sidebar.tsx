// The sidebar changes with the space you are in: chat history, the tool list, or folders and tags.
import { computed } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { favorite, moveTo, newFolderWith, newTagWith, tagColorItems, tagWith, trash } from '../assets/actions';
import { dragging, useDrop } from '../assets/dnd';
import { newChat, openChat } from '../chat/actions';
import { signOut } from '../cloud/auth';
import { account, SYNC_LABEL, syncState } from '../cloud/session';
import { BASE, CLOUD, GUESTS } from '../deploy';
import { APP_TOOLS, type ToolId } from '../data/tools';
import type { UiIconName } from '../lib/px-icons';
import { cx, dayGroup, isBrowser, transition } from '../lib/util';
import { go, href, route, toolHref } from '../router';
import { connected, renderTarget } from '../compute';
import {
  activeChatId,
  chats,
  deleteFolder,
  deleteTag,
  folders,
  liveAssets,
  patchSettings,
  ready,
  renameFolder,
  resetStudio,
  scope,
  selection,
  settings,
  tagFilter,
  tags,
  trashed,
  updateTag,
  type Scope,
} from '../store';
import { Avatar, PxIcon, ToolIcon } from '../ui/icons';
import { confirmDialog, openMenu, promptName } from '../ui/layers';
import { Model3D } from '../ui/Model3D';
import { chatStoreProblem } from '../chat/persist';
import { ChatItem } from './ChatItem';
import { openCompute } from './Compute';
import { drawer } from './TopBar';

function Section({ title, action, class: cls, children }: { title: string; action?: ComponentChildren; class?: string; children: ComponentChildren }) {
  return (
    <section class={cx('side-section', cls)}>
      <header class="side-label">
        <span class="mono">{title}</span>
        {action}
      </header>
      {children}
    </section>
  );
}

function Item({
  icon,
  tool,
  swatch,
  label,
  count,
  active,
  href: link,
  onClick,
  more,
  drop,
  title,
}: {
  icon?: UiIconName;
  tool?: ToolId;
  swatch?: string;
  label: string;
  count?: number;
  active?: boolean;
  href?: string;
  onClick?: (el: HTMLElement) => void;
  more?: (el: HTMLElement) => void;
  drop?: (ids: string[]) => void;
  title?: string;
}) {
  const d = useDrop(drop ?? (() => {}));
  // folded into the rail, the label shows as a tooltip
  const tip = count !== undefined ? `${label} · ${count}` : label;
  const inner = (
    <>
      <span class="side-ico">{tool ? <ToolIcon id={tool} size={16} /> : swatch ? <span class="swatch" style={{ background: swatch }} /> : icon ? <PxIcon name={icon} size={16} /> : null}</span>
      <span class="side-text">{label}</span>
      {count !== undefined && <span class="side-count mono">{count}</span>}
    </>
  );
  return (
    <div class={cx('side-item', active && 'is-on', drop && dragging.value && 'is-target', d.over && 'is-over')} {...(drop ? d.props : {})} title={title}>
      {link ? (
        <a class="side-link" href={link} aria-current={active ? 'page' : undefined} data-rail-tip={tip} onClick={() => (drawer.value = false)}>
          {inner}
        </a>
      ) : (
        <button type="button" class="side-link" aria-pressed={active} data-rail-tip={tip} onClick={(e) => onClick?.(e.currentTarget as HTMLElement)}>
          {inner}
        </button>
      )}
      {more && (
        <button type="button" class="side-more icon-btn icon-btn-sm" aria-label={`More for ${label}`} onClick={(e) => more(e.currentTarget as HTMLElement)}>
          <PxIcon name="more" size={14} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

const grouped = computed(() => {
  const groups = new Map<string, typeof chats.value>();
  // day names depend on the clock: wait for the browser so the server render matches
  const list = [...chats.value].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const c of list) {
    const g = ready.value && isBrowser ? dayGroup(c.updatedAt) : 'Recent';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(c);
  }
  return [...groups];
});

function ChatSide() {
  const active = activeChatId.value;
  const renders = liveAssets.value.length;
  return (
    <>
      <Section title="Menu">
        <Item icon="camera" label="Move library" href={toolHref('presets')} />
        <Item icon="user" label="My cast" href={toolHref('cast')} />
        <Item icon="board" label="Shot lists" href={toolHref('storyboard')} />
        <Item icon="assets" label="Renders" count={renders} href={href({ view: 'assets' })} />
      </Section>
      <div class="seam" aria-hidden="true" />
      <Section title="History" class="rail-only">
        <Item icon="clock" label="Chat history" count={chats.value.length} onClick={openHistory} />
      </Section>
      {grouped.value.map(([group, list]) => (
        <Section key={group} title={group} class="side-history">
          {list.map((c) => (
            <ChatItem key={c.id} chat={c} active={route.value.view === 'chat' && active === c.id} />
          ))}
        </Section>
      ))}
      {chats.value.length === 0 && <p class="side-empty">Chats you start show up here.</p>}
      {chatStoreProblem.value && (
        <p class="side-empty side-warn" role="status">
          Chats are kept in this browser only. {chatStoreProblem.value}
        </p>
      )}
    </>
  );
}

/** The rail has no room for the chat list: it opens as a menu beside it. */
function openHistory(at: HTMLElement) {
  const r = at.getBoundingClientRect();
  const list = [...chats.value].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
  at.focus({ preventScroll: true });
  openMenu(
    { x: r.right + 10, y: r.top },
    [
      { heading: 'Recent chats' },
      ...list.map((c) => ({ label: c.title, icon: 'chat' as const, onSelect: () => openChat(c.id) })),
      ...(list.length === 0 ? [{ label: 'No chats yet', disabled: true }] : []),
      { separator: true },
      { label: 'Expand the sidebar', icon: 'sidebar' as const, onSelect: () => patchSettings({ sidebar: true }) },
    ],
    { minWidth: 260 },
  );
}

function ToolsSide() {
  const r = route.value;
  const on = (id: ToolId) => r.view === 'tool' && r.tool === id;
  return (
    <>
      <Section title="Overview">
        <Item icon="tools" label="All 16 tools" active={r.view === 'tools'} href={href({ view: 'tools' })} />
      </Section>
      <Section title="Core">
        {APP_TOOLS.filter((t) => !t.studio).map((t) => (
          <Item key={t.id} tool={t.id} label={t.name} active={on(t.id)} href={toolHref(t.id)} />
        ))}
      </Section>
      <Section title="Studios">
        {APP_TOOLS.filter((t) => t.studio).map((t) => (
          <Item key={t.id} tool={t.id} label={t.name} active={on(t.id)} href={toolHref(t.id)} />
        ))}
      </Section>
    </>
  );
}

function AssetsSide() {
  const sc = scope.value;
  const live = liveAssets.value;
  const week = Date.now() - 7 * 86_400_000;
  const is = (s: Scope) => sc.type === s.type && (s.type !== 'folder' || (sc.type === 'folder' && sc.id === s.id));
  const pick = (s: Scope) => {
    transition(() => {
      scope.value = s;
      selection.value = [];
    });
    drawer.value = false;
  };
  const filter = tagFilter.value;
  return (
    <>
      <Section title="Library">
        <Item icon="layers" label="All assets" count={live.length} active={is({ type: 'all' })} onClick={() => pick({ type: 'all' })} />
        <Item icon="star" label="Favourites" count={live.filter((a) => a.favorite).length} active={is({ type: 'favorites' })} onClick={() => pick({ type: 'favorites' })} drop={(ids) => favorite(ids)} />
        <Item icon="clock" label="This week" count={ready.value ? live.filter((a) => a.createdAt > week).length : undefined} active={is({ type: 'recent' })} onClick={() => pick({ type: 'recent' })} />
        <Item icon="inbox" label="Unsorted" count={live.filter((a) => !a.folderId).length} active={is({ type: 'unsorted' })} onClick={() => pick({ type: 'unsorted' })} drop={(ids) => moveTo(ids, null)} />
        <Item icon="trash" label="Trash" count={trashed.value.length} active={is({ type: 'trash' })} onClick={() => pick({ type: 'trash' })} drop={(ids) => trash(ids)} />
      </Section>
      <div class="seam" aria-hidden="true" />
      <Section
        title="Folders"
        action={
          <button type="button" class="icon-btn icon-btn-sm" aria-label="New folder" data-tip="New folder" onClick={() => newFolderWith([])}>
            <PxIcon name="plus" size={12} />
          </button>
        }
      >
        {folders.value.map((f) => (
          <Item
            key={f.id}
            icon="folder"
            label={f.name}
            count={live.filter((a) => a.folderId === f.id).length}
            active={is({ type: 'folder', id: f.id })}
            onClick={() => pick({ type: 'folder', id: f.id })}
            drop={(ids) => moveTo(ids, f.id)}
            more={(el) =>
              openMenu(el, [
                { label: 'Rename…', icon: 'pencil', onSelect: () => promptName('Rename folder', { label: 'Folder name', value: f.name, cta: 'Rename', onSubmit: (v) => renameFolder(f.id, v) }) },
                {
                  label: 'Delete folder',
                  icon: 'trash',
                  danger: true,
                  onSelect: () =>
                    confirmDialog(`Delete “${f.name}”?`, { body: 'The assets in it move to Unsorted. Nothing is deleted.', cta: 'Delete folder', danger: true, onConfirm: () => deleteFolder(f.id) }),
                },
              ])
            }
          />
        ))}
        {folders.value.length === 0 && <p class="side-empty">Drag assets onto a folder to file them.</p>}
      </Section>
      <Section
        title="Tags"
        action={
          <button type="button" class="icon-btn icon-btn-sm" aria-label="New tag" data-tip="New tag" onClick={() => newTagWith([])}>
            <PxIcon name="plus" size={12} />
          </button>
        }
      >
        {tags.value.map((t) => (
          <Item
            key={t.id}
            swatch={t.color}
            label={t.name}
            count={live.filter((a) => a.tagIds.includes(t.id)).length}
            active={filter.includes(t.id)}
            onClick={() => transition(() => (tagFilter.value = filter.includes(t.id) ? filter.filter((x) => x !== t.id) : [...filter, t.id]))}
            drop={(ids) => tagWith(ids, t.id, true)}
            more={(el) =>
              openMenu(el, [
                { label: 'Rename…', icon: 'pencil', onSelect: () => promptName('Rename tag', { label: 'Tag', value: t.name, cta: 'Rename', onSubmit: (v) => updateTag(t.id, { name: v.toLowerCase() }) }) },
                { label: 'Colour', icon: 'palette', items: tagColorItems((c) => updateTag(t.id, { color: c }), t.color) },
                { label: 'Delete tag', icon: 'trash', danger: true, onSelect: () => deleteTag(t.id) },
              ])
            }
          />
        ))}
      </Section>
    </>
  );
}

function GpuCard() {
  return (
    <div class="gpu-card">
      <button type="button" class="icon-btn icon-btn-sm gpu-close" aria-label="Hide this card" onClick={() => patchSettings({ gpuCard: false })}>
        <PxIcon name="x" size={12} />
      </button>
      <Model3D model="gpu" class="gpu-3d">
        <PxIcon name="gpu" size={40} />
      </Model3D>
      <p class="gpu-title">Render on your own GPU</p>
      <p class="gpu-text">Renders run on the server's ComfyUI. Point the server at yours and restart it to get real renders. Every render shows its runtime and credits first.</p>
      <button type="button" class="btn btn-sm btn-accent gpu-cta" onClick={openCompute}>
        <PxIcon name="plug" size={14} />
        Connect ComfyUI
      </button>
    </div>
  );
}

function UserCard() {
  const s = settings.value;
  const me = account.value;
  const name = me?.name || s.name.trim() || (CLOUD ? 'Guest' : 'Director');
  const where = renderTarget().name;
  const sub = me ? `${SYNC_LABEL[syncState.value] === SYNC_LABEL.saved ? 'Synced' : SYNC_LABEL[syncState.value]} · ${where}` : CLOUD ? `Guest · ${where}` : where;
  // where to come back to after signing in: read on click, there is no location on the server
  const next = () => encodeURIComponent(location.pathname);
  return (
    <button
      type="button"
      class="user-card"
      aria-haspopup="menu"
      data-rail-tip={name}
      onClick={(e) =>
        openMenu(
          e.currentTarget as HTMLElement,
          [
            ...(me ? [{ heading: me.email }] : []),
            { label: 'Settings', icon: 'settings' as const, hint: ',', onSelect: () => go({ view: 'settings', section: 'account' }) },
            { label: 'Where renders run…', icon: 'plug' as const, onSelect: () => go({ view: 'settings', section: 'providers' }) },
            { label: 'Academy', icon: 'academy' as const, onSelect: () => go({ view: 'tool', tool: 'academy' }) },
            { separator: true },
            ...(CLOUD && !me && GUESTS
              ? [
                  { label: 'Create an account', icon: 'user' as const, onSelect: () => (location.href = `${BASE}signup/?next=${next()}`) },
                  { label: 'Sign in', icon: 'key' as const, onSelect: () => (location.href = `${BASE}signin/?next=${next()}`) },
                  { separator: true },
                ]
              : []),
            { label: 'Kinemi website', icon: 'external' as const, onSelect: () => (location.href = BASE) },
            { label: 'Privacy and terms', icon: 'shield' as const, onSelect: () => go({ view: 'settings', section: 'about' }) },
            ...(me
              ? [{ label: 'Sign out', icon: 'logout' as const, onSelect: () => void signOut().catch(() => {}) }]
              : [
                  {
                    label: 'Reset the studio',
                    icon: 'refresh' as const,
                    danger: true,
                    onSelect: () =>
                      confirmDialog('Reset the studio?', { body: 'Chats, renders, folders, tags, settings and your saved keys go. The sample studio comes back.', cta: 'Reset', danger: true, onConfirm: resetStudio }),
                  },
                ]),
          ],
          { minWidth: 240, placement: 'above' },
        )
      }
    >
      <Avatar name={name} size={34} />
      <span class="user-text">
        <b>{name}</b>
        <small>{sub}</small>
      </span>
      <span class="user-chevron" aria-hidden="true">
        <PxIcon name="chevron-down" size={12} />
      </span>
    </button>
  );
}

export function Sidebar() {
  const r = route.value;
  const s = settings.value;
  return (
    <aside class="sidebar" aria-label="Sidebar">
      <div class="side-top">
        <button
          type="button"
          class="btn btn-primary btn-block side-new"
          data-rail-tip="New chat"
          onClick={() => {
            drawer.value = false;
            newChat();
          }}
        >
          <PxIcon name="chat-plus" size={16} />
          <span class="side-new-text">New chat</span>
        </button>
        <button type="button" class="icon-btn drawer-close" aria-label="Close the sidebar" onClick={() => (drawer.value = false)}>
          <PxIcon name="x" size={14} />
        </button>
      </div>
      {/* settings list their sections in the page itself, so the sidebar keeps the chats there */}
      <nav class="side-scroll" aria-label={r.view === 'chat' || r.view === 'settings' ? 'Chats' : r.view === 'assets' ? 'Library' : 'Tools'}>
        {(r.view === 'chat' || r.view === 'settings') && <ChatSide />}
        {(r.view === 'tools' || r.view === 'tool') && <ToolsSide />}
        {r.view === 'assets' && <AssetsSide />}
      </nav>
      <div class="side-bottom">
        {s.gpuCard && renderTarget().demo && !connected() && <GpuCard />}
        {renderTarget().demo && (
          <div class="rail-only">
            <Item icon="plug" label="Renderer" onClick={() => go({ view: 'settings', section: 'providers' })} />
          </div>
        )}
        <UserCard />
      </div>
    </aside>
  );
}
