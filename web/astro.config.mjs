// @ts-check
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, fontProviders } from 'astro/config';
import preact from '@astrojs/preact';
import { loadEnv } from 'vite';

// shown in Settings → Legal & about
let commit = '';
try {
  commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  /* not a git checkout */
}
const BUILD = { date: new Date().toISOString().slice(0, 10), commit };

// the PUBLIC_ settings from the shell and the .env files, as the site itself sees them
const env = loadEnv(process.env.NODE_ENV ?? 'production', fileURLToPath(new URL('.', import.meta.url)), 'PUBLIC_');
// accounts need both Supabase values; asking for sign-in without them would lock everyone out
const cloud = !!(env.PUBLIC_SUPABASE_URL && (env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.PUBLIC_SUPABASE_ANON_KEY));
if (String(env.PUBLIC_GUEST_MODE).toLowerCase() === 'off' && !cloud) {
  console.warn('[kinemi] PUBLIC_GUEST_MODE=off needs PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY. Without them guests stay on.');
}

export default defineConfig({
  // Production URL, e.g. SITE_URL=https://kinemi.example npm run build.
  // When set, canonical and Open Graph links become absolute.
  site: process.env.SITE_URL || undefined,
  build: {
    // One HTML request paints the whole page: no render-blocking CSS file.
    inlineStylesheets: 'always',
  },
  devToolbar: { enabled: false },
  vite: {
    // three.js is one lazy chunk, loaded after first paint on desktop only
    build: { chunkSizeWarningLimit: 600 },
    // without accounts, everything behind them (supabase-js too) is left out of the build
    define: { __KINEMI_BUILD__: JSON.stringify(BUILD), __KINEMI_ACCOUNTS__: JSON.stringify(cloud) },
    resolve: { alias: cloud ? {} : { '@supabase/supabase-js': fileURLToPath(new URL('./src/app/cloud/off.ts', import.meta.url)) } },
    // `npm run dev:web` from the repo root: the studio's API calls go to the Next server
    // (`npm run dev`, port 3000 unless KINEMI_API says otherwise)
    server: {
      proxy: {
        '/api': {
          target: process.env.KINEMI_API || 'http://127.0.0.1:3000',
          changeOrigin: true,
          // Next not running: answer with a JSON error instead of a bare 502 in the console
          configure: (proxy) =>
            proxy.on('error', (_err, _req, res) => {
              if (!('writeHead' in res) || res.headersSent) return;
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'offline' }));
            }),
        },
      },
    },
  },
  integrations: [
    // the dashboard at /app/ is one Preact island
    preact(),
    {
      // /lab/hand and /lab/posters: workbenches, only while developing
      name: 'kinemi-lab',
      hooks: {
        'astro:config:setup': ({ command, injectRoute }) => {
          if (command === 'dev') {
            injectRoute({ pattern: '/lab/hand', entrypoint: './src/lab/hand.astro' });
            injectRoute({ pattern: '/lab/posters', entrypoint: './src/lab/posters.astro' });
          }
        },
      },
    },
  ],
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Space Grotesk',
      cssVariable: '--font-sans',
      fallbacks: ['system-ui', 'sans-serif'],
      options: {
        variants: [
          {
            src: ['./src/assets/fonts/SpaceGrotesk-latin-wght.woff2'],
            weight: '300 700',
            style: 'normal',
          },
        ],
      },
    },
  ],
});
