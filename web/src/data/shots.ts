// Every app picture on the page is a named slot. Until a file exists, the slot renders as a
// labeled, empty viewfinder. To fill one, save an image as src/assets/screens/<name>.png
// (or .jpg / .webp / .avif) and rebuild: it is resized and converted to AVIF and WebP automatically.

export interface ShotSpec {
  /** what belongs in the slot */
  label: string;
  /** recommended source size in pixels */
  size: string;
  /** CSS aspect ratio of the slot */
  ratio: string;
  /** alt text once a real image is in place */
  alt: string;
}

/** A render slot shows a 16:9 still, the shape the studio renders in. */
const RENDER: ShotSpec = {
  label: 'Sample render',
  size: '1280 × 720',
  ratio: '16 / 9',
  alt: 'A still rendered with Kinemi',
};

export const SHOTS = {
  'studio-desktop': {
    label: 'Studios on desktop',
    size: '2560 × 1600',
    ratio: '16 / 10',
    alt: 'Kinemi Studios in a desktop browser',
  },
  'phone-cinematic': {
    label: 'Cinematic on a phone',
    size: '1179 × 2556',
    ratio: '1179 / 2556',
    alt: 'The Cinematic tool on a phone',
  },
  'phone-anywhere': {
    label: 'Kinemi chat on a phone',
    size: '1179 × 2556',
    ratio: '1179 / 2556',
    alt: 'The Kinemi chat on a phone',
  },
  'render-anywhere': RENDER,
} satisfies Record<string, ShotSpec>;

export type ShotName = keyof typeof SHOTS;
