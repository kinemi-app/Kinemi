// The chat's language engine: reads plain words, picks one of the 16 tools,
// fills in its settings and hands back a tool call with the cost up front.
// It runs in the browser with simple rules; a hosted model can take its place behind `interpret`.
import { MOVES, type Move } from '../data/moves';
import { makePlan, planSummary } from '../tools/plan';
import { LESSONS, lessonById } from '../data/lessons';
import { BODIES, LENSES } from '../data/options';
import { MODELS, modelById, type ModelKind } from '../data/models';
import { APP_TOOLS, toolById, type ToolId } from '../data/tools';
import { buildFor, defaultsFor, latest, nearestAperture, shortTitle, type Ctx, type Shot, type Values } from '../tools/recipes';
import { sceneFor } from '../lib/scenes';
import { hash, pick, rng } from '../lib/util';
import { atATime } from '../prefs';
import type { ToolCall } from '../store';

export interface Reply {
  text: string;
  call?: ToolCall;
  chips?: string[];
  /** render the newest ready call in this chat */
  render?: boolean;
  /** offer to open a tool page */
  open?: ToolId;
}

export interface EngineCtx extends Ctx {
  last?: ToolCall;
  /** YOLO is on: a render starts at once instead of waiting for the owner's Approve */
  yolo?: boolean;
}

export const EXAMPLES = [
  'Slow dolly-in on a rain-soaked neon street, 35mm, f/1.8',
  'Orbit 30° to the left and tilt down. Leave the subject alone.',
  'Move this dance onto my cast character, joy to surprise',
  'Sunset over a desert motel, as a five-colour palette',
  'Storyboard a chase through a night market in five shots',
  'Upscale the last clip to 4K at 60 fps',
];

/* ------------------------------------------------------------------ */
/* Which tool                                                          */
/* ------------------------------------------------------------------ */

const SIGNALS: Array<[ToolId, RegExp, number]> = [
  ['cinematic', /\b(dolly|crane|pan|tracking|handheld|steadicam|drone|shot|lens|\d{2,3}\s?mm|f\s?\/\s?\d|aperture|zoom|push in|pull back|slow motion|whip|flyover|close-?up)/gi, 1],
  ['reshoot', /\b(re-?shoot|new angle|different angle|change the angle|leave the subject|keep the subject|subject alone|orbit\s+-?\d+\s?(°|deg)|from (the side|above|below))/gi, 2.2],
  ['storyboard', /\b(storyboard|shot ?list|sequence|scene by scene|\d+ shots|(three|four|five|six|seven|eight) shots)\b/gi, 2],
  ['genjutsu', /\b(motion transfer|transfer|performance|dance|onto|face swap|joy|sadness|surprise|anger|fear|disgust|anticipation)\b/gi, 1.3],
  ['presets', /\b(presets?|move library|which moves|what moves|camera moves|list (the )?moves|show (me )?moves)\b/gi, 2],
  ['soul', /\b(palette|colou?rs?|hex|swatch(es)?|mood ?board|five-colou?r)\b/gi, 1.8],
  ['cast', /\b(character|cast member|actor|identity|persona|named|called)\b/gi, 1.6],
  ['edit', /\b(remove|replace|take out|erase|clean up|change the|swap the sky|make it (rain|snow|night|day))\b/gi, 1.4],
  ['academy', /\b(learn|teach|tutorial|lesson|how do i|how to|explain|what is|what's an?|what does)\b/gi, 1.6],
  ['audio', /\b(voice|voiceover|narrat\w*|dub\w*|sound effects?|sfx|audio|music|clone my voice|speakers?)\b/gi, 1.8],
  ['marketing', /\b(ads?|advert\w*|product|ugc|hooks?|url|commercial|promo|tiktok)\b/gi, 1.4],
  ['fashion', /\b(garment|outfit|dress|coat|jacket|trench|fashion|lookbook|runway|model swap|influencer|wear\w*)\b/gi, 1.4],
  ['canvas', /\b(pipeline|nodes?|graph|workflow|chain)\b/gi, 2.6],
  ['previz', /\b(previz|pre-viz|3d|blocking|block out|block-out|glb|after effects|keyframes)\b/gi, 2],
  ['supercomputer', /\b(campaign|batch(es)?|brief|variations|cli|at scale|in bulk|production run|deliverables|every channel|\d+ (versions|variants|cities|markets|countries|places)|(three|four|five|six) (cities|markets|countries|places))\b/gi, 2.4],
  ['upscale', /\b(upscale|4k|60 ?fps|interpolat\w*|deflicker|sharpen)\b/gi, 2.2],
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function scoreTools(text: string): Array<[ToolId, number]> {
  const scores = new Map<ToolId, number>();
  const add = (t: ToolId, n: number) => scores.set(t, (scores.get(t) ?? 0) + n);
  for (const [tool, re, w] of SIGNALS) {
    const n = (text.match(re) || []).length;
    if (n) add(tool, n * w);
  }
  for (const t of APP_TOOLS) {
    const names = [t.name, t.slug.replace(/-/g, ' ')].map((n) => esc(n.toLowerCase()));
    if (new RegExp(`(^|@|\\b(in|use|with|open|run)\\s+)(${names.join('|')})\\b`, 'i').test(text)) add(t.id, 5);
    else if (t.id !== 'edit' && t.id !== 'canvas' && new RegExp(`\\b(${names.join('|')})\\b`, 'i').test(text)) add(t.id, 2);
  }
  return [...scores].sort((a, b) => b[1] - a[1]);
}

/* ------------------------------------------------------------------ */
/* Settings from plain words                                           */
/* ------------------------------------------------------------------ */

const ALIASES: Array<[string, Move]> = MOVES.flatMap((m) => [m.name.toLowerCase(), ...(m.alias ?? [])].map((a) => [a.toLowerCase(), m] as [string, Move])).sort(
  (a, b) => b[0].length - a[0].length,
);

/** Camera moves in the order they appear, and the words that named them. */
export function findMoves(text: string) {
  const lower = text.toLowerCase();
  const found: Array<{ at: number; move: Move; alias: string }> = [];
  const taken: Array<[number, number]> = [];
  for (const [alias, move] of ALIASES) {
    const re = new RegExp(`(^|[^a-z])${esc(alias)}(?![a-z])`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower))) {
      const at = m.index + m[1].length;
      if (taken.some(([a, b]) => at < b && at + alias.length > a)) continue;
      taken.push([at, at + alias.length]);
      if (!found.some((f) => f.move.id === move.id)) found.push({ at, move, alias });
    }
  }
  return found.sort((a, b) => a.at - b.at).slice(0, 3);
}

export function findLens(text: string) {
  if (/anamorphic/i.test(text)) return '40mm anamorphic';
  const m = text.match(/\b(\d{2,3})\s?mm\b/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return LENSES.filter((l) => !l.includes('anamorphic')).reduce((best, l) => (Math.abs(parseInt(l) - n) < Math.abs(parseInt(best) - n) ? l : best));
}

export function findAperture(text: string) {
  const m = text.match(/\bf\s?\/\s?(\d+(?:\.\d+)?)/i) || text.match(/\bf(\d+(?:\.\d)?)\b/i);
  return m ? nearestAperture(Number(m[1])) : undefined;
}

export function findAspect(text: string) {
  const m = text.match(/\b(16:9|9:16|2\.39:1|1:1|4:5)\b/);
  if (m) return m[1];
  if (/\b(vertical|portrait mode|reels?|stories|tiktok)\b/i.test(text)) return '9:16';
  if (/\bsquare\b/i.test(text)) return '1:1';
  if (/\b(scope|widescreen|anamorphic|cinemascope)\b/i.test(text)) return '2.39:1';
  return undefined;
}

export function findDuration(text: string) {
  const m = text.match(/\b(\d{1,2})\s?(?:s|sec|secs|seconds)\b/i);
  return m ? Number(m[1]) : undefined;
}

export function findModel(text: string, kinds: ModelKind[]) {
  const lower = text.toLowerCase();
  const list = MODELS.filter((m) => kinds.includes(m.kind));
  const exact = list.find((m) => lower.includes(m.name.toLowerCase()));
  if (exact) return exact.id;
  const vendor = list.find((m) => new RegExp(`\\b${esc(m.vendor.toLowerCase())}\\b`).test(lower));
  if (vendor) return vendor.id;
  if (/\b(draft|quick|fast render|cheap)\b/i.test(text) && kinds.includes('video')) return 'ltx-video';
  return undefined;
}

const LOOK_WORDS: Array<[RegExp, string]> = [
  [/\b(neon|noir)\b/i, 'Neon noir'],
  [/\b(golden|sunset|sunrise|dawn)\b/i, 'Golden hour'],
  [/\b(blue hour|dusk|twilight)\b/i, 'Blue hour'],
  [/\bbleach/i, 'Bleach bypass'],
  [/\b(warm|film grain|filmic)\b/i, 'Warm film'],
  [/\b(cold|steel|clinical)\b/i, 'Cold steel'],
  [/\b(pastel|soft colou?rs?)\b/i, 'Pastel'],
  [/\b(black and white|black-and-white|b&w|monochrome)\b/i, 'Monochrome'],
  [/\bday for night\b/i, 'Day for night'],
];

export const findLook = (text: string) => LOOK_WORDS.find(([re]) => re.test(text))?.[1];

/** When the prompt names no look or move, pick one that suits the place. */
const SCENE_LOOK: Record<string, string> = {
  neon: 'Neon noir',
  desert: 'Golden hour',
  ocean: 'Blue hour',
  forest: 'Warm film',
  mountain: 'Blue hour',
  portrait: 'Warm film',
  product: 'Cold steel',
  fashion: 'Pastel',
  space: 'Cold steel',
  interior: 'Warm film',
};
const SCENE_MOVE: Record<string, string> = {
  neon: 'dolly-in',
  desert: 'crane-down',
  ocean: 'crane-up',
  forest: 'tracking',
  mountain: 'drone-reveal',
  portrait: 'push-in',
  product: 'orbit-right',
  fashion: 'tracking',
  space: 'orbit-left',
  interior: 'steadicam',
};

export function findBody(text: string) {
  if (/\bvhs|camcorder\b/i.test(text)) return BODIES[5];
  if (/\bsuper ?8\b/i.test(text)) return BODIES[4];
  if (/\b16\s?mm\b/i.test(text)) return BODIES[3];
  if (/\b35\s?mm film|film stock|on film\b/i.test(text)) return BODIES[2];
  if (/\bsuper 35\b/i.test(text)) return BODIES[1];
  return undefined;
}

export const findSpeed = (text: string) => (/\bslow(ly)?\b/i.test(text) ? 'Slow' : /\b(fast|quick|rapid|whip)\b/i.test(text) ? 'Fast' : undefined);

const EMOTION_WORDS: Array<[RegExp, string]> = [
  [/\b(joy|happy|happiness|joyful|smil\w*)\b/i, 'Joy'],
  [/\b(trust|calm|serene|warmth)\b/i, 'Trust'],
  [/\b(fear|scared|afraid|terrified)\b/i, 'Fear'],
  [/\b(surprise|surprised|shock\w*|astonish\w*)\b/i, 'Surprise'],
  [/\b(sad|sadness|grief|tears)\b/i, 'Sadness'],
  [/\b(disgust\w*|revulsion)\b/i, 'Disgust'],
  [/\b(anger|angry|rage|furious)\b/i, 'Anger'],
  [/\b(anticipation|excited|eager|hope\w*)\b/i, 'Anticipation'],
];

export function findEmotions(text: string) {
  const hits: Array<[number, string]> = [];
  for (const [re, e] of EMOTION_WORDS) {
    const m = re.exec(text);
    if (m) hits.push([m.index, e]);
  }
  return hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]);
}

export function findDegrees(text: string) {
  const m = text.match(/(-?\d{1,3})\s?(?:°|deg\b|degrees?)/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const left = /\bleft\b/i.test(text);
  const right = /\bright\b/i.test(text);
  return left ? -Math.abs(n) : right ? Math.abs(n) : n;
}

function findCast(text: string, ctx: Ctx) {
  const lower = text.toLowerCase();
  return ctx.cast.find((c) => lower.includes(`@${c.tag}`) || new RegExp(`\\b${esc(c.name.toLowerCase())}\\b`).test(lower));
}

const NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

function findCount(text: string, noun: RegExp) {
  const m = text.match(new RegExp(`\\b(\\d{1,2}|two|three|four|five|six|seven|eight)\\s+${noun.source}`, 'i'));
  if (!m) return undefined;
  return NUMBERS[m[1].toLowerCase()] ?? Number(m[1]);
}

/** The scene a prompt describes, with the camera words taken out. */
export function subjectOf(text: string, aliases: string[] = []) {
  let s = ` ${text.replace(/^\s*use\s+[\w\s.-]+?:\s*/i, '')} `;
  for (const a of aliases) {
    s = s.replace(
      new RegExp(
        `(?:\\b(?:a|an|the)\\s+)?(?:\\b(?:slow|slowly|fast|quick|smooth|gentle|steady)\\s+)?${esc(a)}(?:\\s+shot)?(?:\\s+(?:on|onto|toward|towards|to|into|of|over|around|across|through|past|at|in|along|above))?`,
        'i',
      ),
      ' ',
    );
  }
  s = s
    .replace(/\b\d{2,3}\s?mm( lens)?\b/gi, ' ')
    .replace(/\bf\s?\/\s?\d+(?:\.\d+)?/gi, ' ')
    .replace(/\b(16:9|9:16|2\.39:1|1:1|4:5)\b/g, ' ')
    .replace(/\b\d{1,2}\s?(?:s|sec|secs|seconds)\b/gi, ' ')
    .replace(/\b(in|on|with|using)\s+(wan|ltx|hunyuan|flux|qwen)[\w .-]*/gi, ' ')
    .replace(/\b(please|can you|could you|i want|i'd like|give me|make me|render|create|generate)\b/gi, ' ')
    .replace(/\s*,(\s*,)+/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '');
  return s;
}

/* ------------------------------------------------------------------ */
/* Tool calls                                                          */
/* ------------------------------------------------------------------ */

function call(tool: ToolId, values: Values, ctx: Ctx): ToolCall | undefined {
  const full = { ...defaultsFor(tool, ctx), ...values };
  const b = buildFor(tool, full, ctx);
  if (!b) return undefined;
  return { tool, values: full, title: b.title, params: b.params, prompt: b.prompt, estimate: b.estimate, spec: b.spec, status: 'ready' };
}

/** A ready tool call from a tool's settings (its defaults fill the rest). The language models use it too. */
export const toolCall = call;

const SIZES = ['Wide', 'Medium', 'Close-up', 'Insert', 'Over the shoulder', 'Low angle', 'Aerial', 'Detail'];

function shotsFrom(text: string, count: number | undefined): Shot[] {
  const body = text.replace(/\b(storyboard|shot ?list|in\s+\w+\s+shots|\d+\s+shots|as a sequence)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const parts = body
    .split(/\bthen\b|;|\n|\.\s/i)
    .map((p) => p.replace(/^[\s,.-]+|[\s,.-]+$/g, ''))
    .filter((p) => p.length > 3);
  const n = Math.min(8, Math.max(2, count ?? (parts.length > 1 ? parts.length : 4)));
  const subject = subjectOf(parts[0] ?? body) || 'the scene';
  return Array.from({ length: n }, (_, i) => ({
    prompt: parts.length > 1 && parts[i] ? `${SIZES[i % SIZES.length]}: ${parts[i]}` : `${SIZES[i % SIZES.length]}: ${subject.charAt(0).toLowerCase()}${subject.slice(1)}`,
    model: i % 2 ? 'wan-2.2' : 'ltx-video',
    duration: i === 0 ? '5 s' : '3 s',
  }));
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Build the reply for a fresh request aimed at one tool. */
function forTool(tool: ToolId, text: string, ctx: EngineCtx): Reply {
  const r = rng(hash(text));
  switch (tool) {
    case 'cinematic':
    case 'presets': {
      const moves = findMoves(text);
      const rest = text.replace(/\b(show|me|list|all|the|camera|moves?|presets?|library|which|what|are|there|available|give|some|good|best|from|for|a|an|of)\b/gi, ' ');
      if (tool === 'presets' && !moves.length && !/\w{4,}/.test(rest)) {
        const words = text.toLowerCase();
        const picks = MOVES.filter((m) => words.includes(m.group.toLowerCase()) || words.includes(m.fx.split('-')[0])).slice(0, 4);
        const show = (picks.length ? picks : [MOVES[0], MOVES[27], MOVES[16], MOVES[36]]).slice(0, 4);
        return {
          text: `The move library has 60 moves, each with the prompt it writes. A few to start: ${list(show.map((m) => m.name))}. Pick one and I'll drop it into a shot.`,
          chips: show.map((m) => `Use ${m.name}`),
          open: 'presets',
        };
      }
      const values: Values = {};
      const subject = subjectOf(text, moves.map((m) => m.alias));
      if (subject) values.prompt = subject;
      else if (ctx.last?.tool === 'cinematic') values.prompt = (ctx.last.values as Values).prompt;
      if (moves.length) values.moves = moves.map((m) => m.move.id);
      const speed = findSpeed(text);
      if (speed) values.speed = speed;
      else if (moves.length) values.speed = 'Normal';
      const lens = findLens(text);
      if (lens) values.lens = lens;
      const ap = findAperture(text);
      if (ap) values.aperture = ap;
      const scene = sceneFor(String(values.prompt ?? text));
      if (!moves.length && tool === 'cinematic') values.moves = [SCENE_MOVE[scene] ?? 'dolly-in'];
      values.look = findLook(text) ?? SCENE_LOOK[scene] ?? 'Neon noir';
      const body = findBody(text);
      if (body) values.body = body;
      const aspect = findAspect(text);
      if (aspect) values.aspect = aspect;
      const d = findDuration(text);
      if (d) values.duration = `${d} s`;
      const model = findModel(text, ['video']);
      if (model) values.model = model;
      const c = call('cinematic', values, ctx)!;
      const v = c.values as Values;
      const moveNames = (v.moves as string[]).map((id) => MOVES.find((m) => m.id === id)!.name.toLowerCase());
      const open = pick(r, ['That’s a Cinematic shot.', 'Cinematic it is.', 'One shot, coming up in Cinematic.']);
      return {
        text: `${open} ${cap(list(moveNames) || 'a locked-off camera')} on a ${v.lens} lens at ${v.aperture}, ${String(v.look).toLowerCase()} look, on ${modelById(v.model).name}. Here’s the cost before you render.`,
        call: c,
        chips: ['Render it', v.aspect === '9:16' ? 'Make it 2.39:1' : 'Make it 9:16', v.lens === '85mm' ? 'Try 24mm' : 'Try 85mm', 'Add an orbit'],
      };
    }

    case 'reshoot': {
      const src = latest(ctx, ['still', 'video']);
      if (!src) return { text: 'Re-shoot works on a finished image. Render a shot first, or import a still into Assets, and I’ll change the angle.', chips: [EXAMPLES[0]] };
      const deg = findDegrees(text);
      const values: Values = { source: src.id };
      if (deg !== undefined) values.orbit = Math.max(-180, Math.min(180, deg));
      if (/tilt(ed)?\s+down|from above|look(ing)? down/i.test(text)) values.tilt = -10;
      else if (/tilt(ed)?\s+up|from below|look(ing)? up/i.test(text)) values.tilt = 10;
      if (/\b(dutch|roll|cant)\b/i.test(text)) values.level = 8;
      if (/\b(turn|let the subject|free)\b/i.test(text)) values.lock = false;
      const model = findModel(text, ['edit']);
      if (model) values.model = model;
      const c = call('reshoot', values, ctx)!;
      const v = c.values as Values;
      return {
        text: `Re-shoot it is. I’ll take “${src.name}”, orbit ${Math.abs(v.orbit)}° to the ${v.orbit < 0 ? 'left' : 'right'}${v.tilt ? ` and tilt ${v.tilt < 0 ? 'down' : 'up'} ${Math.abs(v.tilt)}°` : ''}, with ${v.lock ? 'the subject left alone' : 'the subject free to turn'}.`,
        call: c,
        chips: ['Render it', 'Orbit 60° instead', 'Keep it level', 'Upscale it after'],
      };
    }

    case 'genjutsu': {
      const src = latest(ctx, ['video']);
      const who = findCast(text, ctx) ?? ctx.cast[0];
      const emotions = findEmotions(text);
      const values: Values = { source: src?.id ?? '', target: who?.id ?? '' };
      if (emotions[0]) values.from = emotions[0];
      if (emotions[1]) values.to = emotions[1];
      const c = call('genjutsu', values, ctx)!;
      const v = c.values as Values;
      return {
        text: `Genjutsu takes the performance from ${src ? `“${src.name}”` : 'your source clip'} and moves it onto ${who ? `${who.name} (@${who.tag})` : 'the face you drop in'}, from ${String(v.from).toLowerCase()} to ${String(v.to).toLowerCase()}.`,
        call: c,
        chips: ['Render it', 'Softer, 40% intensity', `Use ${ctx.cast[1]?.name ?? 'another face'}`],
      };
    }

    case 'storyboard': {
      const shots = shotsFrom(text, findCount(text, /shots?/));
      const values: Values = { shots };
      const aspect = findAspect(text);
      if (aspect) values.aspect = aspect;
      const look = findLook(text);
      if (look) values.look = look;
      const c = call('storyboard', values, ctx)!;
      return {
        text: `Here’s a shot list with ${shots.length} shots. Each has its own prompt, model and length, and they render in order. Open it in Storyboard to reorder or rewrite a shot.`,
        call: c,
        chips: ['Render it', 'Add a close-up', 'Make it 9:16'],
        open: 'storyboard',
      };
    }

    case 'soul': {
      const sentenceText = subjectOf(text.replace(/,?\s*(as|into|in)\s+(a\s+)?(five|5)-?\s?colou?r\s+palette/i, '').replace(/\b(palette|colou?rs?|hex)\b/gi, ''));
      const c = call('soul', { sentence: sentenceText || text, palette: [] }, ctx)!;
      const pal = (c.values as Values).palette?.length ? (c.values as Values).palette : c.spec.palette ?? [];
      return {
        text: `Soul pulled five colours out of that line and locks them for the still: ${pal.join(', ')}.`,
        call: c,
        chips: ['Render it', 'Warmer', 'Try the Noir preset'],
      };
    }

    case 'cast': {
      const named = text.match(/\b(?:named|called)\s+([A-Z][a-z]+)/) ?? text.match(/\b([A-Z][a-z]{2,})\b(?=,|\s+(?:is|who|with|a|an)\b)/);
      const name = named?.[1] ?? pick(r, ['Noor', 'Kai', 'Lena', 'Tomas', 'Yara', 'Jun']);
      const look = subjectOf(text.replace(/\b(create|build|make|a|new|character|cast|named|called|for my cast)\b/gi, ' ').replace(name, ''));
      const c = call('cast', { name, look: look || defaultsFor('cast', ctx).look }, ctx)!;
      return {
        text: `Meet ${name}. I’ll lock the identity and render eight emotions, then you can drop @${name.toLowerCase()} into any prompt.`,
        call: c,
        chips: ['Render it', 'Unlock the identity', 'Open AI Cast'],
      };
    }

    case 'edit': {
      const src = latest(ctx, ['video']);
      if (!src) return { text: 'Edit works on a finished clip. Render one first and tell me what should change.', chips: [EXAMPLES[0]] };
      const strength = /\b(subtle|slight|light|gentle)\b/i.test(text) ? 30 : /\b(heavy|hard|strong|completely)\b/i.test(text) ? 85 : undefined;
      const values: Values = { source: src.id, change: text };
      if (strength) values.strength = strength;
      const model = findModel(text, ['video']);
      if (model) values.model = model;
      const c = call('edit', values, ctx)!;
      return {
        text: `Edit on “${src.name}”: ${shortTitle(text, 60).toLowerCase()}. It re-renders on ${modelById((c.values as Values).model).name} and keeps the rest of the clip.`,
        call: c,
        chips: ['Render it', 'Make it subtler', 'Make it stronger'],
      };
    }

    case 'academy': {
      const lower = text.toLowerCase();
      const pick = (id: string) => lessonById(id) ?? LESSONS[0];
      const lesson =
        LESSONS.find((l) => lower.includes(l.id) || l.title.toLowerCase().split(' ').some((w) => w.length > 5 && lower.includes(w))) ??
        (/(install|folder|safetensors|model files?)/.test(lower)
          ? pick('install')
          : /(comfy|gpu|connect|key)/.test(lower)
            ? pick('comfy')
            : /(lens|aperture|mm|f\/)/.test(lower)
              ? pick('lenses')
              : /(model|weights|wan|flux)/.test(lower)
                ? pick('open-weights')
                : /(cost|credit|price)/.test(lower)
                  ? pick('cost')
                  : /(light|golden|look|grade)/.test(lower)
                    ? pick('light')
                    : /(seed|sampler|node|graph|vae)/.test(lower)
                      ? pick('graph')
                      : LESSONS[0]);
      return {
        text: `The Academy has ${LESSONS.length} short lessons. For this, start with “${lesson.title}” (${lesson.minutes} min): ${lesson.summary}`,
        chips: ['Open Academy', 'What does f/1.8 do?', 'How do I connect my Comfy?'],
        open: 'academy',
      };
    }

    case 'audio': {
      const mode = /clone/i.test(text) ? 'Voice clone' : /dub/i.test(text) ? 'Dubbing' : /(multi|conversation|dialogue|two speakers)/i.test(text) ? 'Multi-speaker' : /(sfx|sound effect|ambience|foley)/i.test(text) ? 'Sound effects' : 'Voiceover';
      const quoted = text.match(/[“"]([^”"]+)[”"]/);
      const values: Values = { mode, script: quoted?.[1] ?? subjectOf(text.replace(/\b(voiceover|voice over|voice|narration|narrate|dub|dubbing|audio|sound effects?|for|of|a|an)\b/gi, ' ')) };
      const lang = ['German', 'Spanish', 'French', 'Japanese', 'Portuguese', 'Hindi', 'Turkish'].find((l) => new RegExp(`\\b${l}\\b`, 'i').test(text));
      if (lang) values.language = lang;
      const d = findDuration(text);
      if (d) values.length = d;
      const c = call('audio', values, ctx)!;
      const v = c.values as Values;
      return { text: `Audio Studio: ${String(v.mode).toLowerCase()} in ${v.language}, voice “${v.voice}”.`, call: c, chips: ['Render it', 'Use my cloned voice', 'Dub it into Spanish'] };
    }

    case 'marketing': {
      const values: Values = {};
      const product = subjectOf(
        text
          .replace(/\bwith\s+(\d+|two|three|four|five|six)\s+(hooks?|variations?|versions?)\b/gi, ' ')
          .replace(/\b(an?|the)?\s*(ad|advert\w*|commercial|promo|ugc|hooks?|for|tiktok|video)\b/gi, ' '),
      );
      if (product) values.product = product;
      if (/\bugc\b/i.test(text)) values.template = 'UGC';
      else if (/\btutorial|how-?to\b/i.test(text)) values.template = 'Tutorial';
      const hooks = findCount(text, /(hooks?|variations?|versions?)/);
      if (hooks) values.hooks = Math.min(6, hooks);
      const aspect = findAspect(text);
      if (aspect) values.aspect = aspect;
      const c = call('marketing', values, ctx)!;
      const v = c.values as Values;
      return { text: `Marketing Studio: ${v.template === 'Ad' ? 'an ad' : `a ${String(v.template).toLowerCase()}`} for ${v.product}, ${v.hooks} hook variations at ${v.aspect}.`, call: c, chips: ['Render it', 'Six hooks', 'Make it UGC'] };
    }

    case 'fashion': {
      const who = findCast(text, ctx);
      const garment = text.match(
        /\b(?:a|an|the)\s+((?:[\w-]+\s+){0,4}?(?:trench coat|rain coat|coat|dress|jacket|trench|suit|shirt|skirt|hoodie|gown|blazer|sneakers?|boots))\b/i,
      )?.[1];
      const values: Values = {};
      if (garment) values.garment = garment;
      if (who) values.who = who.id;
      if (/swap (the )?model|different model/i.test(text)) values.mode = 'Swap model';
      else if (/campaign|influencer/i.test(text)) values.mode = 'Campaign';
      const looks = findCount(text, /(looks?|shots?|images?)/);
      if (looks) values.looks = looks;
      const c = call('fashion', values, ctx)!;
      const v = c.values as Values;
      const w = ctx.cast.find((x) => x.id === v.who);
      return {
        text: `Fashion Factory: ${String(v.garment).toLowerCase()} on ${w ? `${w.name}` : 'the model'}, drape and lighting kept, ${v.looks} looks.`,
        call: c,
        chips: ['Render it', 'Swap the model too', 'Build a campaign'],
      };
    }

    case 'canvas': {
      const prompt = subjectOf(text.replace(/\b(pipeline|nodes?|graph|workflow|chain|wire|build|a|an)\b/gi, ' '));
      const c = call('canvas', prompt.length > 6 ? { prompt } : {}, ctx)!;
      return { text: `I wired a Canvas pipeline: ${c.params[1][1]}. Save it from Canvas to share the graph with your team.`, call: c, chips: ['Render it', 'Open Canvas'], open: 'canvas' };
    }

    case 'previz': {
      const moves = findMoves(text);
      const values: Values = {};
      if (moves[0]) values.move = moves[0].move.id;
      const lens = findLens(text);
      if (lens) values.lens = lens;
      const set = /desert|motel/i.test(text) ? 'Desert motel' : /room|interior|kitchen/i.test(text) ? 'Interior' : /roof/i.test(text) ? 'Rooftop' : undefined;
      if (set) values.set = set;
      const c = call('previz', values, ctx)!;
      const v = c.values as Values;
      return { text: `3D Previz: a ${String(v.set).toLowerCase()} block-out with ${c.params[1][1].toLowerCase()} on a ${v.lens}. You get a GLB, a clip and camera keyframes for After Effects.`, call: c, chips: ['Render it', 'Open 3D Previz'], open: 'previz' };
    }

    case 'supercomputer': {
      const subject = text
        .replace(/^(plan|run|build|make|start|set up)\s+(a|an|the|me a)?\s*(campaign|batch|production run)\s*(for|around|about|of|:)?\s*/i, '')
        .replace(/\s+in (\w+|\d+) (cities|places|markets|countries)\b/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      const values: Values = subject ? { campaign: shortTitle(subject.split(/\s+(with|and|for|across)\s+/i)[0], 28), subject } : {};
      if (/\blooks?\b/i.test(text)) values.axis = 'Looks';
      const takes = findCount(text, /(takes?|versions?|variations?)/);
      if (takes && !/\bcit(y|ies)\b/i.test(text)) Object.assign(values, { axis: 'Takes', takes: Math.min(6, Math.max(2, takes)) });
      if (/\b(ad|ads|product)\b/i.test(text)) values.rows = ['hero', 'vertical', 'ad', 'lookbook'];
      const c = call('supercomputer', values, ctx)!;
      const v = c.values as Values;
      const plan = makePlan(v, ctx);
      return {
        text: `That’s a production run, so I set it up in Supercomputer: ${planSummary(plan)}, about ${plan.estimate.credits} credits against a ${plan.budget} budget. Open the plan to switch cells off, move the budget and run the batch ${atATime()}.`,
        call: c,
        chips: [(v.rows as string[]).includes('ad') ? 'Add a voiceover' : 'Add a product ad', 'Use looks instead', 'Budget 200'],
      };
    }

    case 'upscale': {
      const src = latest({ ...ctx, assets: ctx.assets.filter((a) => a.tool !== 'upscale') }, ['video', 'still']);
      if (!src) return { text: 'Upscale works on a finished render. Make one first and I’ll take it to 4K.', chips: [EXAMPLES[0]] };
      const values: Values = { source: src.id };
      if (/\b48 ?fps\b/i.test(text)) values.fps = '48 fps';
      if (/\bno interpolation|keep the frame ?rate\b/i.test(text)) values.fps = 'Off';
      const c = call('upscale', values, ctx)!;
      return { text: `Upscale “${src.name}” to 4K${src.kind === 'video' ? `, interpolated to ${(c.values as Values).fps} with deflicker` : ''}.`, call: c, chips: ['Render it'] };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Follow-ups: change one thing on the last call                       */
/* ------------------------------------------------------------------ */

function followUp(text: string, ctx: EngineCtx): Reply | null {
  const last = ctx.last;
  if (!last) return null;
  const v: Values = { ...(last.values as Values) };
  const changes: string[] = [];
  const set = (key: string, value: unknown, label: string) => {
    if (v[key] !== value) {
      v[key] = value;
      changes.push(label);
    }
  };

  if (last.tool === 'cinematic' || last.tool === 'presets') {
    const moves = findMoves(text);
    if (moves.length) {
      const ids = moves.map((m) => m.move.id);
      const next = /\b(add|also|and then|plus|stack)\b/i.test(text) ? [...new Set([...(v.moves as string[]), ...ids])].slice(0, 3) : ids;
      set('moves', next, `moves: ${next.map((id) => MOVES.find((m) => m.id === id)!.name.toLowerCase()).join(' + ')}`);
    }
    const lens = findLens(text);
    if (lens) set('lens', lens, `lens ${lens}`);
    const ap = findAperture(text);
    if (ap) set('aperture', ap, `aperture ${ap}`);
    const look = findLook(text);
    if (look) set('look', look, `${look.toLowerCase()} look`);
    const body = findBody(text);
    if (body) set('body', body, body.toLowerCase());
    const speed = findSpeed(text) ?? (/\bslower\b/i.test(text) ? 'Slow' : /\bfaster\b/i.test(text) ? 'Fast' : undefined);
    if (speed) set('speed', speed, `${speed.toLowerCase()} move`);
    const model = findModel(text, ['video']);
    if (model) set('model', model, modelById(model).name);
  }
  if (last.tool === 'reshoot') {
    const deg = findDegrees(text);
    if (deg !== undefined) set('orbit', deg, `orbit ${Math.abs(deg)}° ${deg < 0 ? 'left' : 'right'}`);
    if (/\b(level|straight)\b/i.test(text)) {
      set('tilt', 0, 'no tilt');
      set('level', 0, 'level horizon');
    }
  }
  if (last.tool === 'genjutsu') {
    const pct = text.match(/(\d{1,3})\s?%/);
    if (pct) set('intensity', Math.min(100, Number(pct[1])), `intensity ${pct[1]}%`);
    else if (/\b(softer|subtler|less)\b/i.test(text)) set('intensity', 40, 'intensity 40%');
    const who = findCast(text, ctx);
    if (who) set('target', who.id, `onto ${who.name}`);
    const em = findEmotions(text);
    if (em.length === 2) {
      set('from', em[0], `from ${em[0].toLowerCase()}`);
      set('to', em[1], `to ${em[1].toLowerCase()}`);
    }
  }
  if (last.tool === 'edit') {
    if (/\b(subtler|softer|lighter)\b/i.test(text)) set('strength', 30, 'strength 30%');
    if (/\b(stronger|harder|heavier)\b/i.test(text)) set('strength', 85, 'strength 85%');
  }
  if (last.tool === 'soul') {
    if (/\bwarmer\b/i.test(text)) set('sentence', `${v.sentence}, warm late light`, 'warmer');
    if (/\bcooler|colder\b/i.test(text)) set('sentence', `${v.sentence}, cold blue light`, 'cooler');
    const preset = ['Editorial', 'Dream film', 'Hard flash', 'Noir', 'Vapor', 'Analog', 'Sun bleached', 'Night market'].find((p) => new RegExp(`\\b${p}\\b`, 'i').test(text));
    if (preset) set('preset', preset, `${preset} preset`);
    if (changes.length) v.palette = [];
  }
  if (last.tool === 'marketing') {
    const hooks = findCount(text, /(hooks?|variations?)/);
    if (hooks) set('hooks', Math.min(6, hooks), `${hooks} hooks`);
    if (/\bugc\b/i.test(text)) set('template', 'UGC', 'UGC template');
  }
  if (last.tool === 'supercomputer') {
    const rows = v.rows as string[];
    if (/\b(product )?ad\b/i.test(text) && !rows.includes('ad')) set('rows', [...rows, 'ad'], 'a product ad');
    if (/\bvoice ?over\b/i.test(text) && !rows.includes('voice')) set('rows', [...rows, 'voice'], 'a voiceover');
    if (/\blooks?\b/i.test(text)) set('axis', 'Looks', 'looks as columns');
    if (/\bcities|places\b/i.test(text)) set('axis', 'Places', 'places as columns');
    const budget = text.match(/\bbudget\D{0,12}(\d{2,4})/i);
    if (budget) set('budget', Number(budget[1]), `a budget of ${budget[1]} credits`);
  }
  if (last.tool === 'storyboard' && /\b(add|another)\b.*\b(close-?up|wide|insert|shot)\b/i.test(text)) {
    const shots = [...(v.shots as Shot[])];
    if (shots.length < 8) {
      const size = /close/i.test(text) ? 'Close-up' : /wide/i.test(text) ? 'Wide' : 'Insert';
      shots.push({ prompt: `${size}: ${shots[0].prompt.replace(/^[\w -]+:\s*/, '')}`, model: 'wan-2.2', duration: '3 s' });
      set('shots', shots, `one more shot (${size.toLowerCase()})`);
    }
  }
  const aspect = findAspect(text);
  if (aspect && 'aspect' in v) set('aspect', aspect, aspect);
  const d = findDuration(text);
  if (d && 'duration' in v && typeof v.duration === 'string') set('duration', `${d} s`, `${d} s long`);

  if (!changes.length) return null;
  const c = call(last.tool, v, ctx);
  if (!c) return null;
  return {
    text: `Updated: ${list(changes)}. The estimate below is the new one.`,
    call: c,
    chips: ['Render it', ...(last.tool === 'cinematic' ? ['Add a crane up', 'Try f/4'] : [])],
  };
}

/* ------------------------------------------------------------------ */

const RENDER = /^(ok(ay)?[,.!\s]*)?(render( it)?|go|go ahead|generate|do it|yes|yep|yeah|sure|ship it|action|roll( it)?|run it|let'?s go|make it so|looks good)[.!\s]*$/i;
const HELLO = /^(hi|hey|hello|yo|hallo|moin|good (morning|evening|afternoon))\b/i;
const HELP = /\b(help|what can you do|what do you do|how does this work|commands)\b/i;

/** What the chat says while a render waits for Approve. */
export const AWAITING_APPROVAL = 'It’s ready to go. Nothing has run yet: press Approve on the card to start it.';

/** "Render it" on a ready call: run it (YOLO), put it up for approval, or respect an earlier Not now. */
export function renderLast(last: ToolCall, yolo: boolean | undefined): Reply {
  // proposed is false only after Not now: the owner already said no to this card, so it is never put up again
  if (last.proposed === false) return { text: 'You said not now to that one, so I’ll leave it. Press Render on the card when you want it, or describe a new shot.' };
  if (yolo) return { text: 'Rolling. It lands in Assets when it’s done, and here in the chat.', render: true };
  return { text: AWAITING_APPROVAL, render: true };
}

export function interpret(input: string, ctx: EngineCtx): Reply {
  const text = input.trim();
  if (!text) return { text: '' };

  if (RENDER.test(text)) {
    if (ctx.last && ctx.last.status === 'ready') return renderLast(ctx.last, ctx.yolo);
    if (ctx.last) return { text: 'That one already went to the render queue. Describe the next shot, or change something on the last one.', chips: EXAMPLES.slice(0, 2) };
    return { text: 'There’s nothing to render yet. Describe a shot and I’ll set it up first.', chips: EXAMPLES.slice(0, 3) };
  }

  const use = text.match(/^use\s+(.+)$/i);
  if (use) {
    const move = MOVES.find((m) => m.name.toLowerCase() === use[1].toLowerCase().trim());
    if (move) {
      const prompt = ctx.last?.tool === 'cinematic' ? (ctx.last.values as Values).prompt : 'A lighthouse on a cliff at dusk';
      const c = call('cinematic', { prompt, moves: [move.id], speed: 'Normal' }, ctx)!;
      return { text: `${move.name} writes “${move.prompt}”. I dropped it into a Cinematic shot.`, call: c, chips: ['Render it', 'Add a tilt up', 'Try 85mm'] };
    }
  }

  if (/^open\s+/i.test(text)) {
    const t = scoreTools(text)[0];
    if (t) return { text: `Opening ${toolById(t[0]).name}.`, open: t[0] };
  }

  const scores = scoreTools(text);
  const top = scores[0];

  if (HELLO.test(text) && (!top || top[1] < 2)) {
    return { text: 'Hey! I’m the Kinemi chat. Tell me the shot you see and I’ll pick the tool, set it up and show what it costs before anything renders.', chips: EXAMPLES.slice(0, 4) };
  }
  if (HELP.test(text) && (!top || top[1] < 2)) {
    return {
      text: 'Describe what you want in plain words. I pick one of the 16 tools, fill in the camera, lens, model and length, and show the runtime and credits first. Say “render it” when it looks right, or change one thing at a time.',
      chips: EXAMPLES.slice(0, 4),
    };
  }

  if (!top || top[1] < 2) {
    const fu = followUp(text, ctx);
    if (fu) return fu;
  }

  if (!top) {
    if (text.split(/\s+/).length < 3) return { text: 'Tell me a bit more: who or what is in the shot, where, and how the camera moves.', chips: EXAMPLES.slice(0, 3) };
    return forTool('cinematic', text, ctx);
  }
  return forTool(top[0], text, ctx);
}

/** A title for a new chat, from its first message. */
export function chatTitle(text: string) {
  return shortTitle(subjectOf(text) || text, 32);
}

