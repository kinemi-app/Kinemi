// The pricing table. Kinemi runs on your own compute: bring a Comfy key, or run ComfyUI on your own GPU.
// Edit the copy here; the section reads everything from this file.

export const PLANS = [
  { id: 'byok', name: 'Bring your own key', tag: 'Your Comfy key' },
  { id: 'local', name: 'Local GPU', tag: 'Your ComfyUI' },
] as const;

export type PlanId = (typeof PLANS)[number]['id'];

export const ROWS: Array<{ label: string; cells: Record<PlanId, [value: string, note: string]> }> = [
  {
    label: 'You pay for',
    cells: {
      byok: ['Your compute', 'Billed on your own Comfy key'],
      local: ['Your hardware', 'Renders run on your own GPU'],
    },
  },
  {
    label: 'Renders',
    cells: {
      byok: ['Full', 'Video and stills on your Comfy endpoint'],
      local: ['Full', 'Video and stills on your own machine'],
    },
  },
  {
    label: 'Open models',
    cells: {
      byok: ['14', 'Wan, LTX, Hunyuan, FLUX, Qwen and more'],
      local: ['14', 'Weights on your own disk'],
    },
  },
  {
    label: 'Setup',
    cells: {
      byok: ['1 key', 'Paste your Comfy key into Kinemi'],
      local: ['1 endpoint', 'Point Kinemi at your local ComfyUI'],
    },
  },
];
