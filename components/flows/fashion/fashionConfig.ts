export type FashionFeature = "swap" | "match" | "campaign";
export type FashionParams = Record<string, string | number | boolean>;

export type FashionRun = {
  feature: FashionFeature;
  prompt: string;
  params: FashionParams;
};

export type FashionRunProps = {
  running: boolean;
  active: boolean;
  onRun: (run: FashionRun) => void;
};

export const SWAP_TARGETS = [
  { value: "garment", label: "Garment" },
  { value: "model", label: "Model" },
  { value: "both", label: "Both" },
];

export const BACKGROUNDS = [
  { value: "studio", label: "Studio" },
  { value: "street", label: "Street" },
  { value: "plain", label: "Plain" },
];

export const POSES = [
  { id: "standing", label: "Standing" },
  { id: "walking", label: "Walking" },
  { id: "seated", label: "Seated" },
];

export const STILL_DURATION_S = 1;
export const LIGHTING_MATCH_MIN = 0;
export const LIGHTING_MATCH_MAX = 10;
export const LIGHTING_MATCH_DEFAULT = 5;
export const MODELS_MIN = 1;
export const MODELS_MAX = 4;
export const MODELS_DEFAULT = 2;
export const BUSY_TITLE = "A run is already in progress";
export const PREPARING_TITLE = "Uploading the photos";

/** A stable seed per model in a campaign: the same line and index always cast the same still. */
export function campaignSeed(line: string, index: number): number {
  let value = 2166136261;
  for (const character of `${line}|${index}`) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}
export const EMPTY_TITLE = "No fashion still yet";
export const EMPTY_BODY =
  "Add a garment and a person, or set a look, then run a panel. Without COMFY_URL the run returns a demo image.";
