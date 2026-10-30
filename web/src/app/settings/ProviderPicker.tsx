// The chat card's list of assistants: one choice per provider, with its model, effort and CLI setup.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { ASSISTANTS, effortFor, effortLevels, modelFor } from '../chat/llm';
import { routerModels, secrets } from '../compute';
import { CLI_INFO, cliModels, localStatus, type Cli } from '../local';
import { patchSettings, settings, type Assistant } from '../store';
import type { Effort } from '../prefs';
import { Select } from '../ui/controls';
import { PxIcon } from '../ui/icons';
import { Chip, Choice, Command, Row } from './parts';
import { ProviderTest, type TestState } from './ProviderTest';

type Provider = Exclude<Assistant, 'builtin'>;

const price = (n: number) => (n === 0 ? 'free' : n < 0.1 ? `$${n.toFixed(3)}` : `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`);

/** OpenRouter's models, searchable, plus any id typed in by hand. */
function RouterPicker() {
  const current = modelFor('openrouter');
  const list = routerModels.value;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (needle ? list.filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(needle)) : list).slice(0, 60), [list, needle]);
  const pick = (id: string) => {
    patchSettings({ assistantModels: { ...settings.value.assistantModels, openrouter: id } });
    setOpen(false);
    setQ('');
  };
  const chosen = list.find((m) => m.id === current);
  return (
    <div class="set-picker">
      <div class="set-picker-now">
        <span>
          <b class="mono">{current}</b>
          <small>{current === 'openrouter/auto' ? 'OpenRouter picks a model for each message' : chosen ? `${chosen.name} · ${price(chosen.price[0])} in / ${price(chosen.price[1])} out per million tokens` : 'Typed in by hand'}</small>
        </span>
        <button type="button" class="btn btn-sm btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Change'}
        </button>
      </div>
      {open && (
        <div class="set-picker-panel">
          <label class="search">
            <PxIcon name="search" size={14} />
            <span class="sr-only">Find a model, or type its id</span>
            <input
              type="search"
              placeholder={list.length ? `Find one of ${list.length} models, or type an id` : 'Type a model id, e.g. provider/model'}
              value={q}
              onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && q.trim()) {
                  e.preventDefault();
                  pick(shown[0]?.id === q.trim() || !shown.length ? q.trim() : shown[0].id);
                }
              }}
              autofocus
            />
          </label>
          {!list.length && <p class="set-help">Test your OpenRouter key above to load the list of models.</p>}
          <ul class="set-picker-list" role="listbox" aria-label="OpenRouter models">
            <li>
              <button type="button" role="option" aria-selected={current === 'openrouter/auto'} onClick={() => pick('openrouter/auto')}>
                <b>Auto</b>
                <small class="mono">openrouter/auto · OpenRouter picks for each message</small>
              </button>
            </li>
            {q.trim() && !list.some((m) => m.id === q.trim()) && (
              <li>
                <button type="button" role="option" aria-selected={false} onClick={() => pick(q.trim())}>
                  <b>Use “{q.trim()}”</b>
                  <small class="mono">a model id typed in by hand</small>
                </button>
              </li>
            )}
            {shown.map((m) => (
              <li key={m.id}>
                <button type="button" role="option" aria-selected={m.id === current} onClick={() => pick(m.id)}>
                  <b>{m.name}</b>
                  <small class="mono">
                    {m.id} · {price(m.price[0])} / {price(m.price[1])}
                    {m.context ? ` · ${Math.round(m.context / 1000)}k context` : ''}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CliModel({ cli }: { cli: Cli }) {
  // the models this computer's CLI lists (Codex), or the presets in CLI_INFO
  const models = cliModels(cli);
  const current = settings.value.assistantModels[cli] ?? '';
  const preset = models.some((m) => m.value === current);
  const [custom, setCustom] = useState(preset ? '' : current);
  useEffect(() => {
    if (!preset) setCustom(current);
  }, [current]);
  const set = (v: string) => patchSettings({ assistantModels: { ...settings.value.assistantModels, [cli]: v } });
  return (
    <div class="set-inline">
      {models.length > 1 && (
        <Select
          label="Model"
          value={preset ? current : '__other'}
          onChange={(v) => (v === '__other' ? set(custom) : set(v))}
          options={[...models.map((m) => ({ value: m.value, label: m.label })), { value: '__other', label: 'Another model…' }]}
          class="set-select"
        />
      )}
      {(!preset || models.length === 1) && (
        <>
          <label class="sr-only" for={`model-${cli}`}>
            Model id
          </label>
          <input
            id={`model-${cli}`}
            class="input mono"
            placeholder={models.length === 1 ? `Empty: ${models[0].label}` : 'A model name'}
            value={custom}
            spellcheck={false}
            onInput={(e) => setCustom((e.currentTarget as HTMLInputElement).value)}
            onBlur={() => set(custom.trim())}
            onKeyDown={(e) => e.key === 'Enter' && set(custom.trim())}
          />
        </>
      )}
    </div>
  );
}

function CliState({ cli }: { cli: Cli }) {
  const st = localStatus.value;
  if (st === null) return <Chip>Checking…</Chip>;
  if (st === 'offline') return <Chip tone="warn">Server off</Chip>;
  const one = cli === 'claude-code' ? st.claude : st.codex;
  return one.found ? <Chip tone="ok">{one.version?.split(' ')[0] ?? 'Found'}</Chip> : <Chip tone="warn">Not installed</Chip>;
}

const EFFORT_LABELS: Record<Exclude<Effort, ''>, string> = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };

/** How hard the chosen provider thinks, from the levels that provider itself takes. */
function EffortPicker({ provider }: { provider: Provider }) {
  const set = (v: string) => {
    const next = { ...settings.value.assistantEffort };
    if (v) next[provider] = v as Exclude<Effort, ''>;
    else delete next[provider];
    patchSettings({ assistantEffort: next });
  };
  return (
    <Select
      label="Effort"
      value={effortFor(provider)}
      onChange={set}
      options={[{ value: '', label: `The ${ASSISTANTS[provider].name} default` }, ...effortLevels(provider).map((e) => ({ value: e, label: EFFORT_LABELS[e] }))]}
      class="set-select"
    />
  );
}

/** The chip on each choice: ready, key saved, or what the CLI on this computer reports. */
function ProviderStatus({ provider }: { provider: Assistant }) {
  if (provider === 'builtin') return <Chip tone="ok">Ready</Chip>;
  if (provider === 'openrouter') return secrets.value.openrouterKey ? <Chip tone="ok">Key saved</Chip> : <Chip tone="warn">No key</Chip>;
  return <CliState cli={provider} />;
}

/** Why a CLI can't answer yet (server off, not installed), and its own note. */
function CliHelp({ cli }: { cli: Cli }) {
  const st = localStatus.value;
  return (
    <div class="set-cli">
      {st === 'offline' && (
        <p class="set-help">
          <PxIcon name="info" size={12} /> The Kinemi server on this computer isn’t answering. Start Kinemi with <Command text="npm start" /> (or run <Command text="npm run bridge" /> next to{' '}
          <code class="mono">npm run dev</code>).
        </p>
      )}
      {st && st !== 'offline' && !(cli === 'claude-code' ? st.claude : st.codex).found && (
        <p class="set-help">
          Install it, then sign in once in a terminal: <Command text={CLI_INFO[cli].install} /> <Command text={CLI_INFO[cli].login} />
        </p>
      )}
      <p class="set-help">{CLI_INFO[cli].note}</p>
    </div>
  );
}

type TestProps = { chosen: Assistant; test: TestState; onTest: (next: TestState) => void };

/** Model, effort, CLI help and the test row for one provider other than the built-in assistant. */
function ProviderSettings({ provider, ...testProps }: TestProps & { provider: Provider }) {
  const isCli = provider === 'claude-code' || provider === 'codex';
  return (
    <div class="set-assistant">
      <Row label="Model" desc={provider === 'openrouter' ? 'The one model every message goes to.' : 'Leave it on the default, or name the model the CLI should use.'} stack>
        {provider === 'openrouter' ? <RouterPicker /> : <CliModel cli={provider} />}
      </Row>
      <Row label="Effort" desc="How hard it thinks before it answers. Higher is slower and holds up better on a hard shot.">
        <EffortPicker provider={provider} />
      </Row>
      {isCli && <CliHelp cli={provider} />}
      <ProviderTest provider={provider} {...testProps} />
    </div>
  );
}

type PickerProps = TestProps & { options: Assistant[]; onChoose: (a: Assistant) => void };

export function ProviderPicker({ options, onChoose, ...testProps }: PickerProps) {
  return (
    <div class="set-choices" role="radiogroup" aria-label="The chat runs on">
      {options.map((a) => {
        const isCli = a === 'claude-code' || a === 'codex';
        return (
          <Choice
            key={a}
            name="assistant"
            value={a}
            checked={testProps.chosen === a}
            onChange={() => onChoose(a)}
            title={ASSISTANTS[a].name + (isCli ? ' · on this computer' : '')}
            desc={a === 'builtin' ? ASSISTANTS.builtin.blurb : a === 'openrouter' ? 'Any model on OpenRouter, on your own key.' : `The ${ASSISTANTS[a].name} CLI installed on this computer.`}
            icon={a === 'builtin' ? 'sparkle' : a === 'openrouter' ? 'chat' : 'terminal'}
            status={<ProviderStatus provider={a} />}
          >
            {a !== 'builtin' && <ProviderSettings provider={a} {...testProps} />}
          </Choice>
        );
      })}
    </div>
  );
}
