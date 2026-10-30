// Settings: what the studio remembers about how you work. Kept apart from the store because the sample
// studio is built from the recipes while the store is still loading, and the recipes read these.
import { signal } from '@preact/signals';

export type Assistant = 'builtin' | 'openrouter' | 'claude-code' | 'codex';

/** How hard a provider thinks before it answers. '' leaves the provider's own default. */
export type Effort = '' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

/**
 * The levels each provider itself accepts, lowest first. Claude Code's --effort is checked by
 * web/server/cli.mjs against the same list. Codex lists its levels per model (`codex debug models`:
 * gpt-6-luna low to max, gpt-5.6-terra adds ultra), and Settings shows the chosen model's; this list
 * is only used when the server can't read them. OpenRouter's reasoning.effort takes minimal to xhigh
 * (none switches thinking off, which the chat never wants).
 */
export const EFFORT_LEVELS: Record<Exclude<Assistant, 'builtin'>, Exclude<Effort, ''>[]> = {
  openrouter: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  'claude-code': ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh', 'max'],
};

export interface Settings {
  /* --- this device: never synced to an account --- */
  /** where renders run: nowhere yet, a Comfy Cloud key, or ComfyUI on your own GPU */
  compute: 'none' | 'key' | 'local';
  /** the key's last four characters, as a label; the key itself lives in compute.ts */
  keyHint?: string;
  endpoint?: string;
  /** how many cells of a batch render at once */
  lanes: number;
  sidebar: boolean;
  gpuCard: boolean;
  motion: 'system' | 'reduce';
  /** single-key shortcuts: / N [ , 1 2 3 */
  keys: boolean;
  notifyToast: boolean;
  notifySound: boolean;
  notifyDesktop: boolean;
  /** who answers in the chat: the built-in rules, OpenRouter on your key, or a CLI on this computer */
  assistant: Assistant;
  /** the one model each provider uses; empty means the provider's own default */
  assistantModels: Partial<Record<Exclude<Assistant, 'builtin'>, string>>;
  /** how hard each provider thinks; a provider left out keeps its own default */
  assistantEffort: Partial<Record<Exclude<Assistant, 'builtin'>, Exclude<Effort, ''>>>;
  /** run what the assistant sets up without asking first; off, every render waits for a click */
  yolo: boolean;

  /* --- the studio: follows an account to every device --- */
  /** shown on the user card when there is no account */
  name: string;
  lessonsDone: string[];
  assetLayout: 'grid' | 'list';
  assetZoom: number;
  assetSort: 'new' | 'old' | 'name' | 'tool';
  videoModel: string;
  imageModel: string;
  /** models left out of the pickers */
  hiddenModels: string[];
  /** model files: the name in ComfyUI's example workflows → the name on your machine */
  files: Record<string, string>;
  res: '720p' | '1080p';
  fps: 24 | 25 | 30;
  negVideo: string;
  negImage: string;
  /** the folder and name ComfyUI saves under: {tool}, {name}, {date} */
  prefix: string;
  /** ask before anything that costs more than this many credits; 0 never asks */
  confirmOver: number;
}

export const NEG_VIDEO = 'blurry, low quality, jitter, static frame, deformed hands, extra fingers, watermark, subtitles';
export const NEG_IMAGE = 'blurry, low quality, deformed, watermark, text';

export const DEFAULT_SETTINGS: Settings = {
  compute: 'none',
  lanes: 4,
  sidebar: true,
  gpuCard: true,
  motion: 'system',
  keys: true,
  notifyToast: true,
  notifySound: true,
  notifyDesktop: false,
  assistant: 'builtin',
  assistantModels: {},
  assistantEffort: {},
  yolo: false,
  name: '',
  lessonsDone: [],
  assetLayout: 'grid',
  assetZoom: 1,
  assetSort: 'new',
  videoModel: 'wan-2.2',
  imageModel: 'flux-dev',
  hiddenModels: [],
  files: {},
  res: '720p',
  fps: 24,
  negVideo: NEG_VIDEO,
  negImage: NEG_IMAGE,
  prefix: 'kinemi/{tool}',
  confirmOver: 0,
};

/** Settings that belong to this browser rather than to the studio. */
export const DEVICE_SETTINGS = [
  'compute',
  'keyHint',
  'endpoint',
  'lanes',
  'sidebar',
  'gpuCard',
  'motion',
  'keys',
  'notifyToast',
  'notifySound',
  'notifyDesktop',
  'assistant',
  'assistantModels',
  'assistantEffort',
  'yolo',
] as const satisfies ReadonlyArray<keyof Settings>;

export const settings = signal<Settings>(DEFAULT_SETTINGS);

export const patchSettings = (p: Partial<Settings>) => (settings.value = { ...settings.value, ...p });

/** How many cells of a batch render side by side, 1 to 4. */
export const lanes = () => Math.max(1, Math.min(4, Math.round(settings.value.lanes) || 4));

/** “four at a time”, “one at a time”: for the copy that talks about batches. */
export const atATime = () => `${['one', 'one', 'two', 'three', 'four'][lanes()]} at a time`;
