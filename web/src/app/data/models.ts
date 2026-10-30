// Open models the tools can run on, and the cost-first estimator.
// The server registry (data/models.json) is the truth: each pick here renders on the registry model
// backend-map.ts resolves it to, and carries that model's name, vendor and licence. Every registry
// video and still generator has a pick; audio, upscale and depth models belong to their own tools.
// Ids are the keys saved settings and assets use, so they stay put when a pick's model changes.
// creditsPerSecond is the registry model's rate (tests/models-catalog.backend.mjs holds them equal);
// speed only feeds the runtime estimate, so swap it for the numbers your Comfy deployment reports.

export type ModelKind = 'video' | 'image' | 'edit';

export interface OpenModel {
  id: string;
  name: string;
  vendor: string;
  kind: ModelKind;
  /** GPU seconds per second of 720p video, or per image */
  speed: number;
  /** credits per second of 720p video, or per image: the registry model's creditsPerSecond */
  creditsPerSecond: number;
  note: string;
  license: License;
}

/** What a model's weights may be used for. Licenses change: the model card is what counts. */
export interface License {
  name: string;
  url: string;
  /** a limit worth knowing before you use it */
  note?: string;
}

// Each vendor's model card and licence file, checked 28 Oct 2026. Klein's licence file is gated, so only its name is confirmed.
const LTX_REVENUE_NOTE = 'Free for companies under $10M a year in revenue; above that, Lightricks sells a license.';
const FLUX_DEV_NOTE = 'Non-commercial: running it commercially needs a license from Black Forest Labs. The stills it makes may be used commercially.';

const L = {
  wanT2v: { name: 'Apache-2.0', url: 'https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B' },
  wanI2v: { name: 'Apache-2.0', url: 'https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B' },
  ltx2: { name: 'LTX-2 Community License', url: 'https://huggingface.co/Lightricks/LTX-2', note: LTX_REVENUE_NOTE },
  ltx25: { name: 'LTX-2.x Community License', url: 'https://huggingface.co/Lightricks/LTX-2.5', note: LTX_REVENUE_NOTE },
  hunyuan: { name: 'Tencent Hunyuan Community License', url: 'https://huggingface.co/tencent/HunyuanVideo-1.5', note: 'Not licensed for use in the EU, the UK or South Korea, and the clips it makes may not be used there either.' },
  flux2: { name: 'FLUX [dev] Non-Commercial License v2.0', url: 'https://huggingface.co/black-forest-labs/FLUX.2-dev', note: FLUX_DEV_NOTE },
  klein: { name: 'FLUX Kommunity License', url: 'https://huggingface.co/black-forest-labs/flux-3-image-klein', note: 'Limits commercial use: read its terms on the model card before you use its stills for work.' },
  qwen: { name: 'Apache-2.0', url: 'https://huggingface.co/Qwen/Qwen-Image' },
  qwenEdit: { name: 'Apache-2.0', url: 'https://huggingface.co/Qwen/Qwen-Image-Edit-2509' },
} satisfies Record<string, License>;

export const MODELS: OpenModel[] = [
  { id: 'wan-2.2', name: 'Wan 2.2 T2V', vendor: 'Alibaba', kind: 'video', speed: 9, creditsPerSecond: 0.6, note: 'Text to video, the cheapest per second', license: L.wanT2v },
  { id: 'wan-2.2-i2v', name: 'Wan 2.2 I2V', vendor: 'Alibaba', kind: 'video', speed: 8, creditsPerSecond: 0.8, note: 'Animates a still you already like, strong camera adherence', license: L.wanI2v },
  { id: 'ltx-2', name: 'LTX-2', vendor: 'Lightricks', kind: 'video', speed: 2.2, creditsPerSecond: 1.2, note: 'Long clips, up to 10 s', license: L.ltx2 },
  { id: 'ltx-video', name: 'LTX-2.5', vendor: 'Lightricks', kind: 'video', speed: 2.5, creditsPerSecond: 1.4, note: 'Fast drafts and long clips, up to 10 s, the dearest per second', license: L.ltx25 },
  { id: 'hunyuan-video', name: 'HunyuanVideo 1.5', vendor: 'Tencent', kind: 'video', speed: 12, creditsPerSecond: 1, note: 'Best at faces and small motion, slower', license: L.hunyuan },
  { id: 'hunyuan-i2v', name: 'HunyuanVideo 1.5 I2V', vendor: 'Tencent', kind: 'video', speed: 11, creditsPerSecond: 1, note: 'Image to video, keeps identity', license: L.hunyuan },
  { id: 'flux-dev', name: 'FLUX.2 dev', vendor: 'Black Forest Labs', kind: 'image', speed: 14, creditsPerSecond: 0.3, note: 'Photographic stills', license: L.flux2 },
  { id: 'flux-kontext', name: 'FLUX.2 dev edit', vendor: 'Black Forest Labs', kind: 'edit', speed: 16, creditsPerSecond: 0.3, note: 'Edits a still from your references, keeps the rest', license: L.flux2 },
  { id: 'flux-3-klein', name: 'FLUX 3 Image Klein', vendor: 'Black Forest Labs', kind: 'image', speed: 16, creditsPerSecond: 0.35, note: 'A small 5.6B still model, for Soul images', license: L.klein },
  { id: 'qwen-image', name: 'Qwen-Image', vendor: 'Alibaba', kind: 'image', speed: 18, creditsPerSecond: 0.25, note: 'Stills with clean text, the cheapest', license: L.qwen },
  { id: 'qwen-image-edit', name: 'Qwen-Image-Edit', vendor: 'Alibaba', kind: 'edit', speed: 15, creditsPerSecond: 0.25, note: 'Angle and detail edits', license: L.qwenEdit },
];

export const modelById = (id: string) => MODELS.find((m) => m.id === id) ?? MODELS[0];

export interface Estimate {
  /** GPU seconds */
  runtime: number;
  credits: number;
}

const RES: Record<string, number> = { '720p': 1, '1080p': 2.1, '2K': 3.2, '4K': 6.5 };

/** One video clip: duration in seconds on a model at a resolution. */
export function videoCost(modelId: string, duration: number, res = '720p', extra = 1): Estimate {
  const m = modelById(modelId);
  const scale = (RES[res] ?? 1) * extra;
  const runtime = Math.round(m.speed * duration * scale + 6);
  return { runtime, credits: credits(m.creditsPerSecond * duration * scale) };
}

/** Still images: count of images on a model; the registry bills each image as one second. */
export function stillCost(modelId: string, count = 1, extra = 1): Estimate {
  const m = modelById(modelId);
  const runtime = Math.round(m.speed * count * extra + 3);
  return { runtime, credits: credits(m.creditsPerSecond * count * extra) };
}

/** Whole credits, at least one per render. */
const credits = (exact: number) => Math.max(1, Math.ceil(exact));

export const addCost = (...e: Estimate[]): Estimate => ({
  runtime: e.reduce((s, x) => s + x.runtime, 0),
  credits: e.reduce((s, x) => s + x.credits, 0),
});

export function formatRuntime(s: number) {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}
