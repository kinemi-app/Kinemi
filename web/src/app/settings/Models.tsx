// Settings → Models: the default models, which ones the pickers show, and the files ComfyUI loads.
import { useState } from 'preact/hooks';
import { checkFiles, type Check, type FileState } from '../compute';
import { FOLDERS, MODEL_FILES, type ModelFile } from '../data/model-files';
import { MODELS, modelById } from '../data/models';
import { cx } from '../lib/util';
import { patchSettings, settings } from '../store';
import { Select, Toggle } from '../ui/controls';
import { PxIcon } from '../ui/icons';
import { Card, Chip, Result, Row } from './parts';

const nameOf = (f: ModelFile) => settings.value.files[f.id]?.trim() || f.id;

function Defaults() {
  const s = settings.value;
  const pick = (kind: 'video' | 'image') => MODELS.filter((m) => m.kind === kind).map((m) => ({ value: m.id, label: m.name, hint: m.vendor }));
  return (
    <Card id="defaults" title="New shots start with" desc="The model a tool picks when you open it fresh. Every tool can still switch.">
      <Row label="Video model" desc={modelById(s.videoModel).note}>
        <Select label="Video model" value={s.videoModel} options={pick('video')} onChange={(v) => patchSettings({ videoModel: v })} icon="video" class="set-select" />
      </Row>
      <Row label="Image model" desc={modelById(s.imageModel).note}>
        <Select label="Image model" value={s.imageModel} options={pick('image')} onChange={(v) => patchSettings({ imageModel: v })} icon="image" class="set-select" />
      </Row>
    </Card>
  );
}

function Pickers() {
  const hidden = settings.value.hiddenModels;
  return (
    <Card id="pickers" title="Models in the pickers" desc="Hide the ones you don’t have, or may not use. Licenses change: the model card is what counts.">
      <ul class="set-models">
        {MODELS.map((m) => {
          const on = !hidden.includes(m.id);
          return (
            <li key={m.id} class={cx('set-model', !on && 'is-off')}>
              <Toggle
                label={m.name}
                sub={`${m.vendor} · ${m.kind === 'edit' ? 'image edit' : m.kind} · ${m.note}`}
                on={on}
                onChange={(v) => patchSettings({ hiddenModels: v ? hidden.filter((x) => x !== m.id) : [...hidden, m.id] })}
              />
              <span class="set-license">
                <a href={m.license.url} target="_blank" rel="noopener noreferrer" class="set-chip is-info">
                  {m.license.name}
                  <PxIcon name="external" size={10} />
                </a>
                {m.license.note && <small>{m.license.note}</small>}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const STATE: Record<FileState['state'], { tone: 'ok' | 'bad' | 'warn'; label: string }> = {
  found: { tone: 'ok', label: 'Found' },
  missing: { tone: 'bad', label: 'Missing' },
  'no-node': { tone: 'warn', label: 'Node not installed' },
};

function Files() {
  const s = settings.value;
  const [found, setFound] = useState<Record<string, FileState> | null>(null);
  const [check, setCheck] = useState<Check | null | 'busy'>(null);
  const renamed = Object.values(s.files).filter((v) => v?.trim()).length;
  const setName = (id: string, v: string) => {
    const files = { ...settings.value.files };
    if (!v.trim() || v.trim() === id) delete files[id];
    else files[id] = v.trim();
    patchSettings({ files });
  };
  const run = async () => {
    setCheck('busy');
    const r = await checkFiles(s.endpoint ?? '', MODEL_FILES, nameOf);
    if ('ok' in r && typeof r.ok === 'boolean') {
      setCheck(r as Check);
      return;
    }
    const states = r as Record<string, FileState>;
    setFound(states);
    const missing = Object.values(states).filter((x) => x.state !== 'found').length;
    setCheck({ ok: true, title: missing ? `${MODEL_FILES.length - missing} of ${MODEL_FILES.length} files found` : 'Every file is there', lines: [missing ? 'The missing ones are marked below.' : 'Your ComfyUI has every model file Kinemi’s graphs load.'] });
  };

  return (
    <Card
      id="files"
      title="Model files"
      desc="The file each loader node asks ComfyUI for. The names follow ComfyUI’s example workflows; change one to match the file on your machine and the Comfy graph and its API JSON use it."
      aside={
        renamed ? (
          <button type="button" class="btn btn-sm btn-ghost" onClick={() => patchSettings({ files: {} })}>
            Reset {renamed} {renamed === 1 ? 'name' : 'names'}
          </button>
        ) : undefined
      }
    >
      <div class="set-actions">
        <button type="button" class="btn btn-sm btn-ghost" disabled={!s.endpoint || check === 'busy'} onClick={run}>
          <PxIcon name="search" size={12} />
          Check files on my ComfyUI
        </button>
        {!s.endpoint && <small class="set-help">Set your ComfyUI address in Providers first.</small>}
      </div>
      <Result check={check} />
      {FOLDERS.map((folder) => (
        <div key={folder} class="set-files">
          <h3 class="mono">models/{folder}</h3>
          <ul>
            {MODEL_FILES.filter((f) => f.folder === folder).map((f) => {
              const st = found?.[f.id];
              const field = `file-${f.id.replace(/[^a-z0-9]+/gi, '-')}`;
              return (
                <li key={f.id} class="set-file">
                  <div class="set-file-text">
                    <label for={field}>
                      <b>{f.role}</b> · {f.usedBy.join(', ')}
                    </label>
                    {f.pack && <small>From the {f.pack} node pack, which downloads it by itself</small>}
                  </div>
                  <input id={field} class="input mono" value={s.files[f.id] ?? ''} placeholder={f.id} spellcheck={false} onChange={(e) => setName(f.id, (e.currentTarget as HTMLInputElement).value)} />
                  <span class="set-file-state">
                    {st && <Chip tone={STATE[st.state].tone}>{STATE[st.state].label}</Chip>}
                    {st?.state === 'found' && st.as && (
                      <button type="button" class="btn btn-sm btn-ghost" onClick={() => setName(f.id, st.as!)} title={st.as}>
                        Use {st.as.length > 44 ? `…${st.as.slice(-42)}` : st.as}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </Card>
  );
}

export function ModelsSection() {
  return (
    <>
      <Defaults />
      <Pickers />
      <Files />
    </>
  );
}
