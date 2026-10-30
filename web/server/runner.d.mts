// Types for runner.mjs, so the Next routes under app/api/local/ can import it (allowJs is off).
export type CliId = 'claude-code' | 'codex';

export interface CliModel {
  id: string;
  name: string;
  efforts: string[];
  default: string;
}

export interface CliFound {
  found: boolean;
  version?: string;
  error?: 'not-installed' | 'cli-error';
  models?: CliModel[];
}

export interface ChatRequest {
  id: CliId;
  system: string;
  prompt: string;
  model: string;
  effort: string;
}

export function status(): Promise<{ claude: CliFound; codex: CliFound }>;
export function checkChat(body: unknown): Promise<{ request: ChatRequest } | { status: number; error: string }>;
/** `signal` aborting (the page went away) stops the CLI, or keeps a queued turn from starting one: code 'stopped'. */
export function ask(request: ChatRequest, options?: { signal?: AbortSignal }): Promise<{ text: string; model?: string }>;
