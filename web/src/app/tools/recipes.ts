// Recipes: turn a tool's settings into a render, with the prompt it writes and the cost up front.
// The tool pages and the chat both go through these, so a shot built either way is the same shot.
// The film tools' recipes live in recipes-film.ts, the shared types and helpers in recipe-kit.ts.
import { APERTURES, EMOTIONS } from '../data/options';
import { addCost, modelById, stillCost, videoCost, type Estimate } from '../data/models';
import { moveById } from '../data/moves';
import type { ToolId } from '../data/tools';
import { paletteFor, sceneFor } from '../lib/scenes';
import { hash } from '../lib/util';
import { atATime, settings } from '../prefs';
import { DELIVERABLES, makePlan, planSummary } from './plan';
import { audioCredits, serverHints } from '../data/backend-request';
import { fNumber, secs, sentence, shortTitle, sourceOf, spec, type Built, type Ctx, type Recipe, type Values } from './recipe-kit';
import { FILM_RECIPES } from './recipes-film';

export { latest, secs, shortTitle, sourceOf, type Built, type Ctx, type Shot, type Values } from './recipe-kit';

export const RECIPES: Partial<Record<ToolId, Recipe>> = {
  ...FILM_RECIPES,

  soul: {
    defaults: () => ({ sentence: 'Sunset over a desert motel', preset: 'Sun bleached', model: settings.value.imageModel, aspect: '16:9', palette: [] as string[] }),
    build(v) {
      const text = String(v.sentence || '').trim();
      if (!text) return null;
      const palette: string[] = v.palette?.length === 5 ? v.palette : paletteFor(text);
      const prompt = [
        sentence(text),
        sentence(`Colour palette locked to ${palette.join(', ')}`),
        sentence(`Soul 2.0 ${v.preset} preset`),
      ].join(' ');
      const estimate = stillCost(v.model, 1, 1.1);
      const title = `${shortTitle(text, 28)} · palette`;
      return {
        title,
        params: [
          ['Palette', palette.join(' ')],
          ['Preset', `Soul 2.0 · ${v.preset}`],
          ['Aspect', v.aspect],
          ['Model', modelById(v.model).name],
        ],
        prompt,
        estimate,
        spec: spec('soul', {
          name: title,
          model: v.model,
          aspect: v.aspect,
          prompt,
          params: [],
          estimate,
          scene: sceneFor(text),
          seed: hash(prompt),
          palette,
        }),
      };
    },
  },

  cast: {
    defaults: () => ({ name: 'Noor', look: 'Early thirties, short black bob, round glasses, olive field jacket', lock: true, model: settings.value.imageModel }),
    build(v) {
      const name = String(v.name || 'New character').trim();
      const tag = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const prompt = [
        sentence(v.look || name),
        sentence(`Character sheet of ${name}, neutral grey backdrop, soft key light`),
        sentence(`Eight emotions: ${EMOTIONS.join(', ').toLowerCase()}`),
        v.lock ? 'Identity locked across every emotion.' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const estimate = stillCost(v.model, 9);
      return {
        title: name,
        params: [
          ['Tag', `@${tag}`],
          ['Identity', v.lock ? 'Locked' : 'Free'],
          ['Emotions', '8'],
          ['Model', modelById(v.model).name],
        ],
        prompt,
        estimate,
        spec: spec('cast', {
          name,
          model: v.model,
          aspect: '4:5',
          prompt,
          params: [],
          estimate,
          scene: 'portrait',
          seed: hash(name + v.look),
        }),
      };
    },
  },

  edit: {
    defaults: () => ({ source: '', change: 'Take out the umbrella and let steam rise from the street', strength: 55, model: 'wan-2.2' }),
    build(v, ctx) {
      const src = sourceOf(ctx, v.source, ['video']);
      if (!src) return null;
      const change = String(v.change || '').trim() || 'Clean up the frame';
      const prompt = [sentence(change), sentence(`Keep everything else from “${src.name}”`), sentence(`Edit strength ${v.strength}%`)].join(' ');
      const estimate = videoCost(v.model, src.duration ?? 5, '720p', 0.9);
      const title = `${src.name.split(' · ')[0]} · ${shortTitle(change, 22).toLowerCase()}`;
      return {
        title,
        params: [
          ['Source', src.name],
          ['Change', shortTitle(change, 44)],
          ['Strength', `${v.strength}%`],
          ['Model', modelById(v.model).name],
        ],
        prompt,
        estimate,
        spec: spec('edit', {
          name: title,
          model: v.model,
          aspect: src.aspect,
          duration: src.duration ?? 5,
          prompt,
          params: [],
          estimate,
          scene: src.scene,
          seed: hash(src.id + change),
        }),
      };
    },
  },

  audio: {
    defaults: () => ({
      mode: 'Voiceover',
      script: 'In a city that never sleeps, one sign still flickers.',
      voice: 'Default voice',
      language: 'English',
      length: 20,
    }),
    build(v) {
      const script = String(v.script || '').trim();
      if (!script) return null;
      const length = Number(v.length) || 20;
      const runtime = Math.round(length * (v.mode === 'Voice clone' ? 1.4 : 0.6) + 4);
      const estimate = { runtime, credits: audioCredits(String(v.mode), length) };
      // The audio graphs speak (or, for sound effects, describe) the prompt as given, so it is the script alone.
      const prompt = script;
      const title = `${v.mode} · ${shortTitle(script, 24).toLowerCase()}`;
      return {
        title,
        params: [
          ['Mode', v.mode],
          ['Voice', v.voice],
          ['Language', v.language],
          ['Length', `${length} s`],
        ],
        prompt,
        estimate,
        spec: spec('audio', { name: title, aspect: '16:9', duration: length, prompt, params: [], estimate, scene: 'audio', seed: hash(prompt) }),
      };
    },
  },

  marketing: {
    defaults: () => ({ product: 'Trail sneaker in bone white', template: 'Ad', hooks: 3, aspect: '9:16', duration: '8 s', model: settings.value.videoModel }),
    build(v) {
      const product = String(v.product || '').trim();
      if (!product) return null;
      const hooks = Math.max(1, Math.min(6, Number(v.hooks) || 1));
      const one = videoCost(v.model, secs(v.duration));
      const estimate = { runtime: one.runtime * hooks, credits: one.credits * hooks };
      const prompt = [
        sentence(`${v.template} for ${product}`),
        sentence(`${hooks} hook variation${hooks > 1 ? 's' : ''}, each opening on a different first second`),
        'Product stays on-model: shape, colour and logo unchanged.',
      ].join(' ');
      const title = `${shortTitle(product, 24)} · ${v.template.toLowerCase()}`;
      return {
        title,
        params: [
          ['Product', product],
          ['Template', v.template],
          ['Hooks', String(hooks)],
          ['Length', `${secs(v.duration)} s · ${v.aspect}`],
          ['Model', modelById(v.model).name],
        ],
        prompt,
        estimate,
        spec: spec('marketing', {
          name: title,
          model: v.model,
          aspect: v.aspect,
          duration: secs(v.duration),
          prompt,
          params: [],
          estimate,
          scene: 'product',
          seed: hash(prompt),
          count: hooks,
        }),
      };
    },
  },

  fashion: {
    defaults: (ctx) => ({
      mode: 'Swap garment',
      garment: 'Moss green trench coat',
      who: ctx.cast[0]?.id ?? '',
      drape: true,
      light: true,
      looks: 3,
      model: 'flux-kontext',
    }),
    build(v, ctx) {
      const garment = String(v.garment || '').trim();
      if (!garment) return null;
      const who = ctx.cast.find((c) => c.id === v.who);
      const looks = Math.max(1, Math.min(8, Number(v.looks) || 1));
      const prompt = [
        sentence(`${v.mode === 'Swap model' ? 'Swap the model for' : v.mode === 'Campaign' ? 'Influencer campaign with' : 'Dress'} ${who ? `@${who.tag}` : 'the model'} in a ${garment.toLowerCase()}`),
        v.drape ? 'Keep the drape and the folds of the fabric.' : '',
        v.light ? 'Keep the original lighting.' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const estimate = stillCost(v.model, looks, 1.1);
      const title = `${shortTitle(garment, 26)} · ${v.mode.toLowerCase()}`;
      return {
        title,
        params: [
          ['Mode', v.mode],
          ['Garment', garment],
          ['Model', who ? `${who.name} (@${who.tag})` : 'From the photo'],
          ['Keeps', [v.drape && 'drape', v.light && 'lighting'].filter(Boolean).join(' + ') || 'Nothing'],
          ['Looks', String(looks)],
          ['Weights', modelById(v.model).name],
        ],
        prompt,
        estimate,
        spec: spec('fashion', {
          name: title,
          model: v.model,
          aspect: '4:5',
          prompt,
          params: [],
          estimate,
          scene: 'fashion',
          seed: hash(prompt),
          count: looks,
        }),
      };
    },
  },

  canvas: {
    defaults: () => ({
      prompt: 'A lighthouse on a cliff at dusk, waves breaking',
      nodes: ['prompt', 'still', 'reshoot', 'animate', 'upscale'],
    }),
    build(v) {
      const nodes = v.nodes as string[];
      const prompt = String(v.prompt || '').trim();
      if (!prompt || !nodes.length) return null;
      const parts: Estimate[] = [];
      if (nodes.includes('still')) parts.push(stillCost('flux-dev'));
      if (nodes.includes('reshoot')) parts.push(stillCost('qwen-image-edit'));
      if (nodes.includes('animate')) parts.push(videoCost('wan-2.2-i2v', 5));
      if (nodes.includes('upscale')) parts.push(videoCost('ltx-video', 5, '4K', 0.4));
      const estimate = addCost(...parts);
      const title = `${shortTitle(prompt, 26)} · pipeline`;
      const full = `${sentence(prompt)} Pipeline: ${nodes.map((n) => CANVAS_NODES[n]?.label ?? n).join(' → ')}.`;
      return {
        title,
        params: [
          ['Nodes', String(nodes.length)],
          ['Pipeline', nodes.map((n) => CANVAS_NODES[n]?.short ?? n).join(' → ')],
          ['Output', nodes.includes('animate') ? 'Video' : 'Still'],
        ],
        prompt: full,
        estimate,
        spec: spec('canvas', {
          name: title,
          kind: nodes.includes('animate') ? 'video' : 'still',
          aspect: '16:9',
          duration: nodes.includes('animate') ? 5 : undefined,
          prompt: full,
          params: [],
          estimate,
          scene: sceneFor(prompt),
          seed: hash(full),
        }),
      };
    },
  },

  previz: {
    defaults: () => ({ set: 'Neon street', move: 'orbit-right', lens: '35mm', duration: '5 s', export: 'GLB + clip' }),
    build(v) {
      const move = moveById(v.move);
      const duration = secs(v.duration);
      const estimate = { runtime: 4 + duration, credits: 1 };
      const prompt = `${v.set} block-out, ${move?.prompt ?? 'static camera'}, ${v.lens} lens, ${duration} s. Export ${v.export}.`;
      const title = `${v.set} · ${move?.name.toLowerCase() ?? 'static'} previz`;
      return {
        title,
        params: [
          ['Set', v.set],
          ['Move', move?.name ?? 'Static'],
          ['Lens', v.lens],
          ['Length', `${duration} s`],
          ['Export', v.export],
        ],
        prompt,
        estimate,
        spec: spec('previz', { name: title, aspect: '16:9', duration, prompt, params: [], estimate, scene: 'previz', seed: hash(prompt) }),
      };
    },
  },

  supercomputer: {
    defaults: () => ({
      campaign: 'SS27 trench launch',
      subject: 'A model in a moss green trench coat walks through {v} at dusk',
      rows: ['hero', 'vertical', 'square', 'lookbook'],
      axis: 'Places',
      places: 'Tokyo, Paris, Lagos, New York',
      looks: ['Neon noir', 'Golden hour', 'Blue hour'],
      takes: 3,
      off: [] as string[],
      budget: 120,
      batch: '',
    }),
    build(v, ctx) {
      const plan = makePlan(v, ctx);
      if (!plan.run.length) return null;
      const prompt = `${plan.title}: ${planSummary(plan)}. ${sentence(String(v.subject).replaceAll('{v}', plan.variants[0] ?? 'the city'))}`;
      const title = `Campaign · ${plan.title}`;
      return {
        title,
        params: [
          ['Deliverables', plan.rows.map((r) => DELIVERABLES[r].label).join(', ')],
          [String(v.axis), plan.variants.join(', ')],
          ['Renders', `${plan.run.length} of ${plan.cells.length}, ${atATime()}`],
          ['Budget', `${plan.estimate.credits} of ${plan.budget} credits`],
        ],
        prompt,
        estimate: plan.estimate,
        spec: spec('supercomputer', {
          name: title,
          aspect: '16:9',
          prompt,
          params: [],
          estimate: plan.estimate,
          scene: sceneFor(String(v.subject)),
          seed: hash(prompt),
          count: plan.run.length,
          panels: plan.variants.length,
        }),
      };
    },
  },

  upscale: {
    defaults: () => ({ source: '', target: '4K', fps: '60 fps', deflicker: true }),
    build(v, ctx) {
      const src = sourceOf(ctx, v.source, ['video', 'still']);
      if (!src) return null;
      const isVideo = src.kind === 'video';
      const extra = (v.fps === 'Off' ? 1 : 1.5) * (v.deflicker ? 1.1 : 1) * 0.4;
      const estimate = isVideo ? videoCost('ltx-video', src.duration ?? 5, v.target, extra) : stillCost('flux-dev', 1, v.target === '4K' ? 0.5 : 0.3);
      const prompt = `Upscale “${src.name}” to ${v.target}${isVideo && v.fps !== 'Off' ? `, interpolate to ${v.fps}` : ''}${isVideo && v.deflicker ? ', deflicker' : ''}.`;
      const title = `${src.name.split(' · ')[0]} · ${v.target}`;
      return {
        title,
        params: [
          ['Source', src.name],
          ['Target', v.target],
          ['Frames', isVideo ? v.fps : 'Still'],
          ['Deflicker', isVideo && v.deflicker ? 'On' : 'Off'],
        ],
        prompt,
        estimate,
        spec: spec('upscale', {
          name: title,
          kind: src.kind,
          aspect: src.aspect,
          duration: src.duration,
          prompt,
          params: [],
          estimate,
          scene: src.scene,
          seed: src.seed,
          palette: src.palette,
        }),
      };
    },
  },
};

export const CANVAS_NODES: Record<string, { label: string; short: string; model?: string }> = {
  prompt: { label: 'Prompt', short: 'Prompt' },
  still: { label: `${modelById('flux-dev').name} still`, short: 'Still', model: 'flux-dev' },
  reshoot: { label: 'Re-shoot angle', short: 'Re-shoot', model: 'qwen-image-edit' },
  animate: { label: 'Wan 2.2 I2V', short: 'Animate', model: 'wan-2.2-i2v' },
  upscale: { label: 'Upscale 4K', short: 'Upscale' },
};

export function buildFor(tool: ToolId, values: Values, ctx: Ctx): Built | null {
  const v = { ...defaultsFor(tool, ctx), ...values };
  const built = RECIPES[tool]?.build(v, ctx) ?? null;
  return built && { ...built, spec: { ...built.spec, params: built.params, server: serverHints(tool, v, (kinds) => sourceOf(ctx, v.source, kinds)) } };
}

export const defaultsFor = (tool: ToolId, ctx: Ctx): Values => RECIPES[tool]?.defaults(ctx) ?? {};

export const nearestAperture = (n: number) =>
  APERTURES.reduce((best, a) => (Math.abs(fNumber(a) - n) < Math.abs(fNumber(best) - n) ? a : best), APERTURES[0]);

