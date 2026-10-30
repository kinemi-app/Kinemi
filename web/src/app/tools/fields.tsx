// Renders a tool's controls from its schema.
import { EMOTIONS } from '../data/options';
import { MODELS, modelById } from '../data/models';
import { moveById } from '../data/moves';
import type { AssetKind } from '../data/tools';
import { cx } from '../lib/util';
import { cast, liveAssets, settings, type Asset } from '../store';
import { Field, Segmented, Select, Slider, Toggle } from '../ui/controls';
import { PxIcon } from '../ui/icons';
import { openDialog } from '../ui/layers';
import { Poster } from '../ui/Poster';
import { AspectCards, BodyCards, fovOf, LookCards, MovePad, Optics } from './camera-controls';
import { latest, type Values } from './recipes';
import type { FieldDef } from './schemas';

type Set = (key: string, value: unknown) => void;

function pickSource(kinds: AssetKind[], onPick: (a: Asset) => void) {
  openDialog({
    title: 'Pick a source',
    wide: true,
    body: (close) => {
      const list = liveAssets.value.filter((a) => kinds.includes(a.kind));
      return (
        <div class="picker">
          {list.length === 0 && <p class="dialog-text">Nothing to pick yet. Render a shot first, or import one in Assets.</p>}
          <ul class="picker-grid">
            {list.slice(0, 30).map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  class="picker-item"
                  onClick={() => {
                    onPick(a);
                    close();
                  }}
                >
                  <Poster asset={a} density={50} />
                  <span>{a.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      );
    },
  });
}

function SourceField({ def, values, set }: { def: Extract<FieldDef, { type: 'source' }>; values: Values; set: Set }) {
  const chosen = (values[def.key] && liveAssets.value.find((a) => a.id === values[def.key])) || latest({ assets: liveAssets.value, cast: [] }, def.kinds);
  return (
    <Field label={def.label} hint={values[def.key] ? 'picked' : 'newest'}>
      <div class="source">
        <span class="source-thumb">{chosen ? <Poster asset={chosen} density={40} /> : <PxIcon name="image" size={20} />}</span>
        <span class="source-text">
          <b>{chosen?.name ?? 'Nothing yet'}</b>
          <small class="mono">{chosen ? `${chosen.kind} · ${chosen.aspect}${chosen.duration ? ` · ${chosen.duration} s` : ''}` : 'render or import one first'}</small>
        </span>
        <button type="button" class="btn btn-sm btn-ghost" onClick={() => pickSource(def.kinds, (a) => set(def.key, a.id))}>
          Change
        </button>
      </div>
    </Field>
  );
}

function EmotionWheel({ values, set }: { values: Values; set: Set }) {
  const from = values.from as string;
  const to = values.to as string;
  return (
    <div class="wheel-wrap">
      <div class="wheel" role="group" aria-label="Emotion wheel: pick where the performance starts and ends">
        {EMOTIONS.map((e, i) => {
          const a = (i / EMOTIONS.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <button
              key={e}
              type="button"
              class={cx('wheel-btn', e === from && 'is-from', e === to && 'is-to')}
              style={{ left: `${50 + Math.cos(a) * 39}%`, top: `${50 + Math.sin(a) * 39}%` }}
              aria-pressed={e === from || e === to}
              onClick={() => {
                if (e === from) return;
                if (e === to) {
                  set('to', from);
                  set('from', e);
                  return;
                }
                set('from', to);
                set('to', e);
              }}
            >
              {e}
            </button>
          );
        })}
        <span class="wheel-core mono">
          {from}
          <b>→</b>
          {to}
        </span>
      </div>
      <p class="field-note">Click an emotion to end on it; the last one becomes the start.</p>
    </div>
  );
}

export function FieldView({ def, values, set }: { def: FieldDef; values: Values; set: Set }) {
  switch (def.type) {
    case 'group':
      return (
        <div class="field-group">
          <span class="mono">{def.label}</span>
        </div>
      );
    case 'row':
      return (
        <div class="field-row">
          {def.fields.map((f, i) => (
            <FieldView key={i} def={f} values={values} set={set} />
          ))}
        </div>
      );
    case 'text':
      return (
        <Field label={def.label} hint={def.hint}>
          <input class="input" value={String(values[def.key] ?? '')} placeholder={def.placeholder} onInput={(e) => set(def.key, (e.currentTarget as HTMLInputElement).value)} />
        </Field>
      );
    case 'textarea':
      return (
        <Field label={def.label} hint={def.hint}>
          <textarea class="textarea" rows={def.rows ?? 3} value={String(values[def.key] ?? '')} placeholder={def.placeholder} aria-label={def.label} onInput={(e) => set(def.key, (e.currentTarget as HTMLTextAreaElement).value)} />
        </Field>
      );
    case 'select':
      return (
        <Field label={def.label} hint={def.hint}>
          <Select label={def.label} value={String(values[def.key])} options={def.options} onChange={(v) => set(def.key, v)} />
        </Field>
      );
    case 'seg':
      return (
        <Field label={def.label} hint={def.hint}>
          <Segmented label={def.label} value={String(values[def.key])} options={def.options} onChange={(v) => set(def.key, v)} class="seg-block" />
        </Field>
      );
    case 'chips':
      return (
        <Field label={def.label} hint={def.hint}>
          <div class="chips" role="radiogroup" aria-label={def.label}>
            {def.options.map((o) => (
              <button key={o} type="button" role="radio" aria-checked={values[def.key] === o} class={cx('chip', values[def.key] === o && 'is-on')} onClick={() => set(def.key, o)}>
                {o}
              </button>
            ))}
          </div>
        </Field>
      );
    case 'slider':
      return (
        <Field label={def.label} hint={def.hint}>
          <Slider
            label={def.label}
            value={Number(values[def.key] ?? def.min)}
            min={def.min}
            max={def.max}
            step={def.step}
            marks={def.marks}
            format={(v) => `${v}${def.unit ?? ''}`}
            onChange={(v) => set(def.key, v)}
          />
        </Field>
      );
    case 'toggle':
      return <Toggle label={def.label} sub={def.sub} on={!!values[def.key]} onChange={(v) => set(def.key, v)} />;
    case 'model': {
      // models hidden in Settings → Models stay out, unless this shot already uses one
      const hidden = settings.value.hiddenModels;
      const list = MODELS.filter((m) => def.kinds.includes(m.kind) && (!hidden.includes(m.id) || m.id === values[def.key]));
      return (
        <Field label={def.label} hint={modelById(String(values[def.key])).vendor}>
          <Select
            label={def.label}
            value={String(values[def.key])}
            options={list.map((m) => ({ value: m.id, label: m.name, hint: m.vendor }))}
            onChange={(v) => set(def.key, v)}
            icon="cube"
          />
          <p class="field-note">{modelById(String(values[def.key])).note}</p>
        </Field>
      );
    }
    case 'movepad': {
      const v = values[def.key];
      const ids = def.single ? [String(v)] : ((v as string[]) ?? []);
      return (
        <Field label={def.label} hint={def.single ? moveById(String(v))?.group : def.hint}>
          <MovePad value={ids} single={def.single} lens={String(values.lens ?? '35mm')} onChange={(next) => set(def.key, def.single ? next[0] : next)} />
        </Field>
      );
    }
    case 'optics':
      return (
        <Field label={def.label} hint={`${fovOf(String(values.lens))}° field of view`}>
          <Optics
            lens={String(values.lens)}
            aperture={def.aperture ? String(values.aperture) : undefined}
            look={values.look ? String(values.look) : undefined}
            lenses={def.lenses}
            onLens={(v) => set('lens', v)}
            onAperture={(v) => set('aperture', v)}
          />
        </Field>
      );
    case 'body':
      return (
        <Field label={def.label} hint={String(values[def.key])}>
          <BodyCards value={String(values[def.key])} set={(v) => set(def.key, v)} />
        </Field>
      );
    case 'look':
      return (
        <Field label={def.label} hint={String(values[def.key])}>
          <LookCards value={String(values[def.key])} set={(v) => set(def.key, v)} />
        </Field>
      );
    case 'aspect':
      return (
        <Field label={def.label} hint={String(values[def.key])}>
          <AspectCards value={String(values[def.key])} set={(v) => set(def.key, v)} />
        </Field>
      );
    case 'source':
      return <SourceField def={def} values={values} set={set} />;
    case 'cast':
      return (
        <Field label={def.label}>
          <Select
            label={def.label}
            value={String(values[def.key] ?? '')}
            options={[{ value: '', label: def.none }, ...cast.value.map((c) => ({ value: c.id, label: `${c.name} · @${c.tag}` }))]}
            onChange={(v) => set(def.key, v)}
            icon="user"
          />
        </Field>
      );
    case 'emotions':
      return (
        <Field label={def.label} hint={`${values.from} → ${values.to}`}>
          <EmotionWheel values={values} set={set} />
        </Field>
      );
  }
}
