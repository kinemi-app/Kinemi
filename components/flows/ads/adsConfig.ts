export type AdPanel = "product" | "video" | "hooks" | "posters";
export type AdFeature = "product" | "ugc" | "unboxing" | "tutorial" | "hooks" | "posters";
export type AdParams = Record<string, string | number | boolean>;

export type AdRun = {
  panel: AdPanel;
  feature: AdFeature;
  modelId: string;
  prompt: string;
  durationS: number;
  params: AdParams;
};

export type AdRunProps = {
  running: boolean;
  active: boolean;
  onRun: (run: AdRun) => void;
};

export const PRODUCT_FORMATS = [
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "9:16", label: "9:16" },
];

export const VIDEO_KINDS = [
  { value: "ugc", label: "UGC" },
  { value: "unboxing", label: "Unboxing" },
  { value: "tutorial", label: "Tutorial" },
];

export const POSTER_SIZES = [
  { value: "square", label: "Square" },
  { value: "portrait", label: "Portrait" },
  { value: "story", label: "Story" },
];

export const STILL_DURATION_S = 1;
export const VIDEO_DURATION_S = 4;
export const BUSY_TITLE = "A run is already in progress";
export const PREPARING_TITLE = "Uploading the product photo";
export const EMPTY_TITLE = "No ad yet";
export const EMPTY_BODY =
  "Pick a panel and make one. Without COMFY_URL the run returns a demo image, not a rendered ad.";
