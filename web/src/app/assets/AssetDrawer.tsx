// One asset up close: preview, rename, folder, tags, details, the prompt, and what to do next.
import { useEffect, useRef, useState } from 'preact/hooks';
import { openChat } from '../chat/actions';
import { modelById } from '../data/models';
import { KIND_LABEL, toolById } from '../data/tools';
import { copyText, cx, fullDate, timecode } from '../lib/util';
import { assetById, createTag, folderById, folders, openAssetId, renameAsset, tags, toggleTag, type Asset } from '../store';
import { PxIcon, ToolIcon } from '../ui/icons';
import { openMenu } from '../ui/layers';
import { Poster } from '../ui/Poster';
import { toast } from '../ui/toast';
import { assetMenu, destroy, download, favorite, moveTo, newFolderWith, openInTool, restore, sendToChat, trash, useAsSource } from './actions';

/** Playback: a running timecode and a slow push on the poster. */
function Playback({ a, onProgress }: { a: Asset; onProgress: (p: number) => void }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const total = a.duration ?? 5;
  useEffect(() => onProgress(t / total), [t]);
  useEffect(() => {
    if (!playing) return;
    const t0 = performance.now() - t * 1000;
    let raf = 0;
    const step = (now: number) => {
      const s = (now - t0) / 1000;
      if (s >= total) {
        setT(0);
        setPlaying(false);
        return;
      }
      setT(s);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return (
    <div class="playback">
      <button type="button" class="icon-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>
        <PxIcon name={playing ? 'pause' : 'play'} size={14} />
      </button>
      <span class="playback-track" aria-hidden="true">
        <span style={{ width: `${(t / total) * 100}%` }} />
      </span>
      <span class="mono">
        {timecode(t)} / {timecode(total)}
      </span>
    </div>
  );
}

function TagEditor({ a }: { a: Asset }) {
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const own = a.tagIds.map((id) => tags.value.find((t) => t.id === id)).filter(Boolean) as typeof tags.value;
  const needle = q.trim().toLowerCase();
  const suggestions = tags.value.filter((t) => !a.tagIds.includes(t.id) && (!needle || t.name.includes(needle))).slice(0, 6);
  const exact = tags.value.find((t) => t.name === needle);
  const add = (id: string) => {
    toggleTag([a.id], id, true);
    setQ('');
    input.current?.focus();
  };
  return (
    <div class="tag-editor">
      <div class="tag-list">
        {own.map((t) => (
          <span key={t.id} class="tag-chip" style={{ '--c': t.color } as Record<string, string>}>
            <span class="swatch" style={{ background: t.color }} />
            {t.name}
            <button type="button" aria-label={`Remove ${t.name}`} onClick={() => toggleTag([a.id], t.id, false)}>
              <PxIcon name="x" size={9} />
            </button>
          </span>
        ))}
        <input
          ref={input}
          class="tag-input"
          value={q}
          placeholder={own.length ? 'Add a tag…' : 'Add tags…'}
          aria-label="Add a tag"
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && needle) {
              e.preventDefault();
              add(exact?.id ?? createTag(needle).id);
            } else if (e.key === 'Backspace' && !q && own.length) toggleTag([a.id], own[own.length - 1].id, false);
            else if (e.key === 'Escape') {
              // first clear what is typed, then close the drawer
              if (q) setQ('');
              else openAssetId.value = null;
            }
          }}
        />
      </div>
      {(suggestions.length > 0 || (needle && !exact)) && (
        <div class="tag-suggest">
          {suggestions.map((t) => (
            <button key={t.id} type="button" class="chip" onClick={() => add(t.id)}>
              <span class="swatch" style={{ background: t.color }} />
              {t.name}
            </button>
          ))}
          {needle && !exact && (
            <button type="button" class="chip" onClick={() => add(createTag(needle).id)}>
              <PxIcon name="plus" size={10} />
              Create “{needle}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AssetDrawer({ id, list }: { id: string; list: Asset[] }) {
  const a = assetById(id);
  const [editing, setEditing] = useState(false);
  const [play, setPlay] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const idx = list.findIndex((x) => x.id === id);

  useEffect(() => {
    if (!a) openAssetId.value = null;
  }, [a]);

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, .menu, .dialog')) return;
      if (e.key === 'Escape') openAssetId.value = null;
      if (e.key === 'ArrowRight' && idx < list.length - 1) openAssetId.value = list[idx + 1].id;
      if (e.key === 'ArrowLeft' && idx > 0) openAssetId.value = list[idx - 1].id;
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      back?.focus?.({ preventScroll: true });
    };
  }, [idx, list.length]);

  if (!a) return null;
  const tool = toolById(a.tool);
  const folder = folderById(a.folderId);
  const details: Array<[string, string]> = [
    ['Type', `${KIND_LABEL[a.kind].one}${a.duration ? ` · ${a.duration} s` : ''}`],
    ['Made with', a.source === 'import' ? 'Imported file' : tool.name],
    ...(a.model ? ([['Model', `${modelById(a.model).name} · ${modelById(a.model).vendor}`]] as Array<[string, string]>) : []),
    ['Aspect', a.aspect],
    ...(a.runtime ? ([['Runtime', `${a.runtime} s on the GPU`]] as Array<[string, string]>) : []),
    ...(a.credits ? ([['Credits', String(a.credits)]] as Array<[string, string]>) : []),
    ...(a.file ? ([['File', `${a.file.type} · ${(a.file.size / 1024 / 1024).toFixed(1)} MB`]] as Array<[string, string]>) : []),
    ['Made', fullDate(a.createdAt)],
  ];

  return (
    <div class="drawer-wrap" onPointerDown={(e) => e.target === e.currentTarget && (openAssetId.value = null)}>
      <aside ref={ref} class="drawer" role="dialog" aria-modal="false" aria-label={a.name} tabIndex={-1}>
        <header class="drawer-head">
          <span class="drawer-tool mono">
            {a.source === 'import' ? <PxIcon name="upload" size={13} /> : <ToolIcon id={a.tool} size={14} />}
            {a.source === 'import' ? 'Imported' : tool.name}
          </span>
          <span class="drawer-nav">
            <button type="button" class="icon-btn icon-btn-sm" aria-label="Previous asset" disabled={idx <= 0} onClick={() => (openAssetId.value = list[idx - 1].id)}>
              <PxIcon name="chevron-left" size={12} />
            </button>
            <span class="mono">
              {idx + 1} / {list.length}
            </span>
            <button type="button" class="icon-btn icon-btn-sm" aria-label="Next asset" disabled={idx < 0 || idx >= list.length - 1} onClick={() => (openAssetId.value = list[idx + 1].id)}>
              <PxIcon name="chevron-right" size={12} />
            </button>
            <button type="button" class="icon-btn" aria-label="Close" onClick={() => (openAssetId.value = null)}>
              <PxIcon name="x" size={14} />
            </button>
          </span>
        </header>

        <div class="drawer-scroll">
          <div class="drawer-preview" style={{ aspectRatio: a.aspect.replace(':', ' / '), '--p': play } as Record<string, string | number>}>
            {a.url && a.media === 'video' ? (
              <video class="poster poster-file" src={a.url} controls playsInline preload="metadata" aria-label={a.name} />
            ) : (
              <Poster asset={a} density={130} alt={a.name} />
            )}
            <span class="drawer-badge mono">{a.file ? 'Your file' : a.model ? modelById(a.model).name : tool.name}</span>
            <i class="vf vf-tl" aria-hidden="true" />
            <i class="vf vf-tr" aria-hidden="true" />
            <i class="vf vf-bl" aria-hidden="true" />
            <i class="vf vf-br" aria-hidden="true" />
          </div>
          {a.url && a.media === 'audio' && <audio class="drawer-audio" src={a.url} controls preload="metadata" aria-label={a.name} />}
          {(a.kind === 'video' || a.kind === 'audio') && !a.file && !a.url && <Playback key={a.id} a={a} onProgress={setPlay} />}

          <div class="drawer-title">
            {editing ? (
              <input
                class="input"
                value={a.name}
                autofocus
                aria-label="Name"
                onBlur={(e) => {
                  renameAsset(a.id, (e.currentTarget as HTMLInputElement).value);
                  setEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEditing(false);
                }}
              />
            ) : (
              <h2>
                <button type="button" class="title-btn" onClick={() => setEditing(true)} title="Rename">
                  {a.name}
                  <PxIcon name="pencil" size={12} />
                </button>
              </h2>
            )}
          </div>

          <div class="drawer-actions">
            {a.trashedAt ? (
              <>
                <button type="button" class="btn btn-sm btn-ghost" onClick={() => restore([a.id])}>
                  <PxIcon name="restore" size={13} />
                  Restore
                </button>
                <button type="button" class="btn btn-sm btn-danger" onClick={() => destroy([a.id])}>
                  Delete forever
                </button>
              </>
            ) : (
              <>
                <button type="button" class={cx('btn btn-sm btn-ghost', a.favorite && 'is-fav')} aria-pressed={a.favorite} onClick={() => favorite([a.id])}>
                  <PxIcon name="star" size={13} />
                  Favourite
                </button>
                <button type="button" class="btn btn-sm btn-ghost" onClick={() => download(a)}>
                  <PxIcon name="download" size={13} />
                  Download
                </button>
                <button type="button" class="btn btn-sm btn-ghost" onClick={() => sendToChat(a)}>
                  <PxIcon name="chat" size={13} />
                  Use in chat
                </button>
                <button type="button" class="icon-btn" aria-label="More actions" onClick={(e) => openMenu(e.currentTarget as HTMLElement, assetMenu(a), { align: 'end' })}>
                  <PxIcon name="more" size={15} />
                </button>
              </>
            )}
          </div>

          {!a.trashedAt && (
            <>
              <section class="drawer-sec">
                <h3 class="mono">Folder</h3>
                <button
                  type="button"
                  class="select"
                  aria-haspopup="menu"
                  onClick={(e) =>
                    openMenu(
                      e.currentTarget as HTMLElement,
                      [
                        { label: 'Unsorted', icon: 'inbox', checked: !a.folderId, onSelect: () => moveTo([a.id], null) },
                        ...folders.value.map((f) => ({ label: f.name, icon: 'folder' as const, checked: a.folderId === f.id, onSelect: () => moveTo([a.id], f.id) })),
                        { separator: true },
                        { label: 'New folder…', icon: 'folder-plus', onSelect: () => newFolderWith([a.id]) },
                      ],
                    )
                  }
                >
                  <PxIcon name={folder ? 'folder' : 'inbox'} size={14} />
                  <span class="select-value">{folder?.name ?? 'Unsorted'}</span>
                  <PxIcon name="chevron-down" size={12} class="select-caret" />
                </button>
              </section>
              <section class="drawer-sec">
                <h3 class="mono">Tags</h3>
                <TagEditor a={a} />
              </section>
              <section class="drawer-sec">
                <h3 class="mono">Next</h3>
                <div class="next-grid">
                  {a.source !== 'import' && (
                    <button type="button" class="next" onClick={() => openInTool(a)}>
                      <ToolIcon id={a.tool === 'presets' ? 'cinematic' : a.tool} size={16} />
                      Open in {toolById(a.tool === 'presets' ? 'cinematic' : a.tool).name}
                    </button>
                  )}
                  {(a.kind === 'still' || a.kind === 'video') && (
                    <button type="button" class="next" onClick={() => useAsSource(a, 'reshoot')}>
                      <ToolIcon id="reshoot" size={16} />
                      Re-shoot an angle
                    </button>
                  )}
                  {a.kind === 'video' && (
                    <button type="button" class="next" onClick={() => useAsSource(a, 'edit')}>
                      <ToolIcon id="edit" size={16} />
                      Edit the clip
                    </button>
                  )}
                  {(a.kind === 'video' || a.kind === 'still') && (
                    <button type="button" class="next" onClick={() => useAsSource(a, 'upscale')}>
                      <ToolIcon id="upscale" size={16} />
                      Upscale to 4K
                    </button>
                  )}
                </div>
              </section>
            </>
          )}

          <section class="drawer-sec">
            <h3 class="mono">Details</h3>
            <dl class="details">
              {details.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              {a.chatId && (
                <div>
                  <dt>From</dt>
                  <dd>
                    <button type="button" class="link-btn" onClick={() => openChat(a.chatId!)}>
                      The chat that made it
                      <PxIcon name="arrow-right" size={10} />
                    </button>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {a.params && a.params.length > 0 && (
            <section class="drawer-sec">
              <h3 class="mono">Settings</h3>
              <dl class="call-params">
                {a.params.map(([k, v]) => (
                  <div key={k} class="param">
                    <dt class="mono">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {a.prompt && (
            <section class="drawer-sec">
              <h3 class="mono">The prompt it wrote</h3>
              <div class="prompt-box">
                <pre class="mono">{a.prompt}</pre>
                <button type="button" class="icon-btn icon-btn-sm" aria-label="Copy the prompt" onClick={() => copyText(a.prompt!).then(() => toast({ title: 'Prompt copied' }), () => {})}>
                  <PxIcon name="copy" size={12} />
                </button>
              </div>
            </section>
          )}

          {!a.trashedAt && (
            <button type="button" class="btn btn-sm btn-ghost drawer-trash" onClick={() => trash([a.id])}>
              <PxIcon name="trash" size={13} />
              Move to trash
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
