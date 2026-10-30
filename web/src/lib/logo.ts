// Kinemi mark, traced from the 1024px app icon (edges fitted to sub-pixel accuracy).
// Coordinates share one viewBox: the K plus the green pixel staircase.

export const LOGO_VIEWBOX = '0 0 697 597';

export const K_PATH =
  'M0 46.26H116.15V293.89L310.25 46.26H440.46L248.66 289.65L441.93 596.07H309.5L165.52 364.33L116.15 399.83V596.07H0Z';

const C = 61.3; // one pixel of the staircase
const X0 = 451;

export const PIXEL_ROWS = [
  { x: X0, y: 0 },
  { x: X0 + C, y: C },
  { x: X0 + 2 * C, y: 2 * C },
].map((r) => ({ ...r, w: 2 * C, h: C }));

// The dashed seam that runs through the six pixels.
export const SEAM_PATH = `M${X0 + C} -2V${C}H${X0 + 2 * C}V${2 * C}H${X0 + 3 * C}V${3 * C}`;

export const BRAND = {
  navy: '#0D1B2A',
  green: '#39D879',
  seam: '#145A37',
  white: '#FFFFFF',
};
