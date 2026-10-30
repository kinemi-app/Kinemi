// The chat on a language model: OpenRouter on your own key, or Claude Code or Codex on this computer.
// The model gets a catalogue of the tools and the settings each one takes (built from the same schemas
// as the forms) and answers with one JSON object. Every value is checked against those settings before
// it becomes a tool call, so a model can't set up anything the form couldn't. When the model fails, the
// chat shows that provider's own error; the built-in rules never answer in its place.
import { secrets, OPENROUTER } from '../compute';
import { MODELS } from '../data/models';
import { MOVES } from '../data/moves';
import { APERTURES, ASPECTS, BODIES, DURATIONS, EMOTIONS, LENSES, LOOKS, SOUL_PRESETS } from '../data/options';
import { APP_TOOLS, toolById, type ToolId } from '../data/tools';
import { askLocal, CLI_INFO, cliLevels, LocalError, onThisComputer, type Cli } from '../local';
import { clamp } from '../lib/util';
import { EFFORT_LEVELS, settings, type Assistant, type Effort } from '../prefs';
import type { Message } from '../store';
import { CANVAS_NODES, defaultsFor, type Values } from '../tools/recipes';
import { DELIVERABLES } from '../tools/plan';
import { SCHEMAS, type FieldDef } from '../tools/schemas';
import { agentIntro } from './agent-prompt';
import { AWAITING_APPROVAL, renderLast, toolCall, type EngineCtx, type Reply } from './engine';

export const ASSISTANTS: Record<Assistant, { name: string; blurb: string }> = {
  builtin: { name: 'Built-in', blurb: 'Rules that run in your browser: free, instant, and they work offline.' },
  openrouter: { name: 'OpenRouter', blurb: 'Any model on OpenRouter, on your own key.' },
  'claude-code': { name: 'Claude Code', blurb: CLI_INFO['claude-code'].note },
  codex: { name: 'Codex', blurb: CLI_INFO.codex.note },
};

/** The model a provider uses: the one picked in Settings, or the provider's own default. */
export const modelFor = (a: Exclude<Assistant, 'builtin'>) => settings.value.assistantModels[a]?.trim() || (a === 'openrouter' ? 'openrouter/auto' : '');

/** How hard a provider thinks, as picked in Settings; '' leaves the provider's own default. A level the
 * provider doesn't take (one saved before the lists were split) falls back to that default too. */
export function effortFor(a: Exclude<Assistant, 'builtin'>): Exclude<Effort, ''> | '' {
  const level = settings.value.assistantEffort?.[a];
  return level && effortLevels(a).includes(level) ? level : '';
}

/** The levels a provider takes: for a CLI that lists its models (Codex), the picked model's own. */
export function effortLevels(a: Exclude<Assistant, 'builtin'>): Exclude<Effort, ''>[] {
  return (a !== 'openrouter' && cliLevels(a, modelFor(a))) || EFFORT_LEVELS[a];
}

/** What stops the chosen assistant from answering, in plain words, or null when it can. */
export function assistantProblem(a: Assistant = settings.value.assistant): string | null {
  if (a === 'openrouter' && !secrets.value.openrouterKey) return 'Add your OpenRouter key in Settings → Providers.';
  if ((a === 'claude-code' || a === 'codex') && !onThisComputer()) return `${ASSISTANTS[a].name} only runs when Kinemi runs on your own computer.`;
  return null;
}

/* ------------------------------------------------------------------ */
/* What each tool takes                                                */
/* ------------------------------------------------------------------ */

type Spec =
  | { kind: 'enum'; options: string[] }
  | { kind: 'list'; options: string[]; max: number }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'bool' }
  | { kind: 'text' }
  | { kind: 'moves'; max: number }
  | { kind: 'move' }
  | { kind: 'shots' }
  | { kind: 'cast' };

/** Settings the app fills in itself: a model can't know an asset's id, a palette comes from a render. */
const SKIP = new Set(['source', 'palette', 'off', 'batch']);

const flat = (defs: FieldDef[]): FieldDef[] => defs.flatMap((d) => (d.type === 'row' ? flat(d.fields) : [d]));
const modelIds = (kinds: string[]) => MODELS.filter((m) => kinds.includes(m.kind)).map((m) => m.id);

/** Tools without a form schema, and settings the schema doesn't name. */
const EXTRA: Partial<Record<ToolId, Record<string, Spec>>> = {
  storyboard: { shots: { kind: 'shots' }, aspect: { kind: 'enum', options: ASPECTS }, look: { kind: 'enum', options: LOOKS } },
  soul: { sentence: { kind: 'text' }, preset: { kind: 'enum', options: SOUL_PRESETS }, model: { kind: 'enum', options: modelIds(['image']) }, aspect: { kind: 'enum', options: ASPECTS } },
  cast: { name: { kind: 'text' }, look: { kind: 'text' }, lock: { kind: 'bool' }, model: { kind: 'enum', options: modelIds(['image']) } },
  canvas: { prompt: { kind: 'text' }, nodes: { kind: 'list', options: Object.keys(CANVAS_NODES), max: 6 } },
  genjutsu: { from: { kind: 'enum', options: EMOTIONS }, to: { kind: 'enum', options: EMOTIONS } },
  supercomputer: {
    campaign: { kind: 'text' },
    subject: { kind: 'text' },
    rows: { kind: 'list', options: Object.keys(DELIVERABLES), max: 7 },
    axis: { kind: 'enum', options: ['Places', 'Looks', 'Takes'] },
    places: { kind: 'text' },
    looks: { kind: 'list', options: LOOKS, max: 6 },
    takes: { kind: 'number', min: 1, max: 6 },
    budget: { kind: 'number', min: 0, max: 5000 },
  },
};

function specsFor(tool: ToolId, ctx: EngineCtx): Record<string, Spec> {
  const defaults = defaultsFor(tool, ctx);
  const defs = flat(SCHEMAS[tool] ?? []);
  const out: Record<string, Spec> = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (SKIP.has(key)) continue;
    const extra = EXTRA[tool]?.[key];
    if (extra) {
      out[key] = extra;
      continue;
    }
    if (key === 'lens') out[key] = { kind: 'enum', options: LENSES };
    else if (key === 'aperture') out[key] = { kind: 'enum', options: APERTURES };
    const d = defs.find((f) => 'key' in f && f.key === key);
    if (out[key] || !d) {
      if (!out[key] && typeof value === 'boolean') out[key] = { kind: 'bool' };
      else if (!out[key] && typeof value === 'string' && key !== 'model') out[key] = { kind: 'text' };
      continue;
    }
    switch (d.type) {
      case 'seg':
      case 'select':
      case 'chips':
        out[key] = { kind: 'enum', options: d.options };
        break;
      case 'slider':
        out[key] = { kind: 'number', min: d.min, max: d.max };
        break;
      case 'toggle':
        out[key] = { kind: 'bool' };
        break;
      case 'model':
        out[key] = { kind: 'enum', options: modelIds(d.kinds) };
        break;
      case 'movepad':
        out[key] = d.single ? { kind: 'move' } : { kind: 'moves', max: 3 };
        break;
      case 'look':
        out[key] = { kind: 'enum', options: LOOKS };
        break;
      case 'body':
        out[key] = { kind: 'enum', options: BODIES };
        break;
      case 'aspect':
        out[key] = { kind: 'enum', options: ASPECTS };
        break;
      case 'cast':
        out[key] = { kind: 'cast' };
        break;
      case 'text':
      case 'textarea':
        out[key] = { kind: 'text' };
        break;
    }
  }
  return out;
}

const describe = (s: Spec) => {
  switch (s.kind) {
    case 'enum':
      return `one of ${s.options.map((o) => JSON.stringify(o)).join(' | ')}`;
    case 'list':
      return `a list of up to ${s.max} from ${s.options.map((o) => JSON.stringify(o)).join(', ')}`;
    case 'number':
      return `a number from ${s.min} to ${s.max}`;
    case 'bool':
      return 'true or false';
    case 'text':
      return 'text';
    case 'moves':
      return `a list of up to ${s.max} move ids, in order (the first one leads)`;
    case 'move':
      return 'one move id';
    case 'shots':
      return `a list of 2 to 8 shots, each {"prompt": "Wide: …", "model": ${modelIds(['video']).map((m) => JSON.stringify(m)).join(' | ')}, "duration": ${DURATIONS.map((d) => JSON.stringify(d)).join(' | ')}}`;
    case 'cast':
      return 'a cast member id from the cast list';
  }
};

const norm = (x: unknown) =>
  String(x ?? '')
    .toLowerCase()
    .replace(/[\s_]+/g, '');

function matchOption(options: string[], v: unknown) {
  const n = norm(v);
  if (!n) return undefined;
  return options.find((o) => norm(o) === n) ?? options.find((o) => /^\d+$/.test(n) && norm(o) === `${n}s`) ?? options.find((o) => n.length > 2 && norm(o).startsWith(n));
}

const moveId = (v: unknown) => {
  const n = norm(v).replace(/-/g, '');
  return MOVES.find((m) => norm(m.id).replace(/-/g, '') === n || norm(m.name).replace(/-/g, '') === n || m.alias?.some((a) => norm(a).replace(/-/g, '') === n))?.id;
};

/** One value, checked against what the setting takes; undefined drops it. */
function clean(spec: Spec, v: unknown, ctx: EngineCtx): unknown {
  switch (spec.kind) {
    case 'enum':
      return matchOption(spec.options, v);
    case 'list': {
      const raw = Array.isArray(v) ? v : String(v ?? '').split(',');
      const list = [...new Set(raw.map((x) => matchOption(spec.options, x)).filter((x): x is string => !!x))].slice(0, spec.max);
      return list.length ? list : undefined;
    }
    case 'number': {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      return Number.isFinite(n) ? clamp(Math.round(n), spec.min, spec.max) : undefined;
    }
    case 'bool':
      return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined;
    case 'text':
      return typeof v === 'string' && v.trim() ? v.trim().slice(0, 800) : undefined;
    case 'moves': {
      const list = [...new Set((Array.isArray(v) ? v : [v]).map(moveId).filter((x): x is string => !!x))].slice(0, spec.max);
      return list.length ? list : undefined;
    }
    case 'move':
      return moveId(v);
    case 'shots': {
      if (!Array.isArray(v)) return undefined;
      const video = modelIds(['video']);
      const shots = v
        .filter((s) => s && typeof s.prompt === 'string' && s.prompt.trim())
        .slice(0, 8)
        .map((s) => ({ prompt: String(s.prompt).trim().slice(0, 300), model: matchOption(video, s.model) ?? 'wan-2.2', duration: matchOption(DURATIONS, s.duration) ?? '3 s' }));
      return shots.length >= 1 ? shots : undefined;
    }
    case 'cast': {
      const n = norm(v).replace(/^@/, '');
      return ctx.cast.find((c) => norm(c.id) === n || norm(c.tag) === n || norm(c.name) === n)?.id;
    }
  }
}

/* ------------------------------------------------------------------ */
/* The prompt                                                          */
/* ------------------------------------------------------------------ */

function systemPrompt(ctx: EngineCtx) {
  const tools = APP_TOOLS.map((t) => {
    if (t.id === 'academy') return `- academy (${t.name}): ${t.tag}. Lessons on camera, prompts, models and ComfyUI. No settings: set "open": "academy".`;
    if (t.id === 'presets') return `- presets (${t.name}): the move library. No settings: to use a move, set up cinematic with it.`;
    const specs = specsFor(t.id, ctx);
    const keys = Object.entries(specs)
      .map(([k, s]) => `    ${k}: ${describe(s)}`)
      .join('\n');
    return `- ${t.id} (${t.name}): ${t.tag}. ${t.text}\n${keys}`;
  }).join('\n');
  const moves = MOVES.map((m) => `${m.id} (${m.name})`).join(', ');
  const models = MODELS.map((m) => `${m.id}: ${m.name}, ${m.kind}, ${m.note.toLowerCase()}`).join('; ');
  return `${agentIntro(APP_TOOLS)}

Answer with one JSON object and nothing else, no code fences:
{"reply": "...", "tool": "<tool id>" or null, "values": {...}, "render": false, "open": "<tool id>" or null, "chips": ["...", "..."]}

- reply: one to three short sentences to the user, in plain words and the user's language. No markdown.
- tool: the tool to set up, or null when you only answer a question.
- values: only settings listed for that tool, only with the allowed values. Leave out what the user didn't ask for: the tool's defaults fill the rest. Write the shot itself (who, where, light) into the text setting, without camera words.
- When the user changes one thing about the last shot ("make it 9:16", "try 85mm"), use the same tool and give only the changed settings.
- render: true only when the user says to go ahead (render, go, do it) and there is a shot ready.
- open: a tool page to offer, e.g. "academy" for a question you answer from what you know.
- chips: up to three short follow-ups the user might say next.

Tools and the settings they take:
${tools}

Move ids: ${moves}

Models: ${models}`;
}

function shotNote(m: Message) {
  if (!m.call) return '';
  return ` [set up ${m.call.tool}: ${m.call.title}; settings ${JSON.stringify(trimValues(m.call.values))}]`;
}

/** Settings without the long or private parts, for the model to read. */
function trimValues(v: Values) {
  const out: Values = {};
  for (const [k, x] of Object.entries(v)) {
    if (SKIP.has(k)) continue;
    out[k] = typeof x === 'string' && x.length > 300 ? `${x.slice(0, 300)}…` : x;
  }
  return out;
}

function userPrompt(text: string, ctx: EngineCtx) {
  const lines: string[] = [];
  if (ctx.cast.length) lines.push(`Cast: ${ctx.cast.map((c) => `${c.name} (@${c.tag}, id ${c.id})`).join(', ')}`);
  if (ctx.last) lines.push(`The last shot (${ctx.last.status}): ${ctx.last.tool}, ${JSON.stringify(trimValues(ctx.last.values))}`);
  const newest = ctx.assets.find((a) => !a.trashedAt);
  if (newest) lines.push(`Newest render: “${newest.name}”, ${newest.kind}${newest.duration ? `, ${newest.duration} s` : ''}`);
  lines.push(`The user says: ${text}`);
  return lines.join('\n');
}

/** Pull the first JSON object out of what the model wrote. */
function parse(raw: string): Record<string, unknown> | null {
  const text = raw.replace(/```(?:json)?/gi, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1));
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

/**
 * The model said go on the ready shot. The words are the built-in rules' "Render it" replies, because
 * the model can't see the card; only under YOLO, where it really runs, do the model's own words show.
 */
function goAhead(last: NonNullable<EngineCtx['last']>, yolo: boolean | undefined, said: { text: string; chips: string[] }): Reply {
  const reply = renderLast(last, yolo);
  const text = yolo && last.proposed !== false && said.text ? said.text : reply.text;
  return { ...reply, text, chips: said.chips };
}

/** The same values, in any key order. */
function sameValues(a: Values, b: Values) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

/** The model's answer as a chat reply, with every value checked. */
export function toReply(answer: Record<string, unknown>, ctx: EngineCtx): Reply | null {
  const text = typeof answer.reply === 'string' ? answer.reply.trim().slice(0, 1200) : '';
  const chips = Array.isArray(answer.chips) ? answer.chips.filter((c): c is string => typeof c === 'string' && !!c.trim()).map((c) => c.trim().slice(0, 60)).slice(0, 3) : [];
  const tool = APP_TOOLS.find((t) => t.id === answer.tool)?.id;
  const open = APP_TOOLS.find((t) => t.id === answer.open)?.id;
  const render = answer.render === true;
  if (!tool || tool === 'academy' || tool === 'presets') {
    if (!text && !render) return null;
    if (render && ctx.last?.status === 'ready') return goAhead(ctx.last, ctx.yolo, { text, chips });
    return { text: text || 'Here you go.', chips, open: open ?? (tool === 'academy' || tool === 'presets' ? tool : undefined) };
  }
  const specs = specsFor(tool, ctx);
  const raw = answer.values && typeof answer.values === 'object' ? (answer.values as Values) : {};
  const values: Values = {};
  for (const [k, v] of Object.entries(raw)) {
    const spec = specs[k];
    if (!spec) continue;
    const c = clean(spec, v, ctx);
    if (c !== undefined) values[k] = c;
  }
  // a change to the last shot keeps everything it doesn't touch
  const base = ctx.last?.tool === tool ? ctx.last.values : {};
  const merged = { ...base, ...values };
  // the shot the user said Not now to, asked for again unchanged, is that same shot: it stays down
  if (render && ctx.last?.proposed === false && ctx.last.tool === tool && sameValues(merged, ctx.last.values)) return goAhead(ctx.last, ctx.yolo, { text, chips });
  const call = toolCall(tool, merged, ctx);
  if (!call) return null;
  if (render && !ctx.yolo) return { text: AWAITING_APPROVAL, call, chips: chips.length ? chips : ['Render it'], render, open };
  return { text: text || `Set up in ${toolById(tool).name}.`, call, chips: chips.length ? chips : ['Render it'], render: render || undefined, open };
}

/* ------------------------------------------------------------------ */
/* Asking                                                              */
/* ------------------------------------------------------------------ */

type Turn = { role: 'user' | 'assistant'; content: string };

function history(messages: Message[]): Turn[] {
  return messages.slice(-8).map((m) => ({ role: m.role, content: m.role === 'user' ? m.text : `${m.text}${shotNote(m)}` }));
}

async function viaOpenRouter(system: string, turns: Turn[]): Promise<{ text: string; model: string }> {
  const key = secrets.value.openrouterKey;
  if (!key) throw new Error('Add your OpenRouter key in Settings → Providers.');
  const model = modelFor('openrouter');
  const effort = effortFor('openrouter');
  let r: Response;
  try {
    r = await fetch(`${OPENROUTER}/chat/completions`, {
      method: 'POST',
      // OpenRouter takes calls from web pages; the last two headers name the app in its dashboard
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'Kinemi', 'HTTP-Referer': location.origin },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...turns],
        temperature: 0.3,
        response_format: { type: 'json_object' },
        // how hard it thinks; OpenRouter maps the level onto whatever the model supports
        ...(effort ? { reasoning: { effort } } : {}),
      }),
      signal: AbortSignal.timeout?.(60_000),
    });
  } catch {
    throw new Error('OpenRouter didn’t answer.');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const why = r.status === 401 ? 'OpenRouter refused the key.' : r.status === 402 ? 'Your OpenRouter credits ran out.' : r.status === 429 ? 'OpenRouter is rate-limiting this key.' : `OpenRouter answered ${r.status}.`;
    throw new Error(why);
  }
  const text = j?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('OpenRouter sent an empty answer.');
  return { text, model: String(j.model || model) };
}

async function viaCli(cli: Cli, system: string, turns: Turn[]): Promise<{ text: string; model: string }> {
  const prompt = `${turns
    .slice(0, -1)
    .map((t) => `${t.role === 'user' ? 'User' : 'You'}: ${t.content}`)
    .join('\n')}\n\n${turns[turns.length - 1].content}\n\nAnswer with the JSON object only.`.trim();
  try {
    const out = await askLocal(cli, { system, prompt, model: modelFor(cli) || undefined, effort: effortFor(cli) || undefined });
    return { text: out.text, model: out.model || modelFor(cli) || 'default model' };
  } catch (e) {
    const info = CLI_INFO[cli];
    if (e instanceof LocalError) {
      if (e.code === 'offline') throw new Error(e.message);
      if (e.code === 'not-installed') throw new Error(`${info.name} isn’t installed: ${info.install}`);
      if (e.code === 'signed-out') throw new Error(`${info.name} needs you to sign in: run ${info.login} in a terminal once.`);
      if (e.code === 'timeout') throw new Error(`${info.name} took too long to answer.`);
    }
    throw new Error(`${info.name} couldn’t answer: ${(e as Error).message}`.slice(0, 240));
  }
}

/** Ask the assistant chosen in Settings. Resolves to a reply, or to a reason it couldn't give one. */
export async function askAssistant(text: string, ctx: EngineCtx, messages: Message[]): Promise<{ reply: Reply; by: string } | { error: string }> {
  const a = settings.value.assistant;
  if (a === 'builtin') return { error: 'The built-in assistant is on.' };
  const problem = assistantProblem(a);
  if (problem) return { error: problem };
  const system = systemPrompt(ctx);
  const turns: Turn[] = [...history(messages.filter((m) => m.text)), { role: 'user', content: userPrompt(text, ctx) }];
  try {
    const out = a === 'openrouter' ? await viaOpenRouter(system, turns) : await viaCli(a, system, turns);
    const answer = parse(out.text);
    const reply = answer && toReply(answer, ctx);
    if (!reply) return { error: `${ASSISTANTS[a].name} answered, but not with a shot Kinemi can set up.` };
    return { reply, by: `${ASSISTANTS[a].name} · ${out.model}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** A one-line check for Settings: does the assistant answer at all? */
export async function testAssistant(a: Exclude<Assistant, 'builtin'>): Promise<{ ok: boolean; text: string }> {
  const t0 = performance.now();
  try {
    const system = 'You are a connection test. Answer with the JSON object {"reply": "ready"} and nothing else.';
    const turns: Turn[] = [{ role: 'user', content: 'Are you there?' }];
    const out = a === 'openrouter' ? await viaOpenRouter(system, turns) : await viaCli(a, system, turns);
    const ok = /ready/i.test(out.text);
    return { ok, text: ok ? `Answered in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${out.model}` : `Answered, but not as asked: “${out.text.slice(0, 80)}”` };
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
}

