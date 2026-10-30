// The controls each tool shows. Keys match the recipe values, so the chat and the form stay in sync.
import { DURATIONS, LANGUAGES, LENSES, RESOLUTIONS, VOICES } from '../data/options';
import type { ModelKind } from '../data/models';
import type { AssetKind, ToolId } from '../data/tools';

export type FieldDef =
  | { type: 'text'; key: string; label: string; placeholder?: string; hint?: string }
  | { type: 'textarea'; key: string; label: string; placeholder?: string; rows?: number; hint?: string }
  | { type: 'select'; key: string; label: string; options: string[]; hint?: string }
  | { type: 'seg'; key: string; label: string; options: string[]; hint?: string }
  | { type: 'chips'; key: string; label: string; options: string[]; hint?: string }
  | { type: 'slider'; key: string; label: string; min: number; max: number; step?: number; unit?: string; marks?: [string, string]; hint?: string }
  | { type: 'toggle'; key: string; label: string; sub?: string }
  | { type: 'model'; key: string; label: string; kinds: ModelKind[] }
  | { type: 'movepad'; key: string; label: string; single?: boolean; hint?: string }
  | { type: 'optics'; label: string; lenses: string[]; aperture?: boolean }
  | { type: 'body'; key: string; label: string }
  | { type: 'look'; key: string; label: string }
  | { type: 'aspect'; key: string; label: string }
  | { type: 'source'; key: string; label: string; kinds: AssetKind[] }
  | { type: 'cast'; key: string; label: string; none: string }
  | { type: 'emotions'; key: string; label: string }
  | { type: 'row'; fields: FieldDef[] }
  | { type: 'group'; label: string };

export const SCHEMAS: Partial<Record<ToolId, FieldDef[]>> = {
  cinematic: [
    { type: 'textarea', key: 'prompt', label: 'The shot', placeholder: 'Who, where, what light…', rows: 3 },
    { type: 'movepad', key: 'moves', label: 'Camera moves', hint: 'stack up to 3' },
    { type: 'seg', key: 'speed', label: 'Move speed', options: ['Slow', 'Normal', 'Fast'] },
    { type: 'group', label: 'Camera' },
    { type: 'optics', label: 'Lens and aperture', lenses: LENSES, aperture: true },
    { type: 'body', key: 'body', label: 'Body' },
    { type: 'look', key: 'look', label: 'Look' },
    { type: 'group', label: 'Render' },
    { type: 'model', key: 'model', label: 'Open model', kinds: ['video'] },
    { type: 'aspect', key: 'aspect', label: 'Frame' },
    { type: 'seg', key: 'duration', label: 'Length', options: DURATIONS },
    { type: 'seg', key: 'res', label: 'Resolution', options: RESOLUTIONS },
  ],
  reshoot: [
    { type: 'source', key: 'source', label: 'Finished image', kinds: ['still', 'video'] },
    { type: 'slider', key: 'orbit', label: 'Orbit', min: -180, max: 180, step: 5, unit: '°', marks: ['← 180°', '180° →'] },
    { type: 'slider', key: 'tilt', label: 'Tilt', min: -45, max: 45, step: 5, unit: '°', marks: ['down', 'up'] },
    { type: 'slider', key: 'level', label: 'Level', min: -15, max: 15, step: 1, unit: '°', marks: ['roll left', 'roll right'] },
    { type: 'toggle', key: 'lock', label: 'Leave the subject alone', sub: 'Pose, face and wardrobe stay as they are' },
    { type: 'model', key: 'model', label: 'Open model', kinds: ['edit'] },
  ],
  genjutsu: [
    { type: 'source', key: 'source', label: 'Performance clip', kinds: ['video'] },
    { type: 'cast', key: 'target', label: 'Onto', none: 'A face from a photo' },
    { type: 'emotions', key: 'emotion', label: 'Emotion wheel' },
    { type: 'slider', key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 5, unit: '%', marks: ['subtle', 'full'] },
    { type: 'model', key: 'model', label: 'Open model', kinds: ['video'] },
  ],
  edit: [
    { type: 'source', key: 'source', label: 'Finished clip', kinds: ['video'] },
    { type: 'textarea', key: 'change', label: 'What should change', rows: 3, placeholder: 'Take out the umbrella…' },
    { type: 'slider', key: 'strength', label: 'How hard the edit lands', min: 0, max: 100, step: 5, unit: '%', marks: ['subtle', 'heavy'] },
    { type: 'model', key: 'model', label: 'Open model', kinds: ['video'] },
  ],
  audio: [
    { type: 'chips', key: 'mode', label: 'Mode', options: ['Voiceover', 'Voice clone', 'Dubbing', 'Multi-speaker', 'Sound effects'] },
    { type: 'textarea', key: 'script', label: 'Script or sound', rows: 4 },
    {
      type: 'row',
      fields: [
        { type: 'select', key: 'voice', label: 'Voice', options: VOICES },
        { type: 'select', key: 'language', label: 'Language', options: LANGUAGES },
      ],
    },
    { type: 'slider', key: 'length', label: 'Length', min: 5, max: 120, step: 5, unit: ' s' },
  ],
  marketing: [
    { type: 'text', key: 'product', label: 'Product photo or URL', placeholder: 'https://… or describe the product' },
    { type: 'seg', key: 'template', label: 'Template', options: ['Ad', 'UGC', 'Tutorial'] },
    { type: 'slider', key: 'hooks', label: 'Hook variations', min: 1, max: 6, step: 1 },
    { type: 'aspect', key: 'aspect', label: 'Frame' },
    { type: 'seg', key: 'duration', label: 'Length', options: DURATIONS },
    { type: 'model', key: 'model', label: 'Open model', kinds: ['video'] },
  ],
  fashion: [
    { type: 'seg', key: 'mode', label: 'Mode', options: ['Swap garment', 'Swap model', 'Campaign'] },
    { type: 'text', key: 'garment', label: 'Garment', placeholder: 'Moss green trench coat' },
    { type: 'cast', key: 'who', label: 'Model', none: 'The model in the photo' },
    { type: 'toggle', key: 'drape', label: 'Keep the drape', sub: 'Folds and fit of the fabric' },
    { type: 'toggle', key: 'light', label: 'Keep the lighting', sub: 'Same key, same shadows' },
    { type: 'slider', key: 'looks', label: 'Looks', min: 1, max: 8, step: 1 },
    { type: 'model', key: 'model', label: 'Open model', kinds: ['edit', 'image'] },
  ],
  upscale: [
    { type: 'source', key: 'source', label: 'Clip or still', kinds: ['video', 'still'] },
    { type: 'seg', key: 'target', label: 'Target', options: ['2K', '4K'] },
    { type: 'seg', key: 'fps', label: 'Frame interpolation', options: ['Off', '48 fps', '60 fps'] },
    { type: 'toggle', key: 'deflicker', label: 'Deflicker', sub: 'Steadies the light from frame to frame' },
  ],
  previz: [
    { type: 'seg', key: 'set', label: 'Set', options: ['Neon street', 'Desert motel', 'Interior', 'Rooftop'] },
    { type: 'movepad', key: 'move', label: 'Camera move', single: true },
    { type: 'optics', label: 'Lens', lenses: LENSES.slice(0, 6) },
    { type: 'seg', key: 'duration', label: 'Length', options: DURATIONS },
    { type: 'seg', key: 'export', label: 'Export', options: ['GLB + clip', 'AE keyframes', 'Clip only'] },
  ],
};
