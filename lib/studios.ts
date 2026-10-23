export type Studio = {
  id: string;
  href: string;
  /** The page heading. */
  label: string;
  /** The shorter nav label. */
  nav: string;
  blurb: string;
  /** The parity rows this route carries, in order. */
  parity: string[];
  /** False until the route exists, so the nav never links a 404. */
  live: boolean;
};

/**
 * The seven studios outside the entry. One list, read by the nav and by the home page, so a new
 * route lands in one place instead of three.
 */
export const studios: Studio[] = [
  {
    id: "audio",
    href: "/audio",
    label: "Audio Studio",
    nav: "Audio",
    blurb: "Voiceover, voice cloning, dubbing, multi-speaker scenes and sound effects.",
    parity: ["A1", "A2", "A3", "A4", "A5", "A6"],
    live: true,
  },
  {
    id: "ads",
    href: "/ads",
    label: "Marketing Studio",
    nav: "Ads",
    blurb: "A product photo or URL to an ad, UGC and tutorial templates, hook variations.",
    parity: ["M1", "M2", "M3", "M4"],
    live: true,
  },
  {
    id: "fashion",
    href: "/fashion",
    label: "Fashion Factory",
    nav: "Fashion",
    blurb: "Swap a garment or a model, keep the drape and lighting, build an influencer campaign.",
    parity: ["F1", "F2", "F3"],
    live: true,
  },
  {
    id: "canvas",
    href: "/canvas",
    label: "Canvas",
    nav: "Canvas",
    blurb: "Wire models into a pipeline on a node board, save the graph, share it with the team.",
    parity: ["N1", "N2", "N3"],
    live: true,
  },
  {
    id: "previz",
    href: "/previz",
    label: "3D Previz",
    nav: "3D Previz",
    blurb: "Orbit a 3D previz, export GLB and clips, send camera keyframes to After Effects.",
    parity: ["D1", "D2", "D3"],
    live: true,
  },
  {
    id: "studio",
    href: "/studio",
    label: "Supercomputer",
    nav: "Agents",
    blurb: "Plan a campaign from one brief, run it in batches, drive it from the CLI.",
    parity: ["S1", "S2", "S3", "S4"],
    live: true,
  },
  {
    id: "upscale",
    href: "/upscale",
    label: "Upscale",
    nav: "Upscale",
    blurb: "4K upscale, frame interpolation to 60 fps and deflicker.",
    parity: ["U1", "U2", "U3"],
    live: true,
  },
];
