// Stands in for supabase-js in builds without accounts (see astro.config.mjs), so the library isn't shipped.
export function createClient(): never {
  throw new Error('Accounts are off on this Kinemi.');
}
