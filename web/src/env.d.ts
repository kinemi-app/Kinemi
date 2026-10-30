/// <reference types="astro/client" />

/** Set at build time in astro.config.mjs. */
declare const __KINEMI_BUILD__: { date: string; commit: string };
/** Set at build time in astro.config.mjs: the Supabase settings are there. */
declare const __KINEMI_ACCOUNTS__: boolean;

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
  readonly PUBLIC_GUEST_MODE?: string;
  readonly PUBLIC_AUTH_PROVIDERS?: string;
  readonly PUBLIC_COMFY_CLOUD_URL?: string;
  readonly PUBLIC_APP_URL?: string;
}
