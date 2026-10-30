import type { JobLive } from "./generate/comfy-progress";

export type Mode =
  | "cinematic"
  | "reshoot"
  | "genjutsu"
  | "soul"
  | "edit"
  | "audio"
  | "ads"
  | "fashion"
  | "upscale"
  | "depth";

/** What a run on a model produces. The graph declares the result kind at run time. */
export type ModelKind = "image" | "video" | "audio";

export type Model = {
  id: string;
  name: string;
  vendor: string;
  open: boolean;
  creditsPerSecond: number;
  maxDurationS: number;
  modes: Mode[];
  kind: ModelKind;
  note?: string;
};

export type CameraMove = {
  id: string;
  name: string;
  family: string;
  prompt: string;
};

export type LookOption = {
  id: string;
  name: string;
  hint?: string;
};

export type LookBook = {
  bodies: LookOption[];
  lenses: LookOption[];
  apertures: string[];
  palettes: LookOption[];
  lighting: LookOption[];
};

/**
 * The params bag holds primitives only. The asset names are the strings POST /api/assets
 * returns, which is what ComfyUI sees in its input folder.
 */
export type GenerateParams = Record<string, string | number | boolean> & {
  imageName?: string;
  endImageName?: string;
  videoName?: string;
  audioName?: string;
};

export type GenerateRequest = {
  mode: Mode;
  modelId: string;
  prompt: string;
  durationS: number;
  seed?: number;
  params?: GenerateParams;
};

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobResult = {
  url: string;
  /** Audio results carry no frame size, so their width and height are 0. */
  kind: ModelKind;
  width: number;
  height: number;
  /** Demo audio: whether the sound came from KINEMI_TTS_CMD or the synthesised tone. */
  demoVoice?: "tone" | "command";
};

export type Job = {
  id: string;
  status: JobStatus;
  progress: number;
  createdAt: number;
  request: GenerateRequest;
  demo: boolean;
  /** Real render progress, GPU time and Cloud credits; only a Comfy run carries it. */
  live?: JobLive;
  result?: JobResult;
  error?: string;
};

export type JobResponse = {
  jobId: string;
};

export type ApiError = {
  error: string;
};
