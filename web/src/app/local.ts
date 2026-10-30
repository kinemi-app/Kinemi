// The Kinemi server on your own computer (`npm start`, see server/local.mjs). It runs the Claude Code and
// Codex CLIs installed on this machine for the chat. A copy of Kinemi on the web never has it.
import { signal } from '@preact/signals';
import { BASE } from './deploy';
import type { Effort } from './prefs';
import { isBrowser } from './lib/util';

/** Kinemi is open from this computer: localhost, 127.0.0.1 or ::1. */
export const onThisComputer = () => isBrowser && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

export type Cli = 'claude-code' | 'codex';

/** A model a CLI lists (Codex's `codex debug models`), with the effort levels it takes. */
export interface CliModel {
  id: string;
  name: string;
  efforts: string[];
  default: string;
}

export interface CliStatus {
  found: boolean;
  version?: string;
  models?: CliModel[];
}

const LEVELS: ReadonlyArray<Exclude<Effort, ''>> = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/** The models this computer's CLI listed, if the server reported any. */
function listed(cli: Cli): CliModel[] | undefined {
  const st = localStatus.value;
  return st && st !== 'offline' ? (cli === 'codex' ? st.codex : st.claude).models : undefined;
}

/** The levels the CLI lists for this model (any listed model's when none is picked), lowest first;
 *  null when this computer's CLI listed no models, and Settings falls back to EFFORT_LEVELS. */
export function cliLevels(cli: Cli, model: string): Exclude<Effort, ''>[] | null {
  const list = listed(cli);
  if (!list?.length) return null;
  const one = list.find((m) => m.id === model);
  const named = new Set(one ? one.efforts : list.flatMap((m) => m.efforts));
  return LEVELS.filter((l) => named.has(l));
}

/** The models Settings offers for a CLI: its own default, then the ones it lists, else CLI_INFO's. */
export function cliModels(cli: Cli): Array<{ value: string; label: string }> {
  const list = listed(cli);
  if (!list?.length) return CLI_INFO[cli].models;
  return [CLI_INFO[cli].models[0], ...list.map((m) => ({ value: m.id, label: m.name }))];
}

export type LocalStatus = { claude: CliStatus; codex: CliStatus } | 'offline';

/** null until asked; 'offline' when the local server isn't running (or this isn't your computer). */
export const localStatus = signal<LocalStatus | null>(null);

const API = `${BASE}api/local`;

export async function refreshLocal(): Promise<LocalStatus> {
  if (!onThisComputer()) return (localStatus.value = 'offline');
  try {
    const r = await fetch(`${API}/status`, { signal: AbortSignal.timeout?.(15000) });
    const j = r.ok ? await r.json() : null;
    localStatus.value = j?.ok ? { claude: j.claude, codex: j.codex } : 'offline';
  } catch {
    localStatus.value = 'offline';
  }
  return localStatus.value;
}

export class LocalError extends Error {
  constructor(
    public code: 'offline' | 'not-installed' | 'signed-out' | 'timeout' | 'cli-error',
    message: string,
  ) {
    super(message);
  }
}

const NOT_RUNNING = 'The Kinemi server on this computer isn’t running: start Kinemi with npm start.';

/** Ask a CLI on this computer. Resolves to its answer, or throws a LocalError. */
export async function askLocal(cli: Cli, body: { system: string; prompt: string; model?: string; effort?: string }): Promise<{ text: string; model?: string }> {
  let r: Response;
  try {
    r = await fetch(`${API}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: cli, ...body }),
      signal: AbortSignal.timeout?.(150_000),
    });
  } catch (e) {
    const timedOut = (e as Error)?.name === 'TimeoutError';
    throw new LocalError(timedOut ? 'timeout' : 'offline', timedOut ? 'No answer within two minutes.' : NOT_RUNNING);
  }
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.ok) return { text: String(j.text ?? ''), model: j.model };
  if (r.status === 403) throw new LocalError('cli-error', `Kinemi only lets its own page on this computer use the CLIs: open it at http://localhost:${location.port || 80}.`);
  if (r.status === 404) throw new LocalError('offline', NOT_RUNNING);
  if (j.error === 'offline') throw new LocalError('offline', String(j.message || NOT_RUNNING));
  const code = ['not-installed', 'signed-out', 'timeout'].includes(j.error) ? j.error : 'cli-error';
  throw new LocalError(code, String(j.message || j.error || `Answered ${r.status}`));
}

export const CLI_INFO: Record<Cli, { name: string; install: string; login: string; models: Array<{ value: string; label: string }>; note: string }> = {
  'claude-code': {
    name: 'Claude Code',
    install: 'npm install -g @anthropic-ai/claude-code',
    login: 'claude',
    models: [
      { value: '', label: 'Claude Code’s default' },
      { value: 'fable', label: 'Fable' },
      { value: 'opus', label: 'Opus' },
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'haiku', label: 'Haiku' },
    ],
    note: 'Uses the Claude Code sign-in on this computer. A Claude subscription covers your own use on your own machine; for anything you offer to others, Anthropic asks for an API key: set ANTHROPIC_API_KEY before you start Kinemi.',
  },
  codex: {
    name: 'Codex',
    install: 'npm install -g @openai/codex',
    login: 'codex login',
    models: [{ value: '', label: 'Codex’s default' }],
    note: 'Uses the Codex sign-in on this computer (your ChatGPT plan or an OpenAI API key). It runs in a read-only sandbox in an empty folder.',
  },
};
