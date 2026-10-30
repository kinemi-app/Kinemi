// The 16 tools as the dashboard sees them: the landing copy plus a URL slug and what a render produces.
import { TOOLS, type Tool } from '../../data/tools';
import type { IconName } from '../../lib/pixel-icons';

export type ToolId = IconName;
export type AssetKind = 'video' | 'still' | 'audio' | 'palette' | 'board' | 'character' | 'previz';

export interface AppTool extends Tool {
  id: ToolId;
  slug: string;
  /** what one render of this tool puts in the asset store */
  output: AssetKind;
  /** a short action, for chips and menus */
  short: string;
}

const META: Record<ToolId, { slug: string; output: AssetKind; short: string }> = {
  cinematic: { slug: 'cinematic', output: 'video', short: 'Build a shot' },
  storyboard: { slug: 'storyboard', output: 'board', short: 'Queue a shot list' },
  reshoot: { slug: 're-shoot', output: 'still', short: 'New camera angle' },
  genjutsu: { slug: 'genjutsu', output: 'video', short: 'Move a performance' },
  presets: { slug: 'presets', output: 'video', short: 'Browse 60 moves' },
  soul: { slug: 'soul', output: 'palette', short: 'Palette from a line' },
  cast: { slug: 'ai-cast', output: 'character', short: 'Build a character' },
  edit: { slug: 'edit', output: 'video', short: 'Edit a clip' },
  academy: { slug: 'academy', output: 'video', short: '14 lessons' },
  audio: { slug: 'audio-studio', output: 'audio', short: 'Voice and sound' },
  marketing: { slug: 'marketing-studio', output: 'video', short: 'Product to ad' },
  fashion: { slug: 'fashion-factory', output: 'still', short: 'Swap a garment' },
  canvas: { slug: 'canvas', output: 'video', short: 'Wire a pipeline' },
  previz: { slug: '3d-previz', output: 'previz', short: 'Block it in 3D' },
  supercomputer: { slug: 'supercomputer', output: 'board', short: 'Run a campaign' },
  upscale: { slug: 'upscale', output: 'video', short: '4K at 60 fps' },
};

export const APP_TOOLS: AppTool[] = TOOLS.map((t) => ({ ...t, id: t.icon, ...META[t.icon] }));

const byId = new Map(APP_TOOLS.map((t) => [t.id, t]));
const bySlug = new Map(APP_TOOLS.map((t) => [t.slug, t]));

export const toolById = (id: ToolId) => byId.get(id)!;
export const toolBySlug = (slug: string) => bySlug.get(slug);

export const KIND_LABEL: Record<AssetKind, { one: string; many: string }> = {
  video: { one: 'Video', many: 'Video' },
  still: { one: 'Still', many: 'Stills' },
  audio: { one: 'Audio', many: 'Audio' },
  palette: { one: 'Palette', many: 'Palettes' },
  board: { one: 'Board', many: 'Boards' },
  character: { one: 'Character', many: 'Cast' },
  previz: { one: '3D previz', many: '3D' },
};

export const KINDS = Object.keys(KIND_LABEL) as AssetKind[];
