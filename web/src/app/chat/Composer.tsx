// The composer: attach a render, pick a tool or let Auto decide, add a camera move or a model,
// and see what the message will cost before you send it.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MOVES, MOVE_GROUPS } from '../data/moves';
import { MODELS } from '../data/models';
import { APP_TOOLS, toolById } from '../data/tools';
import { cx, transition } from '../lib/util';
import { assets, cast, chatById, activeChatId, liveAssets, settings, type Asset, type Message } from '../store';
import { Estimate } from '../ui/controls';
import { PxIcon, ToolIcon } from '../ui/icons';
import { openMenu, openDialog, type MenuItem } from '../ui/layers';
import { Poster } from '../ui/Poster';
import { attachment, draftText, forcedTool, send, thinking } from './actions';
import { interpret } from './engine';
import { importFiles } from '../assets/import';

const lastCall = (msgs: Message[] | undefined) => [...(msgs ?? [])].reverse().find((m) => m.call)?.call;

const PICKER_LIMIT = 24;

const matches = (a: Asset, q: string) => !q || a.name.toLowerCase().includes(q) || (a.prompt ?? '').toLowerCase().includes(q);

function AssetPicker({ close }: { close: () => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const found = liveAssets.value.filter((a) => (a.kind === 'video' || a.kind === 'still') && matches(a, q)).slice(0, PICKER_LIMIT);
  return (
    <div class="picker">
      <p class="dialog-text">The chat uses it as the source for Re-shoot, Edit, Upscale and Genjutsu.</p>
      <label class="search picker-search">
        <PxIcon name="search" size={14} />
        <span class="sr-only">Find a render</span>
        <input type="search" placeholder="Find a render by name or prompt" value={query} autoFocus onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} />
      </label>
      {found.length === 0 ? (
        <p class="picker-empty">{q ? `No render matches "${query.trim()}".` : 'No renders yet. Make one, or upload a file.'}</p>
      ) : (
        <ul class="picker-grid">
          {found.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                class="picker-item"
                onClick={() => {
                  attachment.value = a;
                  close();
                  document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
                }}
              >
                <Poster asset={a} density={50} />
                <span>{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const pickAsset = () => openDialog({ title: 'Attach a render', wide: true, body: (close) => <AssetPicker close={close} /> });

export function Composer({ docked }: { docked?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const text = draftText.value;
  const [preview, setPreview] = useState<{ tool: string; runtime: number; credits: number } | null>(null);
  const busy = !!thinking.value;
  const forced = forcedTool.value;
  const att = attachment.value;

  // autosize
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(220, el.scrollHeight)}px`;
  }, [text]);

  // the live estimate: what this message would set up, before it is sent
  useEffect(() => {
    const t = setTimeout(() => {
      // a language model may well pick something else: the rules only guess for themselves
      if (text.trim().length < 6 || settings.value.assistant !== 'builtin') return setPreview(null);
      const chat = chatById(activeChatId.value);
      const pool = att ? [{ ...att, createdAt: Date.now() }, ...assets.value] : assets.value;
      const prompt = forced ? `use ${toolById(forced).name}: ${text}` : text;
      const r = interpret(prompt, { assets: pool, cast: cast.value, last: lastCall(chat?.messages) });
      setPreview(r.call ? { tool: toolById(r.call.tool).name, runtime: r.call.estimate.runtime, credits: r.call.estimate.credits } : null);
    }, 160);
    return () => clearTimeout(t);
  }, [text, forced, att?.id]);

  const submit = () => {
    if (!text.trim() || busy) return;
    // from the welcome screen the composer travels down to the thread's dock
    if (docked) send(text);
    else transition(() => send(text));
    setPreview(null);
  };

  const toolMenu = (el: HTMLElement) => {
    const items: MenuItem[] = [
      { label: 'Auto: the chat picks', icon: 'wand', checked: !forced, onSelect: () => (forcedTool.value = null) },
      { separator: true },
      { heading: 'Core' },
      ...APP_TOOLS.filter((t) => !t.studio && t.id !== 'academy').map((t) => ({ label: t.name, checked: forced === t.id, onSelect: () => (forcedTool.value = t.id) })),
      { heading: 'Studios' },
      ...APP_TOOLS.filter((t) => t.studio).map((t) => ({ label: t.name, checked: forced === t.id, onSelect: () => (forcedTool.value = t.id) })),
    ];
    openMenu(el, items, { minWidth: 240 });
  };

  const insert = (words: string) => {
    const cur = draftText.value.trim();
    draftText.value = cur ? `${cur.replace(/[.,]$/, '')}, ${words}` : words.charAt(0).toUpperCase() + words.slice(1);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const moveMenu = (el: HTMLElement) =>
    openMenu(
      el,
      MOVE_GROUPS.map((g) => ({
        label: g,
        items: MOVES.filter((m) => m.group === g).map((m) => ({ label: m.name, hint: m.fx.replace('-', ' '), onSelect: () => insert(m.name.toLowerCase()) })),
      })),
      { minWidth: 220 },
    );

  const modelMenu = (el: HTMLElement) =>
    openMenu(
      el,
      [
        { heading: 'Video' },
        ...MODELS.filter((m) => m.kind === 'video').map((m) => ({ label: m.name, hint: m.vendor, onSelect: () => insert(`on ${m.name}`) })),
        { heading: 'Stills and edits' },
        ...MODELS.filter((m) => m.kind !== 'video').map((m) => ({ label: m.name, hint: m.vendor, onSelect: () => insert(`on ${m.name}`) })),
      ],
      { minWidth: 240 },
    );

  const attachMenu = (el: HTMLElement) =>
    openMenu(el, [
      { label: 'A render from Assets…', icon: 'assets', onSelect: pickAsset },
      { label: 'Upload an image or clip…', icon: 'upload', onSelect: () => file.current?.click() },
    ]);

  const placeholder = useMemo(
    () => (forced ? `Describe it, ${toolById(forced).name} runs it…` : docked ? 'Change one thing, or describe the next shot…' : 'Describe a shot, Kinemi picks the tool…'),
    [forced, docked],
  );

  return (
    <form
      class={cx('composer', docked && 'is-docked', busy && 'is-busy')}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        ref={file}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={async (e) => {
          const input = e.currentTarget as HTMLInputElement;
          const made = await importFiles([...(input.files ?? [])]);
          if (made[0]) attachment.value = made[0];
          input.value = '';
        }}
      />
      {att && (
        <div class="composer-attach">
          <span class="attach-thumb">
            <Poster asset={att} density={30} />
            <button type="button" class="attach-x" aria-label="Remove the attachment" onClick={() => (attachment.value = null)}>
              <PxIcon name="x" size={12} />
            </button>
          </span>
          <span class="attach-name">{att.name}</span>
        </div>
      )}
      <div class="composer-row">
        <button type="button" class="icon-btn composer-plus" aria-label="Attach a render or a file" data-tip="Attach" onClick={(e) => attachMenu(e.currentTarget as HTMLElement)}>
          <PxIcon name="plus" size={16} />
        </button>
        <label class="sr-only" for="composer-input">
          Message the Kinemi chat
        </label>
        <textarea
          id="composer-input"
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          onInput={(e) => (draftText.value = (e.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <div class="composer-bar">
        <div class="composer-tools">
          <button type="button" class={cx('chip-btn', forced && 'is-forced')} aria-haspopup="menu" onClick={(e) => toolMenu(e.currentTarget as HTMLElement)}>
            {forced ? <ToolIcon id={forced} size={14} /> : <PxIcon name="wand" size={14} />}
            <span>{forced ? toolById(forced).name : 'Auto'}</span>
            <PxIcon name="chevron-down" size={10} />
          </button>
          <button type="button" class="icon-btn" aria-label="Add a camera move" data-tip="60 camera moves" onClick={(e) => moveMenu(e.currentTarget as HTMLElement)}>
            <PxIcon name="camera" size={15} />
          </button>
          <button type="button" class="icon-btn" aria-label="Pick an open model" data-tip="Open models" onClick={(e) => modelMenu(e.currentTarget as HTMLElement)}>
            <PxIcon name="cube" size={15} />
          </button>
        </div>
        <div class="composer-send">
          {preview && (
            <span class="composer-preview">
              <span class="mono">{preview.tool}</span>
              <Estimate runtime={preview.runtime} credits={preview.credits} />
            </span>
          )}
          <button type="submit" class="btn btn-accent send-btn" aria-label="Send" data-tip="Send" disabled={!text.trim() || busy}>
            <PxIcon name="send" size={15} />
          </button>
        </div>
      </div>
    </form>
  );
}
