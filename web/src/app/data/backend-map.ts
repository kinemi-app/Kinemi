// How the studio's tools and model picks become requests the Kinemi server accepts.
// The server's registry (GET /api/models) is the truth; this file only says which mode a tool
// renders in and which registry model each of the studio's model picks prefers.
import type { AssetKind, ToolId } from './tools';

/** The server's generation modes (lib/types.ts `Mode`). */
export type Mode = 'cinematic' | 'reshoot' | 'genjutsu' | 'soul' | 'edit' | 'audio' | 'ads' | 'fashion' | 'upscale' | 'depth';

/** The mode each tool renders in. Academy only teaches; 3D Previz renders its block-out prompt as a shot. */
export const TOOL_MODE: Partial<Record<ToolId, Mode>> = {
  cinematic: 'cinematic',
  previz: 'cinematic',
  presets: 'cinematic',
  storyboard: 'cinematic',
  canvas: 'cinematic',
  supercomputer: 'cinematic',
  reshoot: 'reshoot',
  genjutsu: 'genjutsu',
  soul: 'soul',
  cast: 'soul',
  edit: 'edit',
  audio: 'audio',
  marketing: 'ads',
  fashion: 'fashion',
  upscale: 'upscale',
};

/** The registry model each of the studio's model picks prefers, when it serves the mode. */
const PREFERS: Record<string, string> = {
  'wan-2.2': 'wan22-t2v',
  'wan-2.2-i2v': 'wan22-i2v',
  'ltx-video': 'ltx-25',
  'hunyuan-video': 'hunyuan-15',
  'hunyuan-i2v': 'hunyuan-15',
  'flux-dev': 'flux-2-dev',
  'flux-kontext': 'flux-2-dev',
  'qwen-image': 'qwen-image',
  'qwen-image-edit': 'qwen-image',
};

export interface RegistryModel {
  id: string;
  name: string;
  vendor: string;
  kind: 'image' | 'video' | 'audio';
  modes: Mode[];
  maxDurationS: number;
}

export interface Registry {
  models: RegistryModel[];
  defaults: Partial<Record<Mode, string>>;
}

/** The registry model a render runs on: the pick's preferred model if it serves the mode, else the mode's default. */
export function resolveModel(registry: Registry, mode: Mode, pick: string | undefined): RegistryModel | undefined {
  const byId = (id: string | undefined) => registry.models.find((m) => m.id === id);
  const preferred = byId(pick ? (PREFERS[pick] ?? pick) : undefined);
  if (preferred?.modes.includes(mode)) return preferred;
  return byId(registry.defaults[mode]);
}

/** The server caps each model's length; a longer request is refused, so it is clamped first. */
export const clampDuration = (model: RegistryModel, seconds: number | undefined) =>
  Math.max(1, Math.min(model.maxDurationS, Math.round(seconds ?? 1)));

/** Which upload field a source asset fills, by what it is. */
export function sourceField(kind: AssetKind): 'imageName' | 'videoName' | 'audioName' | null {
  if (kind === 'video') return 'videoName';
  if (kind === 'audio') return 'audioName';
  if (kind === 'still' || kind === 'character' || kind === 'board' || kind === 'palette') return 'imageName';
  return null;
}
