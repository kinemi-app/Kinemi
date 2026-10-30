/**
 * What a Comfy Cloud run costs, from the published rate (comfy.org/cloud/pricing, read 2026-10-30):
 * an RTX PRO 6000 is 736.39 credits per GPU hour, which is $3.49 per hour, billed per GPU second.
 */

export const CLOUD_CREDITS_PER_GPU_HOUR = 736.39;
export const CLOUD_USD_PER_GPU_HOUR = 3.49;

const MS_PER_HOUR = 3_600_000;

/** Credits for `gpuMs` milliseconds of GPU time. */
export function cloudCredits(gpuMs: number): number {
  return (gpuMs * CLOUD_CREDITS_PER_GPU_HOUR) / MS_PER_HOUR;
}

/** Credits that a dollar amount buys at the published rate. */
export function creditsFromUsd(usd: number): number {
  return (usd * CLOUD_CREDITS_PER_GPU_HOUR) / CLOUD_USD_PER_GPU_HOUR;
}
