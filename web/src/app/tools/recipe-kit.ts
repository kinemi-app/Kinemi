// The types every recipe shares and the small text helpers they build prompts with.
// Recipe tables (recipes.ts, recipes-film.ts) import from here, so this module imports no recipe.
import type { Estimate } from '../data/models';
import { toolById, type AssetKind, type ToolId } from '../data/tools';
import type { Asset, Character, Pair, RenderSpec } from '../store';

// A tool's settings form: each recipe reads its own fields, so one shared shape stays untyped.
export type Values = Record<string, any>;

export interface Ctx {
  assets: Asset[];
  cast: Character[];
}

export interface Built {
  title: string;
  params: Pair[];
  prompt: string;
  estimate: Estimate;
  spec: RenderSpec;
}

export interface Shot {
  prompt: string;
  model: string;
  duration: string;
}

export type Recipe = { defaults: (ctx: Ctx) => Values; build: (v: Values, ctx: Ctx) => Built | null };

export const secs = (d: string | number | undefined, fallback = 5) => (typeof d === 'number' ? d : parseInt(String(d ?? ''), 10) || fallback);

/** First clause of a prompt, as a short title. */
export function shortTitle(text: string, max = 38) {
  const clean = text.replace(/\s+/g, ' ').trim().replace(/^(a|an|the)\s+/i, '');
  const first = clean.split(/[,.;:\n]/)[0] || clean;
  const t = first.length > max ? `${first.slice(0, max).replace(/\s+\S*$/, '')}…` : first;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const sentence = (s: string) => {
  const t = s.trim().replace(/[.\s]+$/, '');
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : '';
};

/** The newest asset of the given kinds, for tools that start from a finished render. */
export function latest(ctx: Ctx, kinds: AssetKind[]) {
  return ctx.assets.filter((a) => !a.trashedAt && kinds.includes(a.kind)).sort((a, b) => b.createdAt - a.createdAt)[0];
}

export const sourceOf = (ctx: Ctx, id: string | undefined, kinds: AssetKind[]) =>
  (id && ctx.assets.find((a) => a.id === id && !a.trashedAt)) || latest(ctx, kinds);

export function spec(tool: ToolId, p: Omit<RenderSpec, 'tool' | 'kind'> & { kind?: AssetKind }): RenderSpec {
  return { tool, kind: p.kind ?? toolById(tool).output, ...p };
}

export const fNumber = (a: string) => parseFloat(a.replace('f/', ''));
