// The pieces every Settings section is built from: cards, rows, a key box and the result of a check.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { masked, type Check } from '../compute';
import type { UiIconName } from '../lib/px-icons';
import { copyText, cx } from '../lib/util';
import { PxIcon } from '../ui/icons';
import { toast } from '../ui/toast';

export function Card({ title, desc, id, aside, children, class: cls }: { title: string; desc?: ComponentChildren; id?: string; aside?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <section class={cx('set-card', cls)} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <header class="set-card-head">
        <div>
          <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
          {desc && <p>{desc}</p>}
        </div>
        {aside}
      </header>
      <div class="set-card-body">{children}</div>
    </section>
  );
}

/** A setting: what it is on the left, the control on the right (stacked on a phone). */
export function Row({ label, desc, children, stack, id }: { label: ComponentChildren; desc?: ComponentChildren; children?: ComponentChildren; stack?: boolean; id?: string }) {
  return (
    <div class={cx('set-row', stack && 'is-stack')}>
      <div class="set-row-text">
        <span class="set-row-label" id={id}>
          {label}
        </span>
        {desc && <small>{desc}</small>}
      </div>
      {children && <div class="set-row-control">{children}</div>}
    </div>
  );
}

export function Chip({ tone = 'muted', icon, children }: { tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'info'; icon?: UiIconName; children: ComponentChildren }) {
  return (
    <span class={cx('set-chip', `is-${tone}`)}>
      {icon && <PxIcon name={icon} size={11} />}
      {children}
    </span>
  );
}

/** A command to type, with a copy button. */
export function Command({ text }: { text: string }) {
  return (
    <span class="set-cmd">
      <code class="mono">{text}</code>
      <button
        type="button"
        class="icon-btn icon-btn-sm"
        aria-label="Copy the command"
        data-tip="Copy"
        onClick={() => copyText(text).then(() => toast({ title: 'Copied', body: text }), () => {})}
      >
        <PxIcon name="copy" size={12} />
      </button>
    </span>
  );
}

/** What a check found: a green line or two, or what went wrong and how to fix it. */
export function Result({ check }: { check: Check | null | 'busy' }) {
  if (!check) return null;
  if (check === 'busy')
    return (
      <p class="set-result is-busy" role="status">
        <span class="set-spin" aria-hidden="true" />
        Checking…
      </p>
    );
  if (check.ok)
    return (
      <div class="set-result is-ok" role="status">
        <PxIcon name="check" size={14} />
        <div>
          <b>{check.title}</b>
          {check.lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      </div>
    );
  return (
    <div class="set-result is-bad" role="alert">
      <PxIcon name="x" size={14} />
      <div>
        <b>{check.title}</b>
        <span>{check.body}</span>
        {check.fix && <Command text={check.fix} />}
      </div>
    </div>
  );
}

/** A key you bring: masked once saved, with replace, remove and test. */
export function KeyBox({
  label,
  value,
  placeholder,
  onSave,
  onForget,
  onTest,
  min = 8,
}: {
  label: string;
  value?: string;
  placeholder: string;
  onSave: (key: string) => void;
  onForget: () => void;
  onTest: (key: string) => Promise<Check>;
  min?: number;
}) {
  const [draft, setDraft] = useState('');
  // keys load after the page is drawn: show the saved view whenever there is a key, unless replacing it
  const [replacing, setReplacing] = useState(false);
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState<Check | null | 'busy'>(null);
  const field = `key-${label.toLowerCase().replace(/\W+/g, '-')}`;

  const test = async (key: string) => {
    setCheck('busy');
    setCheck(await onTest(key));
  };

  if (value && !replacing)
    return (
      <div class="set-key">
        <div class="set-key-saved">
          <PxIcon name="key" size={14} />
          <code class="mono" aria-label={`${label}, saved, ends in ${value.slice(-4)}`}>
            {masked(value)}
          </code>
          <Chip tone="ok">Saved</Chip>
        </div>
        <div class="set-actions">
          <button type="button" class="btn btn-sm btn-ghost" onClick={() => test(value)}>
            <PxIcon name="bolt" size={12} />
            Test
          </button>
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            onClick={() => {
              setReplacing(true);
              setCheck(null);
            }}
          >
            Replace
          </button>
          <button
            type="button"
            class="btn btn-sm btn-ghost is-danger-text"
            onClick={() => {
              onForget();
              setReplacing(false);
              setCheck(null);
            }}
          >
            Remove
          </button>
        </div>
        <Result check={check} />
      </div>
    );

  return (
    <form
      class="set-key"
      onSubmit={(e) => {
        e.preventDefault();
        const k = draft.trim();
        if (k.length < min) return setError('That looks too short. Paste the whole key.');
        if (/\s/.test(k)) return setError('A key has no spaces in it. Paste it again.');
        setError('');
        onSave(k);
        setDraft('');
        setReplacing(false);
        void test(k);
      }}
    >
      <label class="sr-only" for={field}>
        {label}
      </label>
      <div class="set-key-input">
        <input
          id={field}
          class="input mono"
          type={show ? 'text' : 'password'}
          autoComplete="off"
          spellcheck={false}
          placeholder={placeholder}
          value={draft}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="button" class="icon-btn icon-btn-sm set-key-eye" aria-label={show ? 'Hide the key' : 'Show the key'} aria-pressed={show} onClick={() => setShow(!show)}>
          <PxIcon name={show ? 'eye-off' : 'eye'} size={13} />
        </button>
      </div>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="set-actions">
        <button type="submit" class="btn btn-sm btn-primary" disabled={!draft.trim()}>
          Save key
        </button>
        {value && (
          <button type="button" class="btn btn-sm btn-ghost" onClick={() => setReplacing(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** A radio card: one of a few ways to do something, with its state. */
export function Choice({
  name,
  value,
  checked,
  onChange,
  title,
  desc,
  icon,
  status,
  disabled,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (v: string) => void;
  title: string;
  desc?: ComponentChildren;
  icon: UiIconName;
  status?: ComponentChildren;
  disabled?: boolean;
  children?: ComponentChildren;
}) {
  return (
    <div class={cx('set-choice', checked && 'is-on', disabled && 'is-disabled')}>
      <label class="set-choice-head">
        <input type="radio" class="sr-only" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)} />
        <span class="set-choice-dot" aria-hidden="true" />
        <span class="set-choice-ico" aria-hidden="true">
          <PxIcon name={icon} size={16} />
        </span>
        <span class="set-choice-text">
          <b>{title}</b>
          {desc && <small>{desc}</small>}
        </span>
        {status && <span class="set-choice-status">{status}</span>}
      </label>
      {checked && children && <div class="set-choice-body">{children}</div>}
    </div>
  );
}
