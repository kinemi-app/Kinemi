import type { Model } from "./types";

/** Credits for one generation. Rounded to one decimal so the UI never shows 3.0000000004. */
export function estimateCredits(model: Model, durationS: number): number {
  return Math.round(model.creditsPerSecond * durationS * 10) / 10;
}

export function formatCredits(credits: number): string {
  return `${credits.toFixed(1)} credits`;
}
