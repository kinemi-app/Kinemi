// The Supabase client, created the first time something needs it. Only builds with accounts ever load it.
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY, CLOUD, SUPABASE } from '../deploy';

let client: Promise<SupabaseClient> | null = null;

export function supabase(): Promise<SupabaseClient> {
  if (!CLOUD) return Promise.reject(new Error('Accounts are off on this Kinemi.'));
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE.url, SUPABASE.key, {
      auth: {
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        // email links (confirm, reset) land with the session in the URL: pick it up from there.
        // The implicit flow works even when the link is opened in another browser.
        detectSessionInUrl: true,
        flowType: 'implicit',
      },
    }),
  );
  return client;
}

/** The table and bucket supabase/schema.sql creates. */
export const TABLE = 'studio_items';
export const BUCKET = 'studio-files';
