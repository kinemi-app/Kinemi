// Which placeholder scene a prompt gets, and five-colour palettes for Soul.
import { hash, rng } from './util';

export const SCENES = ['neon', 'desert', 'ocean', 'forest', 'mountain', 'portrait', 'product', 'fashion', 'space', 'interior'] as const;
export type Scene = (typeof SCENES)[number] | 'previz' | 'audio' | 'palette' | 'board';

const WORDS: Array<[Scene, RegExp]> = [
  ['neon', /\b(neon|street|city|rain|alley|night|noodle|cyber|tokyo|downtown|subway|taxi)/i],
  ['desert', /\b(desert|motel|sunset|highway|cactus|dune|western|canyon|route)/i],
  ['ocean', /\b(ocean|sea|beach|lighthouse|cliff|wave|harbou?r|boat|coast|surf)/i],
  ['forest', /\b(forest|woods|pine|fog|jungle|tree|cabin)/i],
  ['mountain', /\b(mountain|lake|aurora|snow|alps|peak|glacier|ridge|valley)/i],
  ['portrait', /\b(face|portrait|woman|man|girl|boy|character|actor|close-?up|dance|dancer|singer|mara|ilo)/i],
  ['product', /\b(product|sneaker|bottle|perfume|watch|phone|shoe|can|packaging|cosmetic)/i],
  ['fashion', /\b(garment|dress|coat|trench|fashion|runway|outfit|lookbook|jacket|model)/i],
  ['space', /\b(space|planet|stars?|galaxy|moon|astronaut|station|orbit(al)? station|nebula)/i],
  ['interior', /\b(room|kitchen|interior|office|bedroom|diner|bar|studio|hallway|library)/i],
];

export function sceneFor(text: string): Scene {
  for (const [scene, re] of WORDS) if (re.test(text)) return scene;
  const outdoor: Scene[] = ['neon', 'desert', 'ocean', 'forest', 'mountain'];
  return outdoor[hash(text) % outdoor.length];
}

/** Base palettes per scene, darkest last. Soul nudges them by the sentence. */
const BASE: Record<string, string[]> = {
  neon: ['#39d879', '#2ee6c4', '#ff4fa3', '#1b2b6b', '#070b1a'],
  desert: ['#ffb35c', '#ff7a45', '#d94a6a', '#4b2a6b', '#160d2b'],
  ocean: ['#e9f3f1', '#7fd3e6', '#2c8fb3', '#0d4a6b', '#04162a'],
  forest: ['#d8e8c8', '#8fbf7a', '#3f7f5a', '#1d4a3a', '#0a1f19'],
  mountain: ['#e8f1ff', '#9fd8c6', '#39d879', '#2b4f7a', '#0b1a33'],
  portrait: ['#f4d2b8', '#d9907a', '#7a4e6b', '#2e2b4a', '#0e0f1c'],
  product: ['#f2f7f4', '#cdd8e0', '#39d879', '#28374a', '#0d1b2a'],
  fashion: ['#f6e7d8', '#e2b49a', '#a35d4a', '#3b2c35', '#121015'],
  space: ['#d6e4ff', '#8b7bff', '#ff7ab6', '#24205a', '#05040f'],
  interior: ['#ffe2b0', '#e8a35c', '#8a5a3c', '#3b2a24', '#120c0a'],
};

const hex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

function shift(color: string, r: () => number, amount = 18) {
  const v = parseInt(color.slice(1), 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => c + (r() - 0.5) * amount * 2);
  return `#${ch.map(hex).join('')}`;
}

export function paletteFor(text: string): string[] {
  const scene = sceneFor(text);
  const base = BASE[scene] ?? BASE.neon;
  const r = rng(hash(text));
  return base.map((c) => shift(c, r).toUpperCase());
}

export function basePalette(scene: string) {
  return BASE[scene] ?? BASE.neon;
}
