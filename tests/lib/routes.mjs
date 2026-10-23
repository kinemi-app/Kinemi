/**
 * The route list for the browser suite, kept in one place: the home page cards in order and the
 * page each route should head.
 */

/** The href of every card on the home page, in render order. */
export const HOME_CARDS = [
  "/cinematic",
  "/storyboard",
  "/reshoot",
  "/genjutsu",
  "/presets",
  "/soul",
  "/cast",
  "/edit",
  "/academy",
  "/audio",
  "/ads",
  "/fashion",
  "/canvas",
  "/previz",
  "/studio",
  "/upscale",
];

/** Every route the browser suite opens, with the screenshot name and the heading it must show. */
export const ROUTES = [
  { path: "/", shot: "home", heading: /screening room for ComfyUI film work/i },
  { path: "/cinematic", shot: "cinematic", heading: /^Cinematic$/ },
  { path: "/storyboard", shot: "storyboard", heading: /^Storyboard$/ },
  { path: "/reshoot", shot: "reshoot", heading: /^Re-shoot$/ },
  { path: "/genjutsu", shot: "genjutsu", heading: /^Genjutsu$/ },
  { path: "/presets", shot: "presets", heading: /^Presets$/ },
  { path: "/soul", shot: "soul", heading: /^Soul$/ },
  { path: "/cast", shot: "cast", heading: /^AI Cast$/ },
  { path: "/edit", shot: "edit", heading: /^Edit$/ },
  { path: "/academy", shot: "academy", heading: /^Academy$/ },
  { path: "/audio", shot: "audio", heading: /^Audio Studio$/ },
  { path: "/ads", shot: "ads", heading: /^Marketing Studio$/ },
  { path: "/fashion", shot: "fashion", heading: /^Fashion Factory$/ },
  { path: "/canvas", shot: "canvas", heading: /^Canvas$/ },
  { path: "/previz", shot: "previz", heading: /^3D Previz$/ },
  { path: "/studio", shot: "studio", heading: /^Supercomputer$/ },
  { path: "/upscale", shot: "upscale", heading: /^Upscale$/ },
];
