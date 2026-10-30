// The film tools' recipes: Cinematic, Storyboard, Re-shoot, Genjutsu and Presets.
// recipes.ts merges them into RECIPES; buildFor there is the only way callers reach them.
import { addCost, modelById, stillCost, videoCost } from '../data/models';
import { moveById } from '../data/moves';
import type { ToolId } from '../data/tools';
import { sceneFor } from '../lib/scenes';
import { hash } from '../lib/util';
import { settings } from '../prefs';
import { fNumber, secs, sentence, shortTitle, sourceOf, spec, type Recipe, type Shot } from './recipe-kit';

export const FILM_RECIPES: Partial<Record<ToolId, Recipe>> = {
  cinematic: {
    defaults: () => ({
      prompt: 'A rain-soaked neon street at night, a woman in a yellow raincoat',
      moves: ['dolly-in'],
      speed: 'Slow',
      body: 'Large format digital',
      lens: '35mm',
      aperture: 'f/1.8',
      look: 'Neon noir',
      model: settings.value.videoModel,
      duration: '5 s',
      aspect: '16:9',
      res: settings.value.res,
    }),
    build(v) {
      const moves = (v.moves as string[]).map(moveById).filter(Boolean) as NonNullable<ReturnType<typeof moveById>>[];
      const speed = v.speed === 'Fast' ? 'fast' : v.speed === 'Slow' ? 'slow' : '';
      const moveText = moves.length
        ? moves.map((m, i) => (i === 0 && speed ? m.prompt.replace(/^(slow|fast|smooth)\s+/i, '').replace(/^/, `${speed} `) : m.prompt)).join(', then ')
        : 'locked-off camera';
      const shallow = fNumber(v.aperture) <= 2.8 ? ', shallow depth of field' : fNumber(v.aperture) >= 8 ? ', deep focus' : '';
      const prompt = [
        sentence(moveText),
        sentence(v.prompt),
        sentence(`Shot on ${v.body.toLowerCase()} with a ${v.lens} lens at ${v.aperture}${shallow}`),
        sentence(`${v.look} look`),
      ].join(' ');
      const duration = secs(v.duration);
      const estimate = videoCost(v.model, duration, v.res, 1 + 0.15 * Math.max(0, moves.length - 1));
      const moveNames = moves.map((m) => m.name).join(' + ') || 'Locked off';
      const title = `${shortTitle(v.prompt, 30)} · ${(moves[0]?.name ?? 'static').toLowerCase()}`;
      return {
        title,
        params: [
          ['Move', speed && moves.length ? `${moveNames} · ${speed}` : moveNames],
          ['Body', v.body],
          ['Lens', v.lens],
          ['Aperture', v.aperture],
          ['Look', v.look],
          ['Model', modelById(v.model).name],
          ['Length', `${duration} s · ${v.aspect} · ${v.res}`],
        ],
        prompt,
        estimate,
        spec: spec('cinematic', {
          name: title,
          model: v.model,
          aspect: v.aspect,
          duration,
          prompt,
          params: [],
          estimate,
          scene: sceneFor(v.prompt),
          seed: hash(prompt),
        }),
      };
    },
  },

  storyboard: {
    defaults: () => ({
      shots: [
        { prompt: 'Wide: the neon street in the rain, empty', model: 'ltx-video', duration: '3 s' },
        { prompt: 'Medium: she steps out of a taxi, umbrella opens', model: 'wan-2.2', duration: '5 s' },
        { prompt: 'Close-up: rain on her face, neon reflections', model: 'wan-2.2', duration: '3 s' },
        { prompt: 'Insert: the noodle bar sign flickers', model: 'ltx-video', duration: '3 s' },
      ] as Shot[],
      aspect: '2.39:1',
      look: 'Neon noir',
    }),
    build(v) {
      const shots = (v.shots as Shot[]).filter((s) => s.prompt.trim()).slice(0, 8);
      if (!shots.length) return null;
      const estimate = addCost(...shots.map((s) => videoCost(s.model, secs(s.duration))));
      const total = shots.reduce((t, s) => t + secs(s.duration), 0);
      const prompt = shots.map((s, i) => `${i + 1}. ${sentence(s.prompt)} ${v.look} look.`).join('\n');
      const title = `${shortTitle(shots[0].prompt.replace(/^\w+:\s*/, ''), 26)} · ${shots.length} shots`;
      return {
        title,
        params: [
          ['Shots', String(shots.length)],
          ['Total', `${total} s`],
          ['Aspect', v.aspect],
          ['Look', v.look],
          ['Models', [...new Set(shots.map((s) => modelById(s.model).name))].join(', ')],
        ],
        prompt,
        estimate,
        spec: spec('storyboard', {
          name: title,
          aspect: v.aspect,
          duration: total,
          prompt,
          params: [],
          estimate,
          scene: sceneFor(shots.map((s) => s.prompt).join(' ')),
          seed: hash(prompt),
          panels: shots.length,
        }),
      };
    },
  },

  reshoot: {
    defaults: () => ({ source: '', orbit: -30, tilt: -10, level: 0, lock: true, model: 'qwen-image-edit' }),
    build(v, ctx) {
      const src = sourceOf(ctx, v.source, ['still', 'video']);
      if (!src) return null;
      const orbit = Number(v.orbit);
      const tilt = Number(v.tilt);
      const level = Number(v.level);
      const dir = orbit < 0 ? 'left' : 'right';
      const prompt = [
        sentence(`Same scene and light as the source, camera orbits ${Math.abs(orbit)}° to the ${dir}`),
        tilt ? sentence(`Tilt ${tilt < 0 ? 'down' : 'up'} ${Math.abs(tilt)}°`) : '',
        sentence(level ? `Roll the horizon ${level}°` : 'Keep the horizon level'),
        v.lock ? 'Keep the subject exactly as it is: pose, face, wardrobe.' : 'The subject may turn with the camera.',
      ]
        .filter(Boolean)
        .join(' ');
      const estimate = stillCost(v.model, 1, 1.2);
      const title = `${src.name.split(' · ')[0]} · orbit ${Math.abs(orbit)}° ${dir}`;
      return {
        title,
        params: [
          ['Source', src.name],
          ['Orbit', `${Math.abs(orbit)}° ${dir}`],
          ['Tilt', tilt ? `${Math.abs(tilt)}° ${tilt < 0 ? 'down' : 'up'}` : 'Level'],
          ['Roll', level ? `${level}°` : 'None'],
          ['Subject', v.lock ? 'Left alone' : 'Free'],
          ['Model', modelById(v.model).name],
        ],
        prompt,
        estimate,
        spec: spec('reshoot', {
          name: title,
          model: v.model,
          aspect: src.aspect,
          prompt,
          params: [],
          estimate,
          scene: src.scene,
          seed: hash(src.id + prompt),
          palette: src.palette,
        }),
      };
    },
  },

  genjutsu: {
    defaults: (ctx) => ({ source: '', target: ctx.cast[0]?.id ?? '', from: 'Joy', to: 'Surprise', intensity: 70, model: 'wan-2.2-i2v' }),
    build(v, ctx) {
      const src = sourceOf(ctx, v.source, ['video']);
      const who = ctx.cast.find((c) => c.id === v.target);
      const target = who ? `@${who.tag}` : 'the face in the reference';
      const prompt = [
        sentence(`Transfer the performance from ${src ? `“${src.name}”` : 'the source clip'} onto ${target}`),
        sentence(`Emotion moves from ${v.from.toLowerCase()} to ${v.to.toLowerCase()} at ${v.intensity}% intensity`),
        'Keep the identity locked, match the timing of every beat.',
      ].join(' ');
      const estimate = videoCost(v.model, src?.duration ?? 5, '720p', 1.35);
      const title = `${who?.name ?? 'Face'} · ${v.from.toLowerCase()} → ${v.to.toLowerCase()}`;
      return {
        title,
        params: [
          ['Source', src?.name ?? 'Upload a clip'],
          ['Onto', who ? `${who.name} (@${who.tag})` : 'Face reference'],
          ['Emotion', `${v.from} → ${v.to}`],
          ['Intensity', `${v.intensity}%`],
          ['Model', modelById(v.model).name],
        ],
        prompt,
        estimate,
        spec: spec('genjutsu', {
          name: title,
          model: v.model,
          aspect: '9:16',
          duration: src?.duration ?? 5,
          prompt,
          params: [],
          estimate,
          scene: 'portrait',
          seed: hash(title + prompt),
        }),
      };
    },
  },

  presets: {
    defaults: () => ({ move: 'dolly-in', prompt: 'A lighthouse on a cliff at dusk' }),
    build(v, ctx) {
      return FILM_RECIPES.cinematic!.build({ ...FILM_RECIPES.cinematic!.defaults(ctx), prompt: v.prompt, moves: [v.move], speed: 'Normal' }, ctx);
    },
  },
};
