// The asset store: everything you made, with folders, tags, filters, a detail drawer and bulk moves.
import { computed } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { APP_TOOLS, KIND_LABEL, KINDS, toolById, type AssetKind, type ToolId } from '../data/tools';
import { ago, cx, isBrowser, plural, transition } from '../lib/util';
import {
  folderById,
  kindFilter,
  liveAssets,
  openAssetId,
  patchSettings,
  query,
  ready,
  scope,
  selection,
  settings,
  tagById,
  tagFilter,
  tags,
  toolFilter,
  trashed,
  type Asset,
} from '../store';
import { Segmented } from '../ui/controls';
import { PxIcon, ToolIcon } from '../ui/icons';
import { openMenu, type MenuItem } from '../ui/layers';
import { Model3D } from '../ui/Model3D';
import { Poster } from '../ui/Poster';
import { assetMenu, destroy, download, favorite, folderItems, restore, tagItems, trash } from './actions';
import { AssetDrawer } from './AssetDrawer';
import { endDrag, startDrag } from './dnd';
import { importFiles } from './import';

const WEEK = 7 * 86_400_000;

export const visible = computed(() => {
  const sc = scope.value;
  const q = query.value.trim().toLowerCase();
  const kinds = kindFilter.value;
  const tools = toolFilter.value;
  const tg = tagFilter.value;
  const now = Date.now();
  let list = sc.type === 'trash' ? trashed.value : liveAssets.value;
  if (sc.type === 'favorites') list = list.filter((a) => a.favorite);
  if (sc.type === 'recent') list = list.filter((a) => now - a.createdAt < WEEK);
  if (sc.type === 'unsorted') list = list.filter((a) => !a.folderId);
  if (sc.type === 'folder') list = list.filter((a) => a.folderId === sc.id);
  if (kinds.length) list = list.filter((a) => kinds.includes(a.kind));
  if (tools.length) list = list.filter((a) => (a.source === 'import' ? tools.includes('import' as ToolId) : tools.includes(a.tool)));
  if (tg.length) list = list.filter((a) => tg.every((t) => a.tagIds.includes(t)));
  if (q)
    list = list.filter((a) =>
      `${a.name} ${a.prompt ?? ''} ${toolById(a.tool).name} ${a.tagIds.map((t) => tagById(t)?.name ?? '').join(' ')} ${folderById(a.folderId)?.name ?? ''}`
        .toLowerCase()
        .includes(q),
    );
  const sort = settings.value.assetSort;
  return [...list].sort((a, b) =>
    sort === 'old' ? a.createdAt - b.createdAt : sort === 'name' ? a.name.localeCompare(b.name) : sort === 'tool' ? a.tool.localeCompare(b.tool) || b.createdAt - a.createdAt : b.createdAt - a.createdAt,
  );
});

const scopeTitle = () => {
  const sc = scope.value;
  switch (sc.type) {
    case 'favorites':
      return 'Favourites';
    case 'recent':
      return 'This week';
    case 'unsorted':
      return 'Unsorted';
    case 'trash':
      return 'Trash';
    case 'folder':
      return folderById(sc.id)?.name ?? 'Folder';
    default:
      return 'All assets';
  }
};

const toolName = (a: Asset) => (a.source === 'import' ? 'Imported' : toolById(a.tool).name);
const kindLine = (a: Asset) => `${KIND_LABEL[a.kind].one}${a.duration ? ` · ${a.duration} s` : ''}`;

let anchor: string | null = null;

function select(e: MouseEvent | KeyboardEvent, a: Asset, list: Asset[], force = false) {
  const sel = selection.value;
  if ((e as MouseEvent).shiftKey && anchor) {
    const i = list.findIndex((x) => x.id === anchor);
    const j = list.findIndex((x) => x.id === a.id);
    if (i >= 0 && j >= 0) {
      const range = list.slice(Math.min(i, j), Math.max(i, j) + 1).map((x) => x.id);
      selection.value = [...new Set([...sel, ...range])];
      return;
    }
  }
  anchor = a.id;
  if (force || e.metaKey || e.ctrlKey || sel.length) selection.value = sel.includes(a.id) ? sel.filter((s) => s !== a.id) : [...sel, a.id];
}

function TagDots({ a }: { a: Asset }) {
  const list = a.tagIds.map(tagById).filter(Boolean) as Array<NonNullable<ReturnType<typeof tagById>>>;
  if (!list.length) return null;
  return (
    <span class="tag-dots">
      {list.slice(0, 3).map((t) => (
        <span key={t.id} class="tag-dot" style={{ '--c': t.color } as Record<string, string>}>
          {t.name}
        </span>
      ))}
      {list.length > 3 && <span class="tag-more mono">+{list.length - 3}</span>}
    </span>
  );
}

function Card({ a, list, now }: { a: Asset; list: Asset[]; now: number }) {
  const sel = selection.value.includes(a.id);
  const any = selection.value.length > 0;
  return (
    <li
      class={cx('acard', sel && 'is-selected', any && 'is-selecting', a.kind === 'video' && 'is-video')}
      style={{ viewTransitionName: `a-${a.id}` }}
      draggable={!a.trashedAt}
      onDragStart={(e) => startDrag(e, sel ? selection.value : [a.id], a.name)}
      onDragEnd={endDrag}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!sel) {
          selection.value = [];
        }
        openMenu({ x: e.clientX, y: e.clientY }, assetMenu(a));
      }}
    >
      <button
        type="button"
        class="acard-hit"
        aria-label={`${a.name}, ${kindLine(a)}, ${toolName(a)}`}
        aria-pressed={any ? sel : undefined}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || any) select(e, a, list);
          else {
            anchor = a.id;
            openAssetId.value = a.id;
          }
        }}
        onKeyDown={(e) => {
          if (e.key === ' ') {
            e.preventDefault();
            select(e, a, list, true);
          }
        }}
      />
      <div class="acard-thumb" style={{ '--ar': a.aspect.replace(':', ' / ') } as Record<string, string>}>
        <Poster asset={a} density={80} />
        <span class="acard-kind mono">
          {a.kind === 'video' && <PxIcon name="play" size={10} />}
          {kindLine(a)}
        </span>
        {a.kind === 'video' && <span class="acard-scrub" aria-hidden="true" />}
      </div>
      <label class="acard-check" title="Select">
        <input type="checkbox" checked={sel} onClick={(e) => select(e, a, list, true)} aria-label={`Select ${a.name}`} />
        <span aria-hidden="true">{sel && <PxIcon name="check" size={11} />}</span>
      </label>
      {!a.trashedAt && (
        <button type="button" class={cx('acard-fav', a.favorite && 'is-on')} aria-label={a.favorite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={a.favorite} onClick={() => favorite([a.id])}>
          <PxIcon name="star" size={13} />
        </button>
      )}
      <div class="acard-meta">
        <b class="acard-name">{a.name}</b>
        <span class="acard-line">
          {a.source === 'import' ? <PxIcon name="upload" size={12} /> : <ToolIcon id={a.tool} size={12} />}
          <span>{toolName(a)}</span>
          <span class="dot" aria-hidden="true" />
          <span>{ready.value ? ago(a.createdAt, now) : ''}</span>
        </span>
        <TagDots a={a} />
      </div>
      <i class="vf vf-tl" aria-hidden="true" />
      <i class="vf vf-tr" aria-hidden="true" />
      <i class="vf vf-bl" aria-hidden="true" />
      <i class="vf vf-br" aria-hidden="true" />
    </li>
  );
}

function Row({ a, list, now }: { a: Asset; list: Asset[]; now: number }) {
  const sel = selection.value.includes(a.id);
  return (
    <li
      class={cx('arow', sel && 'is-selected')}
      draggable={!a.trashedAt}
      onDragStart={(e) => startDrag(e, sel ? selection.value : [a.id], a.name)}
      onDragEnd={endDrag}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu({ x: e.clientX, y: e.clientY }, assetMenu(a));
      }}
    >
      <label class="acard-check is-inline">
        <input type="checkbox" checked={sel} onClick={(e) => select(e, a, list, true)} aria-label={`Select ${a.name}`} />
        <span aria-hidden="true">{sel && <PxIcon name="check" size={11} />}</span>
      </label>
      <button type="button" class="arow-main" onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey ? select(e, a, list) : (openAssetId.value = a.id))}>
        <span class="arow-thumb">
          <Poster asset={a} density={24} />
        </span>
        <span class="arow-name">
          <b>{a.name}</b>
          <TagDots a={a} />
        </span>
      </button>
      <span class="arow-cell mono">{kindLine(a)}</span>
      <span class="arow-cell arow-tool">
        {a.source === 'import' ? <PxIcon name="upload" size={12} /> : <ToolIcon id={a.tool} size={12} />}
        {toolName(a)}
      </span>
      <span class="arow-cell arow-folder">{a.folderId ? folderById(a.folderId)?.name : <i>Unsorted</i>}</span>
      <span class="arow-cell mono">{ready.value ? ago(a.createdAt, now) : ''}</span>
      <span class="arow-cell arow-act">
        <button type="button" class={cx('icon-btn icon-btn-sm', a.favorite && 'is-fav')} aria-label="Favourite" aria-pressed={a.favorite} onClick={() => favorite([a.id])}>
          <PxIcon name="star" size={12} />
        </button>
        <button type="button" class="icon-btn icon-btn-sm" aria-label={`More for ${a.name}`} onClick={(e) => openMenu(e.currentTarget as HTMLElement, assetMenu(a), { align: 'end' })}>
          <PxIcon name="more" size={14} />
        </button>
      </span>
    </li>
  );
}

function BulkBar() {
  const ids = selection.value;
  if (!ids.length) return null;
  const inTrash = scope.value.type === 'trash';
  return (
    <div class="bulk" role="toolbar" aria-label={`${ids.length} selected`}>
      <span class="bulk-count">
        <b>{ids.length}</b> selected
      </span>
      <button type="button" class="link-btn" onClick={() => (selection.value = visible.value.map((a) => a.id))}>
        Select all {visible.value.length}
      </button>
      <span class="bulk-sep" aria-hidden="true" />
      {inTrash ? (
        <>
          <button type="button" class="btn btn-sm btn-ghost" onClick={() => restore(ids)}>
            <PxIcon name="restore" size={13} />
            Restore
          </button>
          <button type="button" class="btn btn-sm btn-danger" onClick={() => destroy(ids)}>
            Delete forever
          </button>
        </>
      ) : (
        <>
          <button type="button" class="btn btn-sm btn-ghost" aria-haspopup="menu" onClick={(e) => openMenu(e.currentTarget as HTMLElement, folderItems(ids), { minWidth: 230 })}>
            <PxIcon name="folder-move" size={13} />
            Move to
          </button>
          <button type="button" class="btn btn-sm btn-ghost" aria-haspopup="menu" onClick={(e) => openMenu(e.currentTarget as HTMLElement, tagItems(ids), { minWidth: 220 })}>
            <PxIcon name="tag" size={13} />
            Tag
          </button>
          <button type="button" class="icon-btn" aria-label="Favourite" data-tip="Favourite" onClick={() => favorite(ids)}>
            <PxIcon name="star" size={15} />
          </button>
          <button
            type="button"
            class="icon-btn"
            aria-label="Download"
            data-tip="Download"
            onClick={() => ids.forEach((id, i) => setTimeout(() => {
              const a = liveAssets.value.find((x) => x.id === id);
              if (a) download(a);
            }, i * 250))}
          >
            <PxIcon name="download" size={15} />
          </button>
          <button type="button" class="icon-btn icon-danger" aria-label="Move to trash" data-tip="Trash" onClick={() => trash(ids)}>
            <PxIcon name="trash" size={15} />
          </button>
        </>
      )}
      <button type="button" class="icon-btn" aria-label="Clear the selection" onClick={() => (selection.value = [])}>
        <PxIcon name="x" size={13} />
      </button>
    </div>
  );
}

function FilterPills() {
  const pills: Array<{ label: string; color?: string; clear: () => void }> = [];
  for (const k of kindFilter.value) pills.push({ label: KIND_LABEL[k].many, clear: () => (kindFilter.value = kindFilter.value.filter((x) => x !== k)) });
  for (const t of toolFilter.value) pills.push({ label: t === ('import' as ToolId) ? 'Imported' : toolById(t).name, clear: () => (toolFilter.value = toolFilter.value.filter((x) => x !== t)) });
  for (const t of tagFilter.value) {
    const tag = tagById(t);
    if (tag) pills.push({ label: `#${tag.name}`, color: tag.color, clear: () => (tagFilter.value = tagFilter.value.filter((x) => x !== t)) });
  }
  if (query.value.trim()) pills.push({ label: `“${query.value.trim()}”`, clear: () => (query.value = '') });
  if (!pills.length) return null;
  return (
    <div class="pills">
      {pills.map((p) => (
        <button key={p.label} type="button" class="pill" onClick={() => transition(p.clear)} style={p.color ? ({ '--c': p.color } as Record<string, string>) : undefined}>
          {p.color && <span class="swatch" style={{ background: p.color }} />}
          {p.label}
          <PxIcon name="x" size={10} />
        </button>
      ))}
      <button
        type="button"
        class="link-btn"
        onClick={() =>
          transition(() => {
            kindFilter.value = [];
            toolFilter.value = [];
            tagFilter.value = [];
            query.value = '';
          })
        }
      >
        Clear all
      </button>
    </div>
  );
}

export function AssetsView() {
  const s = settings.value;
  const list = visible.value;
  const now = isBrowser ? Date.now() : 0;
  const file = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const sc = scope.value;
  const base = sc.type === 'trash' ? trashed.value : liveAssets.value;
  const kinds = kindFilter.value;
  const open = openAssetId.value;

  // keyboard: select all, clear, trash, favourite
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, .menu, .dialog')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selection.value = visible.value.map((a) => a.id);
      } else if (e.key === 'Escape' && !openAssetId.value) selection.value = [];
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.value.length && scope.value.type !== 'trash') trash(selection.value);
      else if (e.key.toLowerCase() === 'f' && selection.value.length && !e.metaKey && !e.ctrlKey) favorite(selection.value);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toolMenu = (el: HTMLElement) => {
    const on = toolFilter.value;
    const flip = (id: ToolId) => transition(() => (toolFilter.value = on.includes(id) ? on.filter((x) => x !== id) : [...on, id]));
    const items: MenuItem[] = [
      ...APP_TOOLS.filter((t) => t.id !== 'academy').map((t) => ({ label: t.name, checked: on.includes(t.id), keep: true, onSelect: () => flip(t.id) })),
      { separator: true },
      { label: 'Imported', checked: on.includes('import' as ToolId), keep: true, onSelect: () => flip('import' as ToolId) },
    ];
    openMenu(el, items, { minWidth: 220 });
  };
  const tagMenu = (el: HTMLElement) => {
    const on = tagFilter.value;
    openMenu(
      el,
      [
        { heading: 'Show assets with all of' },
        ...tags.value.map((t) => ({
          label: t.name,
          swatch: t.color,
          checked: on.includes(t.id),
          keep: true,
          onSelect: () => transition(() => (tagFilter.value = tagFilter.value.includes(t.id) ? tagFilter.value.filter((x) => x !== t.id) : [...tagFilter.value, t.id])),
        })),
      ],
      { minWidth: 220 },
    );
  };
  const sortMenu = (el: HTMLElement) =>
    openMenu(
      el,
      (
        [
          ['new', 'Newest first'],
          ['old', 'Oldest first'],
          ['name', 'Name'],
          ['tool', 'Tool'],
        ] as const
      ).map(([v, label]) => ({ label, checked: s.assetSort === v, onSelect: () => transition(() => patchSettings({ assetSort: v })) })),
      { align: 'end' },
    );

  const onFiles = async (files: File[]) => {
    const folderId = sc.type === 'folder' ? sc.id : null;
    const made = await importFiles(files, folderId);
    if (made.length) selection.value = made.map((a) => a.id);
  };

  return (
    <section
      class={cx('assets', dropping && 'is-dropping')}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as Element).contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files.length) return;
        e.preventDefault();
        setDropping(false);
        onFiles([...e.dataTransfer.files]);
      }}
    >
      <div class="assets-scroll">
        <header class="assets-head">
          <div class="assets-title">
            <Model3D model="reel" class="assets-reel">
              <PxIcon name="assets" size={34} />
            </Model3D>
            <div>
              <h1>{scopeTitle()}</h1>
              <p class="mono">
                {plural(list.length, 'asset')}
                {list.length !== base.length && ` of ${base.length}`}
                {sc.type === 'folder' && ' · drop files here to import into this folder'}
                {sc.type === 'trash' && ' · restore or delete for good'}
              </p>
            </div>
          </div>
          <div class="assets-actions">
            <label class="search assets-search">
              <PxIcon name="search" size={14} />
              <span class="sr-only">Search assets</span>
              <input type="search" placeholder="Search names, prompts, tags" value={query.value} onInput={(e) => (query.value = (e.currentTarget as HTMLInputElement).value)} />
              <kbd class="mono">/</kbd>
            </label>
            <input ref={file} type="file" multiple accept="image/*,video/*,audio/*" hidden onChange={(e) => {
              const input = e.currentTarget as HTMLInputElement;
              onFiles([...(input.files ?? [])]);
              input.value = '';
            }} />
            <button type="button" class="btn btn-primary btn-sm" onClick={() => file.current?.click()}>
              <PxIcon name="upload" size={13} />
              Import
            </button>
          </div>
        </header>

        <div class="assets-bar">
          <div class="chips kind-chips" role="group" aria-label="Type">
            <button type="button" class={cx('chip', !kinds.length && 'is-on')} aria-pressed={!kinds.length} onClick={() => transition(() => (kindFilter.value = []))}>
              All
              <span class="mono chip-n">{base.length}</span>
            </button>
            {KINDS.map((k) => {
              const n = base.filter((a) => a.kind === k).length;
              if (!n) return null;
              const on = kinds.includes(k as AssetKind);
              return (
                <button
                  key={k}
                  type="button"
                  class={cx('chip', on && 'is-on')}
                  aria-pressed={on}
                  onClick={() => transition(() => (kindFilter.value = on ? kinds.filter((x) => x !== k) : [...kinds, k as AssetKind]))}
                >
                  {KIND_LABEL[k].many}
                  <span class="mono chip-n">{n}</span>
                </button>
              );
            })}
          </div>
          <div class="assets-tools">
            <button type="button" class={cx('select select-compact', toolFilter.value.length && 'is-active')} aria-haspopup="menu" onClick={(e) => toolMenu(e.currentTarget as HTMLElement)}>
              <PxIcon name="tools" size={13} />
              <span class="select-value">Tool{toolFilter.value.length ? ` · ${toolFilter.value.length}` : ''}</span>
              <PxIcon name="chevron-down" size={11} class="select-caret" />
            </button>
            <button type="button" class={cx('select select-compact', tagFilter.value.length && 'is-active')} aria-haspopup="menu" onClick={(e) => tagMenu(e.currentTarget as HTMLElement)}>
              <PxIcon name="tag" size={13} />
              <span class="select-value">Tags{tagFilter.value.length ? ` · ${tagFilter.value.length}` : ''}</span>
              <PxIcon name="chevron-down" size={11} class="select-caret" />
            </button>
            <button type="button" class="select select-compact" aria-haspopup="menu" onClick={(e) => sortMenu(e.currentTarget as HTMLElement)}>
              <PxIcon name="sort" size={13} />
              <span class="select-value">{({ new: 'Newest', old: 'Oldest', name: 'Name', tool: 'Tool' } as const)[s.assetSort]}</span>
              <PxIcon name="chevron-down" size={11} class="select-caret" />
            </button>
            {s.assetLayout === 'grid' && (
              <Segmented
                size="sm"
                class="zoom-seg"
                label="Card size"
                value={String(s.assetZoom) as '0' | '1' | '2'}
                onChange={(v) => transition(() => patchSettings({ assetZoom: Number(v) }))}
                options={[
                  { value: '0', label: 'S' },
                  { value: '1', label: 'M' },
                  { value: '2', label: 'L' },
                ]}
              />
            )}
            <Segmented
              size="sm"
              label="Layout"
              value={s.assetLayout}
              onChange={(v) => transition(() => patchSettings({ assetLayout: v }))}
              options={[
                { value: 'grid', label: <span class="sr-only">Grid</span>, icon: 'grid' },
                { value: 'list', label: <span class="sr-only">List</span>, icon: 'list' },
              ]}
            />
          </div>
        </div>
        <FilterPills />

        {list.length === 0 ? (
          <div class="assets-empty">
            <Model3D model="reel" class="empty-reel">
              <PxIcon name="assets" size={48} />
            </Model3D>
            <h2>{sc.type === 'trash' ? 'The trash is empty' : base.length ? 'Nothing matches these filters' : 'Nothing here yet'}</h2>
            <p>
              {sc.type === 'trash'
                ? 'Deleted renders wait here until you restore them or delete them for good.'
                : sc.type === 'folder'
                  ? 'Drag renders onto this folder in the sidebar, or drop files here.'
                  : 'Render something in the chat or with a tool, or import your own files.'}
            </p>
          </div>
        ) : s.assetLayout === 'grid' ? (
          <ul class={cx('agrid', `zoom-${s.assetZoom}`)} aria-label="Assets">
            {list.map((a) => (
              <Card key={a.id} a={a} list={list} now={now} />
            ))}
          </ul>
        ) : (
          <ul class="alist" aria-label="Assets">
            <li class="arow arow-head mono" aria-hidden="true">
              <span />
              <span>Name</span>
              <span>Type</span>
              <span>Tool</span>
              <span>Folder</span>
              <span>Made</span>
              <span />
            </li>
            {list.map((a) => (
              <Row key={a.id} a={a} list={list} now={now} />
            ))}
          </ul>
        )}
      </div>
      <BulkBar />
      {dropping && (
        <div class="drop-overlay" aria-hidden="true">
          <PxIcon name="upload" size={36} />
          <p>Drop to import{sc.type === 'folder' ? ` into ${folderById(sc.id)?.name}` : ''}</p>
        </div>
      )}
      {open && <AssetDrawer id={open} list={list} />}
    </section>
  );
}
