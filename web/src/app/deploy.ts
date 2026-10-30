// How this copy of Kinemi runs, decided when it is built (see .env.example).
// No Supabase keys: a studio on this computer, no accounts, everything stays in the browser.
// With them: accounts switch on, and PUBLIC_GUEST_MODE=off makes signing in required.

const env = import.meta.env;

const SUPABASE_URL: string = env.PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY: string = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.PUBLIC_SUPABASE_ANON_KEY || '';

/** Accounts are on: this build talks to a Supabase project. A build constant, so a build without accounts drops their code. */
export const CLOUD: boolean = __KINEMI_ACCOUNTS__ && !!(SUPABASE_URL && SUPABASE_KEY);

export const SUPABASE = { url: SUPABASE_URL.replace(/\/+$/, ''), key: SUPABASE_KEY };

/** People may use the studio without an account. Without accounts there is nothing else. */
export const GUESTS = !CLOUD || String(env.PUBLIC_GUEST_MODE || 'on').toLowerCase() !== 'off';

export const KNOWN_PROVIDERS = ['google', 'github', 'apple', 'discord', 'gitlab'] as const;
export type Provider = (typeof KNOWN_PROVIDERS)[number];

/** Sign-in providers switched on in the Supabase dashboard, e.g. PUBLIC_AUTH_PROVIDERS=google,github */
export const PROVIDERS = String(env.PUBLIC_AUTH_PROVIDERS || '')
  .split(',')
  .map((p) => p.trim().toLowerCase())
  .filter((p): p is Provider => (KNOWN_PROVIDERS as readonly string[]).includes(p));

/** Comfy Cloud's API. Change it only to go through a proxy of your own. */
export const COMFY_CLOUD = String(env.PUBLIC_COMFY_CLOUD_URL || 'https://cloud.comfy.org').replace(/\/+$/, '');

/** The site's base path, with a trailing slash. */
export const BASE = `${String(env.BASE_URL ?? '/').replace(/\/+$/, '')}/`;

/** Where supabase-js keeps the session; the studio's first-paint script looks for it. */
export const AUTH_STORAGE_KEY = 'kinemi-auth';
