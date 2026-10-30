// What the Academy's figures show and the sums behind them, apart from their markup in Academy.tsx.
// The cost figure offers only lengths the server renders: each pick's longest clip is its registry
// model's maxDurationS in data/models.json, the same cap a real render is clamped to.
import registryModels from '../../../../data/models.json' with { type: 'json' };
import { clampDuration, resolveModel, type Mode, type Registry, type RegistryModel } from '../data/backend-map.ts';
import { MODELS, videoCost, type Estimate, type OpenModel } from '../data/models.ts';

export const SIZES: Array<[string, number]> = [
  ['Extreme wide', 0.62],
  ['Wide', 1],
  ['Medium', 1.7],
  ['Close-up', 2.8],
  ['Extreme close-up', 4.6],
];
export const ANGLES = ['High', 'Eye level', 'Low'] as const;
export type Angle = (typeof ANGLES)[number];

export const EXAMPLES = [
  { subject: 'A woman in her sixties in a yellow raincoat', place: 'on a rain-soaked neon street at night', light: 'pink and teal signs reflecting in the puddles', camera: 'slow dolly in, 35mm, f/1.8' },
  { subject: 'A young cook plating noodles', place: 'in a cramped night-market stall', light: 'a single warm bulb, steam in the air', camera: 'handheld, close-up, 50mm' },
  { subject: 'A lighthouse keeper with a lantern', place: 'on a rocky island in a storm', light: 'blue hour, the beam sweeping through rain', camera: 'crane up and back, 24mm, wide' },
];

/** The models table's speed column, from GPU seconds per second of 720p video. */
export const speedTier = (speed: number) => (speed <= 4 ? 'fast' : speed <= 10 ? 'medium' : 'slow');

/** The cost lesson prices a shot from the Cinematic tool. */
const COST_MODE: Mode = 'cinematic';
const COST_LENGTHS = [3, 5, 8, 10];
const CEILING_RES = '1080p';
const REGISTRY: Registry = { models: registryModels as RegistryModel[], defaults: {} };

export const VIDEO_MODELS = MODELS.filter((m) => m.kind === 'video');

function registryModelFor(pick: string): RegistryModel {
  const model = resolveModel(REGISTRY, COST_MODE, pick);
  if (!model) throw new Error(`Academy cost figure: "${pick}" renders on no registry model`);
  return model;
}

export interface CostView {
  /** the lengths this pick can render, in seconds */
  lengths: number[];
  /** the asked length, clamped to the pick's longest clip */
  seconds: number;
  estimate: Estimate;
}

/** A clip on a pick, with a length kept from a longer model clamped to this one's longest. */
export function costView(pick: string, seconds: number, res: string): CostView {
  const model = registryModelFor(pick);
  const lengths = [...new Set(COST_LENGTHS.map((s) => clampDuration(model, s)))];
  const clamped = clampDuration(model, seconds);
  return { lengths, seconds: clamped, estimate: videoCost(pick, clamped, res) };
}

export interface CostCeiling {
  model: OpenModel;
  seconds: number;
  estimate: Estimate;
}

/** The bar's full mark: the dearest video model's longest offered clip at 1080p. */
export function costCeiling(): CostCeiling {
  const model = VIDEO_MODELS.reduce((top, m) => (m.creditsPerSecond > top.creditsPerSecond ? m : top));
  const { seconds, estimate } = costView(model.id, Math.max(...COST_LENGTHS), CEILING_RES);
  return { model, seconds, estimate };
}
