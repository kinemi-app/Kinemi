// Links and copy that are shared across sections.
// The studio dashboard ships with this site at /app/. To send these links to an app hosted
// elsewhere, set PUBLIC_APP_URL when building, e.g. PUBLIC_APP_URL=https://app.kinemi.example/
const base = (import.meta.env.PUBLIC_APP_URL as string | undefined) || `${import.meta.env.BASE_URL}app/`;
const APP = base.endsWith('/') ? base : `${base}/`;

/** Deep link to one tool in the studio, by its slug (cinematic, re-shoot, ai-cast…). */
export const toolUrl = (slug: string) => `${APP}tools/${slug}/`;

export const SITE = {
  name: 'Kinemi',
  title: 'Kinemi: real camera language for AI film',
  description:
    'A film studio on open models: 16 tools to build shots with real camera language, queue a shot list, re-shoot a still, move a performance onto another face and edit the clip, plus a chat that runs them for you. Open models, clear prices, no lock-in.',
  appUrl: APP,
  comfyUrl: `${APP}?connect`,
  academyUrl: toolUrl('academy'),
};

export const NAV = [
  { label: 'Home', href: '#top' },
  { label: 'Studios', href: '#studios' },
  { label: 'Models', href: '#models' },
  { label: 'Pricing', href: '#pricing' },
];
