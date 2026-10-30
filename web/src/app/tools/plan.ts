// Supercomputer: a production plan rather than a conversation. Deliverables are the rows, variants
// the columns, every cell is one render with its own cost, and a budget decides what runs.
// A run queues the cells as one batch (four at a time) into the campaign's folder.
import { LOOKS } from '../data/options';
import { toolById, type ToolId } from '../data/tools';
import { addCost, type Estimate } from '../data/models';
import { id as newId, plural } from '../lib/util';
import { queueRender } from '../render';
import { createFolder, createTag, folders, tags, toggleTag, type Asset } from '../store';
import { RECIPES, shortTitle, type Built, type Ctx, type Values } from './recipes';

export interface Deliverable {
  label: string;
  tool: ToolId;
  aspect: string;
  duration?: string;
  model: string;
  note: string;
}

/** The formats a campaign usually needs, one row each. */
export const DELIVERABLES: Record<string, Deliverable> = {
  hero: { label: 'Hero film', tool: 'cinematic', aspect: '2.39:1', duration: '10 s', model: 'wan-2.2', note: 'cinema · 10 s' },
  vertical: { label: 'Vertical cut-down', tool: 'cinematic', aspect: '9:16', duration: '5 s', model: 'ltx-video', note: 'reels · 5 s' },
  square: { label: 'Square post', tool: 'cinematic', aspect: '1:1', duration: '5 s', model: 'ltx-video', note: 'feed · 5 s' },
  ad: { label: 'Product ad', tool: 'marketing', aspect: '9:16', duration: '8 s', model: 'wan-2.2', note: 'hook + product · 8 s' },
  lookbook: { label: 'Lookbook still', tool: 'fashion', aspect: '4:5', model: 'flux-dev', note: 'print · still' },
  keyart: { label: 'Key art', tool: 'fashion', aspect: '16:9', model: 'flux-dev', note: 'banner · still' },
  voice: { label: 'Voiceover', tool: 'audio', aspect: '16:9', duration: '20 s', model: '', note: 'read · 20 s' },
};

export type Axis = 'Places' | 'Looks' | 'Takes';

export interface Cell {
  key: string;
  row: string;
  col: number;
  variant: string;
  name: string;
  built: Built | null;
  /** switched on in the plan */
  on: boolean;
  /** switched on, but past the budget */
  over: boolean;
}

export interface Plan {
  title: string;
  rows: string[];
  variants: string[];
  cells: Cell[];
  /** what runs: on and within budget */
  run: Cell[];
  estimate: Estimate;
  budget: number;
}

const list = (s: unknown) =>
  String(s ?? '')
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function variantsOf(v: Values): string[] {
  if (v.axis === 'Looks') return ((v.looks as string[]) ?? []).filter((l) => LOOKS.includes(l)).slice(0, 6);
  if (v.axis === 'Takes') return Array.from({ length: Math.max(1, Math.min(6, Number(v.takes) || 3)) }, (_, i) => `Take ${'ABCDEF'[i]}`);
  return list(v.places).slice(0, 6);
}

/** The subject for one column: `{v}` marks where a place goes. */
function subjectFor(v: Values, variant: string) {
  const subject = String(v.subject || '').trim();
  if (v.axis === 'Places') return subject.includes('{v}') ? subject.replaceAll('{v}', variant) : `${subject}, in ${variant}`;
  return subject.replaceAll('{v}', 'the city');
}

function buildCell(row: string, variant: string, col: number, v: Values, ctx: Ctx): Built | null {
  const d = DELIVERABLES[row];
  const recipe = RECIPES[d.tool];
  if (!d || !recipe) return null;
  const base = recipe.defaults(ctx);
  const subject = subjectFor(v, variant);
  const look = v.axis === 'Looks' ? variant : undefined;
  let values: Values;
  switch (d.tool) {
    case 'cinematic':
      values = { ...base, prompt: subject, aspect: d.aspect, duration: d.duration, model: d.model, ...(look ? { look } : {}) };
      break;
    case 'marketing':
      values = { ...base, product: subject, template: 'Ad', hooks: 1, aspect: d.aspect, duration: d.duration, model: d.model };
      break;
    case 'fashion':
      values = { ...base, mode: 'Campaign', garment: look ? `${subject}, ${look.toLowerCase()} look` : subject, looks: 1, model: d.model };
      break;
    case 'audio':
      values = { ...base, mode: 'Voiceover', script: `${String(v.campaign || '').trim()}. ${subject}.`, length: parseInt(d.duration ?? '20', 10) || 20 };
      break;
    default:
      values = base;
  }
  const built = recipe.build(values, ctx);
  if (!built) return null;
  // takes share every setting but the seed
  const seed = built.spec.seed + col * 7919;
  return { ...built, spec: { ...built.spec, aspect: d.aspect, seed } };
}

export function makePlan(v: Values, ctx: Ctx): Plan {
  const title = String(v.campaign || '').trim() || shortTitle(String(v.subject || 'Campaign'), 28);
  const rows = ((v.rows as string[]) ?? []).filter((r) => DELIVERABLES[r]);
  const variants = variantsOf(v);
  const off = new Set((v.off as string[]) ?? []);
  const budget = Math.max(0, Number(v.budget) || 0);
  const cells: Cell[] = [];
  let spent = 0;
  for (const row of rows)
    variants.forEach((variant, col) => {
      const key = `${row}:${col}`;
      const built = buildCell(row, variant, col, v, ctx);
      const on = !off.has(key) && !!built;
      const credits = built?.estimate.credits ?? 0;
      const over = on && spent + credits > budget;
      if (on && !over) spent += credits;
      cells.push({ key, row, col, variant, name: `${title} · ${DELIVERABLES[row].label} · ${variant}`, built, on, over });
    });
  const run = cells.filter((c) => c.on && !c.over);
  return { title, rows, variants, cells, run, budget, estimate: addCost({ runtime: 0, credits: 0 }, ...run.map((c) => c.built!.estimate)) };
}

/** Queue every cell that runs as one batch, into the campaign's folder. Returns the batch id. */
export function runPlan(plan: Plan) {
  const batch = newId('b');
  const folder = folders.value.find((f) => f.name === plan.title) ?? createFolder(plan.title);
  for (const c of plan.run) queueRender({ ...c.built!.spec, params: c.built!.params, name: c.name, folderId: folder.id, batch, cell: c.key });
  return batch;
}

const tagNamed = (name: string, color: string) => tags.value.find((t) => t.name === name) ?? createTag(name, color);

/** Review a take: approved, needs a fix, or back to undecided. */
export function review(a: Asset, verdict: 'approved' | 'needs fix' | null) {
  const ok = tagNamed('approved', '#2ee6c4');
  const fix = tagNamed('needs fix', '#ff6b7a');
  toggleTag([a.id], ok.id, verdict === 'approved');
  toggleTag([a.id], fix.id, verdict === 'needs fix');
}

export const isApproved = (a: Asset) => a.tagIds.some((id) => tags.value.find((t) => t.id === id)?.name === 'approved');
export const needsFix = (a: Asset) => a.tagIds.some((id) => tags.value.find((t) => t.id === id)?.name === 'needs fix');

/** Upscale the approved takes as a second batch, next to the first in the same folder. */
export function upscaleApproved(list: Asset[], ctx: Ctx) {
  const recipe = RECIPES.upscale!;
  const batch = newId('b');
  let n = 0;
  for (const a of list) {
    const built = recipe.build({ ...recipe.defaults(ctx), source: a.id }, { ...ctx, assets: [a, ...ctx.assets] });
    if (!built) continue;
    queueRender({ ...built.spec, params: built.params, folderId: a.folderId, batch, cell: a.cell });
    n += 1;
  }
  return n;
}

/** The plan as a file: check it in, edit it, run it from the CLI. */
export function planYaml(plan: Plan, v: Values) {
  const q = (s: string) => (/[:#,\[\]{}]|^\s|\s$/.test(s) ? JSON.stringify(s) : s);
  const lines = [
    `campaign: ${q(plan.title)}`,
    `subject: ${q(String(v.subject || ''))}`,
    `budget: ${plan.budget} # credits`,
    `parallel: 4`,
    `columns:`,
    `  axis: ${String(v.axis).toLowerCase()}`,
    `  values: [${plan.variants.map(q).join(', ')}]`,
    `deliverables:`,
    ...plan.rows.flatMap((r) => {
      const d = DELIVERABLES[r];
      return [`  - name: ${q(d.label)}`, `    tool: ${toolById(d.tool).slug}`, ...(d.model ? [`    model: ${d.model}`] : []), `    aspect: ${q(d.aspect)}`, ...(d.duration ? [`    duration: ${d.duration.replace(' ', '')}`] : [])];
    }),
    ...(plan.cells.some((c) => !c.on) ? [`skip: [${plan.cells.filter((c) => !c.on).map((c) => q(c.key)).join(', ')}]`] : []),
  ];
  return `${lines.join('\n')}\n`;
}

export const planSummary = (plan: Plan) => `${plural(plan.rows.length, 'deliverable')} × ${plural(plan.variants.length, 'variant')} · ${plural(plan.run.length, 'render')}`;
