// The request the Kinemi server runs for a render. serverHints turns a tool's settings into the
// server's params (recipes.ts buildFor attaches them as spec.server, so chat, tool page and
// Supercomputer renders carry the same data); requestFor turns a spec into POST /api/generate's body.
// Only type imports besides backend-map.ts and the registry file, so tests/backend-request.backend.mjs loads it in Node.
import registryModels from '../../../../data/models.json' with { type: 'json' };
import { clampDuration, resolveModel, sourceField, TOOL_MODE, type Registry, type RegistryModel } from './backend-map.ts';
import type { GenerateBody } from '../backend';
import type { Asset, RenderSpec } from '../store';
import type { AssetKind, ToolId } from './tools';

export type ServerParam = string | number | boolean;

export interface ServerHints {
  /** the asset whose file the server reads: uploaded first, its name sent as imageName, videoName or audioName */
  sourceId?: string;
  /** the registry model a feature is pinned to; it wins over the tool's model pick */
  modelId?: string;
  params: Record<string, ServerParam>;
}

/** The tool's source asset among the kinds it takes (recipes.ts sourceOf, bound to the settings). */
export type FindSource = (kinds: AssetKind[]) => Asset | undefined;

type Values = Record<string, unknown>;

/** The voice option (data/options.ts VOICES) that asks for a clone of the user's own sample. */
const CLONED_VOICE = 'Your cloned voice';

const LANGUAGE: Record<string, string> = {
  English: 'en',
  German: 'de',
  Spanish: 'es',
  French: 'fr',
  Japanese: 'ja',
  Portuguese: 'pt',
  Hindi: 'hi',
  Turkish: 'tr',
};

/** Audio mode → the server's feature and the model its graph is pinned to. */
const AUDIO: Record<string, [string, string]> = {
  Voiceover: ['voiceover', 'chatterbox'],
  'Voice clone': ['clone', 'chatterbox'],
  Dubbing: ['dub', 'chatterbox'],
  'Multi-speaker': ['scene', 'chatterbox'],
  'Sound effects': ['sfx', 'audiogen-medium'],
};

/** The registry's rate card: creditsPerSecond is the price the server bills, so estimates read it here. */
const RATES = registryModels as Array<RegistryModel & { creditsPerSecond: number }>;

/**
 * Whole credits for an audio mode: the pinned model's creditsPerSecond x the length that renders
 * (clamped to the model's cap), at least one, as models.ts rounds its estimates.
 */
export function audioCredits(mode: string, seconds: number): number {
  const [, modelId] = AUDIO[mode] ?? AUDIO.Voiceover;
  const model = RATES.find((m) => m.id === modelId);
  if (!model) throw new Error(`The registry has no ${modelId} row to price ${mode}.`);
  return Math.max(1, Math.ceil(model.creditsPerSecond * clampDuration(model, seconds)));
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function audioHints(v: Values, find: FindSource): ServerHints {
  const speaker = String(v.voice ?? '').split(' · ')[0];
  const mode = String(v.mode ?? 'Voiceover');
  // A voiceover in "Your cloned voice" is a clone run: the server asks for the sample it needs.
  // Other voice names pick nothing: the voiceover graph is Chatterbox and takes no voice or speed.
  const [feature, modelId] = mode === 'Voiceover' && v.voice === CLONED_VOICE ? AUDIO['Voice clone'] : (AUDIO[mode] ?? AUDIO.Voiceover);
  const params: Record<string, ServerParam> = { feature };
  if (feature === 'scene') params.speaker = speaker || 'Narrator';
  if (feature === 'dub') params.language = LANGUAGE[String(v.language)] ?? 'en';
  return { modelId, params, sourceId: feature === 'dub' ? find(['video'])?.id : undefined };
}

function upscaleHints(v: Values, find: FindSource): ServerHints {
  const src = find(['video', 'still']);
  return {
    sourceId: src?.id,
    params: {
      factor: v.target === '4K' ? 4 : 2,
      // "Off" keeps the source rate; 48 fps travels as asked and the server names what it supports.
      fps: v.fps === 'Off' ? 30 : parseInt(String(v.fps), 10) || 30,
      deflicker: v.deflicker ? 5 : 0,
      sourceDurationS: Math.max(1, Math.round(src?.duration ?? 1)),
    },
  };
}

/** The server's params for a tool's settings, and which asset it must upload first. */
export function serverHints(tool: ToolId, v: Values, find: FindSource): ServerHints {
  switch (tool) {
    case 'reshoot':
      return { sourceId: find(['still', 'video'])?.id, params: {} };
    case 'genjutsu':
      return { sourceId: find(['video'])?.id, params: {} };
    case 'edit':
      return { sourceId: find(['video'])?.id, params: { strength: clamp(Math.round(Number(v.strength ?? 50) / 10), 1, 10) } };
    case 'upscale':
      return upscaleHints(v, find);
    case 'audio':
      return audioHints(v, find);
    case 'marketing':
      // On a still model requestFor turns this into "hooks".
      return { params: { feature: v.template === 'Tutorial' ? 'tutorial' : 'ugc' } };
    case 'fashion':
      // The design has no garment or person photo, so both swaps run as a look match.
      return { params: v.mode === 'Campaign' ? { feature: 'campaign' } : { feature: 'match', keepDrape: Boolean(v.drape), keepLighting: Boolean(v.light) } };
    default:
      return { params: {} };
  }
}

/**
 * POST /api/generate's body for a spec, or null for a tool the server does not render (Academy,
 * 3D Previz). `source` is the uploaded source file's name on the server and what kind it was.
 * Throws when the server's registry has no model for the mode.
 */
export function requestFor(spec: RenderSpec, registry: Registry, source?: { name: string; kind: AssetKind }): GenerateBody | null {
  const mode = TOOL_MODE[spec.tool];
  if (!mode) return null;
  const hints = spec.server ?? { params: {} };
  const model = resolveModel(registry, mode, hints.modelId ?? spec.model);
  if (!model) throw new Error(`The server has no model for ${mode}.`);
  const params = { ...hints.params };
  if (mode === 'ads') params.feature = model.kind === 'video' ? (params.feature ?? 'ugc') : 'hooks';
  const field = source && sourceField(source.kind);
  if (source && field) params[field] = source.name;
  return { mode, modelId: model.id, prompt: spec.prompt, durationS: clampDuration(model, spec.duration), seed: spec.seed, params };
}
