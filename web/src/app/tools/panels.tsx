// Tools with their own controls: Storyboard, Soul, AI Cast, Canvas and Presets,
// plus the extras under the Canvas monitor.
import { useState } from 'preact/hooks';
import { draftText, forcedTool } from '../chat/actions';
import { DURATIONS, EMOTIONS, LOOKS, SOUL_PRESETS, ASPECTS } from '../data/options';
import { MODELS, modelById } from '../data/models';
import { MOVES, MOVE_GROUPS, type MoveGroup } from '../data/moves';
import { paletteFor } from '../lib/scenes';
import { copyText, cx, hash } from '../lib/util';
import { go } from '../router';
import { cast, setDraft } from '../store';
import { Field, Select, Toggle } from '../ui/controls';
import { PxIcon } from '../ui/icons';
import { Poster } from '../ui/Poster';
import { toast } from '../ui/toast';
import { MoveDiagram } from './MoveDiagram';
import { CANVAS_NODES, type Shot, type Values } from './recipes';

type Set = (key: string, value: unknown) => void;
const videoModels = MODELS.filter((m) => m.kind === 'video').map((m) => ({ value: m.id, label: m.name, hint: m.vendor }));

/* ------------------------------------------------------------------ */
/* Storyboard                                                          */
/* ------------------------------------------------------------------ */

export function StoryboardFields({ values, set }: { values: Values; set: Set }) {
  const shots = values.shots as Shot[];
  const update = (i: number, p: Partial<Shot>) => set('shots', shots.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => {
    const next = [...shots];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s);
    set('shots', next);
  };
  return (
    <>
      <Field label="Shot list" hint={`${shots.length} of 8`}>
        <ol class="shots">
          {shots.map((s, i) => (
            <li key={i} class="shot">
              <span class="shot-n mono">{String(i + 1).padStart(2, '0')}</span>
              <div class="shot-body">
                <textarea class="textarea shot-text" rows={2} value={s.prompt} aria-label={`Shot ${i + 1} prompt`} onInput={(e) => update(i, { prompt: (e.currentTarget as HTMLTextAreaElement).value })} />
                <div class="shot-opts">
                  <Select compact label={`Shot ${i + 1} model`} value={s.model} options={videoModels} onChange={(v) => update(i, { model: v })} />
                  <Select compact label={`Shot ${i + 1} length`} value={s.duration} options={DURATIONS} onChange={(v) => update(i, { duration: v })} />
                  <span class="shot-tools">
                    <button type="button" class="icon-btn icon-btn-sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <PxIcon name="chevron-up" size={12} />
                    </button>
                    <button type="button" class="icon-btn icon-btn-sm" aria-label="Move down" disabled={i === shots.length - 1} onClick={() => move(i, 1)}>
                      <PxIcon name="chevron-down" size={12} />
                    </button>
                    <button type="button" class="icon-btn icon-btn-sm" aria-label={`Remove shot ${i + 1}`} disabled={shots.length < 2} onClick={() => set('shots', shots.filter((_, j) => j !== i))}>
                      <PxIcon name="trash" size={12} />
                    </button>
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
        {shots.length < 8 && (
          <button type="button" class="move-add" onClick={() => set('shots', [...shots, { prompt: 'Close-up: ', model: 'wan-2.2', duration: '3 s' }])}>
            <PxIcon name="plus" size={12} />
            Add a shot
          </button>
        )}
      </Field>
      <div class="field-row">
        <Field label="Aspect">
          <Select label="Aspect" value={values.aspect} options={ASPECTS} onChange={(v) => set('aspect', v)} />
        </Field>
        <Field label="Look">
          <Select label="Look" value={values.look} options={LOOKS} onChange={(v) => set('look', v)} />
        </Field>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Soul                                                                */
/* ------------------------------------------------------------------ */

export function SoulFields({ values, set }: { values: Values; set: Set }) {
  const auto = paletteFor(String(values.sentence || 'palette'));
  const palette: string[] = values.palette?.length === 5 ? values.palette : auto;
  const locks: boolean[] = values.locks ?? [false, false, false, false, false];
  const shuffle = () => {
    const fresh = paletteFor(`${values.sentence} ${Math.random()}`);
    set(
      'palette',
      palette.map((c, i) => (locks[i] ? c : fresh[i])),
    );
  };
  return (
    <>
      <Field label="One sentence">
        <textarea class="textarea" rows={2} value={values.sentence} aria-label="One sentence" onInput={(e) => set('sentence', (e.currentTarget as HTMLTextAreaElement).value)} />
      </Field>
      <Field label="Five-colour palette" hint={values.palette?.length === 5 ? 'edited' : 'from the sentence'}>
        <div class="palette">
          {palette.map((c, i) => (
            <div key={i} class="pal">
              <label class="pal-swatch" style={{ background: c }}>
                <span class="sr-only">Colour {i + 1}</span>
                <input
                  type="color"
                  value={c.toLowerCase()}
                  onInput={(e) => set('palette', palette.map((x, j) => (j === i ? (e.currentTarget as HTMLInputElement).value.toUpperCase() : x)))}
                />
              </label>
              <button
                type="button"
                class="pal-hex mono"
                onClick={() => copyText(c).then(() => toast({ title: `${c} copied` }), () => {})}
                aria-label={`Copy ${c}`}
              >
                {c}
              </button>
              <button
                type="button"
                class={cx('pal-lock', locks[i] && 'is-on')}
                aria-pressed={locks[i]}
                aria-label={locks[i] ? `Unlock colour ${i + 1}` : `Lock colour ${i + 1}`}
                onClick={() => set('locks', locks.map((l, j) => (j === i ? !l : l)))}
              >
                <PxIcon name="lock" size={11} />
              </button>
            </div>
          ))}
        </div>
        <div class="palette-actions">
          <button type="button" class="btn btn-sm btn-ghost" onClick={shuffle}>
            <PxIcon name="refresh" size={12} />
            Shuffle unlocked
          </button>
          {values.palette?.length === 5 && (
            <button type="button" class="btn btn-sm btn-ghost" onClick={() => set('palette', [])}>
              From the sentence
            </button>
          )}
        </div>
      </Field>
      <Field label="Soul 2.0 preset">
        <div class="chips">
          {SOUL_PRESETS.map((p) => (
            <button key={p} type="button" class={cx('chip', values.preset === p && 'is-on')} aria-pressed={values.preset === p} onClick={() => set('preset', p)}>
              {p}
            </button>
          ))}
        </div>
      </Field>
      <div class="field-row">
        <Field label="Aspect">
          <Select label="Aspect" value={values.aspect} options={ASPECTS} onChange={(v) => set('aspect', v)} />
        </Field>
        <Field label="Open model">
          <Select label="Model" value={values.model} options={MODELS.filter((m) => m.kind === 'image').map((m) => ({ value: m.id, label: m.name }))} onChange={(v) => set('model', v)} />
        </Field>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* AI Cast                                                             */
/* ------------------------------------------------------------------ */

export function CastFields({ values, set }: { values: Values; set: Set }) {
  const tag = String(values.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return (
    <>
      <div class="field-row">
        <Field label="Name">
          <input class="input" value={values.name} maxLength={24} aria-label="Name" onInput={(e) => set('name', (e.currentTarget as HTMLInputElement).value)} />
        </Field>
        <Field label="Tag">
          <span class="input mono tag-preview">@{tag || 'name'}</span>
        </Field>
      </div>
      <Field label="Look">
        <textarea class="textarea" rows={3} value={values.look} aria-label="Look" onInput={(e) => set('look', (e.currentTarget as HTMLTextAreaElement).value)} />
      </Field>
      <Field label="Reference images" hint="up to 4">
        <div class="refs">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} class="ref">
              {i === 0 ? <Poster asset={{ id: `ref-${tag}`, scene: 'portrait', seed: hash(tag + 'ref'), kind: 'still' }} density={20} /> : <PxIcon name="plus" size={12} />}
            </span>
          ))}
        </div>
      </Field>
      <Toggle label="Lock the identity" sub="Same face in every emotion and every prompt" on={!!values.lock} onChange={(v) => set('lock', v)} />
      <Field label="Open model">
        <Select label="Model" value={values.model} options={MODELS.filter((m) => m.kind === 'image').map((m) => ({ value: m.id, label: m.name }))} onChange={(v) => set('model', v)} />
      </Field>
    </>
  );
}

/** Eight emotions of the character being built. */
export function EmotionSheet({ name, seed }: { name: string; seed: number }) {
  return (
    <div class="sheet">
      {EMOTIONS.map((e, i) => (
        <figure key={e} class="sheet-cell">
          <Poster asset={{ id: `sheet-${seed}-${i}`, scene: 'portrait', seed: seed + i * 31, kind: 'still' }} density={14} />
          <figcaption class="mono">{e}</figcaption>
        </figure>
      ))}
      <span class="sheet-name mono">{name || 'New character'} · 8 emotions</span>
    </div>
  );
}

export function CastList() {
  const list = cast.value;
  return (
    <section class="ws-extra">
      <header class="ws-extra-head">
        <h2>Your cast</h2>
        <span class="mono">{list.length} characters</span>
      </header>
      <ul class="cast-list">
        {list.map((c) => (
          <li key={c.id} class="cast-card">
            <span class="cast-face">
              <Poster asset={{ id: `cast-${c.id}`, scene: 'portrait', seed: c.seed, kind: 'still' }} density={16} />
            </span>
            <span class="cast-text">
              <b>{c.name}</b>
              <small class="mono">@{c.tag}</small>
            </span>
            <button type="button" class="icon-btn icon-btn-sm" aria-label={`Copy @${c.tag}`} data-tip="Copy tag" onClick={() => copyText(`@${c.tag}`).then(() => toast({ title: `@${c.tag} copied`, body: 'Drop it into any prompt.' }), () => {})}>
              <PxIcon name="copy" size={12} />
            </button>
            <button
              type="button"
              class="icon-btn icon-btn-sm"
              aria-label={`Use @${c.tag} in the chat`}
              data-tip="Use in chat"
              onClick={() => {
                draftText.value = `Slow push in on @${c.tag}, 85mm, f/1.8`;
                forcedTool.value = null;
                go({ view: 'chat' });
              }}
            >
              <PxIcon name="chat" size={12} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

const NODE_ORDER = ['prompt', 'still', 'reshoot', 'animate', 'upscale'];

export function CanvasFields({ values, set }: { values: Values; set: Set }) {
  const nodes = values.nodes as string[];
  return (
    <>
      <Field label="Prompt node">
        <textarea class="textarea" rows={3} value={values.prompt} aria-label="Prompt node" onInput={(e) => set('prompt', (e.currentTarget as HTMLTextAreaElement).value)} />
      </Field>
      <Field label="Nodes" hint={`${nodes.length} wired`}>
        <div class="node-toggles">
          {NODE_ORDER.slice(1).map((n) => (
            <Toggle
              key={n}
              label={CANVAS_NODES[n].label}
              sub={CANVAS_NODES[n].model ? modelById(CANVAS_NODES[n].model!).note : 'Interpolated to 60 fps'}
              on={nodes.includes(n)}
              onChange={(on) => set('nodes', NODE_ORDER.filter((x) => x === 'prompt' || (x === n ? on : nodes.includes(x))))}
            />
          ))}
        </div>
      </Field>
    </>
  );
}

export function NodeBoard({ nodes }: { nodes: string[] }) {
  return (
    <div class="board" aria-label={`Pipeline: ${nodes.map((n) => CANVAS_NODES[n].label).join(', then ')}`}>
      {nodes.map((n, i) => (
        <div key={n} class="node" style={{ '--i': i } as Record<string, number>}>
          <span class="node-port node-in" aria-hidden="true" />
          <span class="node-kind mono">{n === 'prompt' ? 'input' : CANVAS_NODES[n].model ? modelById(CANVAS_NODES[n].model!).vendor : 'post'}</span>
          <b>{CANVAS_NODES[n].label}</b>
          <span class="node-port node-out" aria-hidden="true" />
          {i < nodes.length - 1 && <span class="wire" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}

export function CanvasExtras() {
  return (
    <div class="ws-extra ws-extra-row">
      <button type="button" class="btn btn-sm btn-ghost" onClick={() => toast({ title: 'Graph saved', body: 'Find it under Canvas, ready to run again.' })}>
        <PxIcon name="download" size={12} />
        Save graph
      </button>
      <button
        type="button"
        class="btn btn-sm btn-ghost"
        onClick={() => copyText(location.href).then(() => toast({ title: 'Link copied', body: 'Share the graph with your team.' }), () => {})}
      >
        <PxIcon name="external" size={12} />
        Share with the team
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Presets: the move library                                           */
/* ------------------------------------------------------------------ */

export function Presets() {
  const [group, setGroup] = useState<MoveGroup | 'All'>('All');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = MOVES.filter((m) => (group === 'All' || m.group === group) && (!needle || `${m.name} ${m.prompt} ${m.group}`.toLowerCase().includes(needle)));
  const use = (id: string) => {
    setDraft('cinematic', 'moves', [id]);
    go({ view: 'tool', tool: 'cinematic' });
    toast({ title: `${MOVES.find((m) => m.id === id)!.name} is in your shot`, body: 'Cinematic, ready to render.' });
  };
  return (
    <div class="library">
      <div class="library-bar">
        <div class="chips">
          {(['All', ...MOVE_GROUPS] as const).map((g) => (
            <button key={g} type="button" class={cx('chip', group === g && 'is-on')} aria-pressed={group === g} onClick={() => setGroup(g)}>
              {g}
              <span class="mono chip-n">{g === 'All' ? MOVES.length : MOVES.filter((m) => m.group === g).length}</span>
            </button>
          ))}
        </div>
        <label class="search">
          <PxIcon name="search" size={14} />
          <span class="sr-only">Find a move</span>
          <input type="search" placeholder="Find a move" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>
      <ul class="moves-grid">
        {list.map((m) => (
          <li key={m.id} class="move-card">
            <MoveDiagram fx={m.fx} />
            <div class="move-body">
              <span class="move-group mono">{m.group}</span>
              <b>{m.name}</b>
              <p class="move-prompt mono">“{m.prompt}”</p>
            </div>
            <div class="move-actions">
              <button type="button" class="btn btn-sm btn-accent" onClick={() => use(m.id)}>
                Use in a shot
              </button>
              <button type="button" class="icon-btn icon-btn-sm" aria-label={`Copy the prompt of ${m.name}`} data-tip="Copy prompt" onClick={() => copyText(m.prompt).then(() => toast({ title: 'Prompt copied', body: m.name }), () => {})}>
                <PxIcon name="copy" size={12} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!list.length && <p class="empty-note">No move matches “{q}”.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Extras                                                              */
/* ------------------------------------------------------------------ */
