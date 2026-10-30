// Fills the four landing picture slots in src/assets/screens/ from the running studio.
//   npm start            # root: Next serves the studio and its /api
//   node tools/screens.mjs [base] [--ui|--renders]
// base defaults to http://127.0.0.1:3000.
//
// The three app slots are real screenshots of the studio. The render slot is the picture the
// server returns for a render: demo output while COMFY_URL is unset, real ComfyUI frames once it is
// set, because both go through the same POST /api/generate. Re-run after a UI change or before ship.
// It drives the browser through the tests' own DevTools helper, so it adds no npm package.
import fs from 'node:fs';
import path from 'node:path';
import { openBrowser } from '../../tests/lib/browser.mjs';

const base = (process.argv[2] || process.env.DEV_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const only = process.argv.includes('--ui') ? 'ui' : process.argv.includes('--renders') ? 'renders' : 'all';
const out = path.join(import.meta.dirname, '..', 'src', 'assets', 'screens');
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await openBrowser({ webgl: true });
const shots = [];

/** Wait until an expression in the page is truthy. */
async function until(sessionId, expression, what, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await browser.evaluate(sessionId, expression)) return;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

/** Save the page at its current size, and say which slot it filled and at what pixel size. */
async function save(sessionId, name) {
  const at = path.join(out, `${name}.png`);
  await browser.capture(sessionId, at);
  const size = await browser.evaluate(sessionId, '({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })');
  const pixels = `${Math.round(size.w * size.dpr)}×${Math.round(size.h * size.dpr)}`;
  shots.push(`${name}.png ${pixels}`);
  console.log('saved', `${name}.png`, pixels);
}

// --- the app itself -------------------------------------------------------------------------
// Sized so the picture lands on the slot's recommended pixels: a normal desktop layout at 2×.
const appShots = [
  { name: 'studio-desktop', path: '/app/?3d=on', width: 1280, height: 800, dpr: 2, ready: '.composer-row textarea' },
  { name: 'phone-cinematic', path: '/app/tools/cinematic/?3d=on', width: 393, height: 852, dpr: 3, ready: '.ws' },
  { name: 'phone-anywhere', path: '/app/', width: 393, height: 852, dpr: 3, ready: '.composer-row textarea' },
];

// The sidebar's "Render on your own GPU" card shows while nothing is connected, which is always
// true for a capture run; the landing pictures show the studio as a director sees it once set up.
const DEVICE_SETTINGS = { gpuCard: false };

if (only !== 'renders') {
  // the studio keeps WebGL on once asked; the landing page writes nothing, so the flags survive
  const seed = await browser.openPage(base);
  await browser.evaluate(seed.sessionId, "localStorage.setItem('kinemi.3d', 'on')");
  await browser.evaluate(seed.sessionId, `localStorage.setItem('kinemi.device.v1', ${JSON.stringify(JSON.stringify(DEVICE_SETTINGS))})`);
  for (const s of appShots) {
    const page = await browser.openPage(`${base}${s.path}`, { width: s.width, height: s.height, dpr: s.dpr });
    await browser.media(page.sessionId, [{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await until(page.sessionId, `!!document.querySelector(${JSON.stringify(s.ready)})`, `${s.name}'s page`);
    await browser.evaluate(page.sessionId, 'document.fonts.ready.then(() => true)');
    await sleep(1500); // the 3D model and the entrance animations settle
    await save(page.sessionId, s.name);
  }
}

// --- what the server renders -----------------------------------------------------------------
// every render slot is a 16:9 still, so the poster is captured whole, never sliced
const renders = [
  { name: 'render-anywhere', width: 1280, height: 720, prompt: 'Portrait of an astronaut in a greenhouse, soft window light, medium format' },
];

/** Ask the server for one still and wait until it has the picture. */
async function render(prompt) {
  const made = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'soul', modelId: 'flux-2-dev', prompt, durationS: 1 }),
  });
  const { jobId, error } = await made.json();
  if (!made.ok) throw new Error(error ?? `the server answered ${made.status}`);
  for (let i = 0; i < 240; i++) {
    await sleep(500);
    const job = await fetch(`${base}/api/jobs/${encodeURIComponent(jobId)}`).then((r) => r.json());
    if (job.status === 'failed') throw new Error(`render ${jobId} failed: ${job.error}`);
    if (job.status === 'succeeded' && job.result?.url) return job.result.url;
  }
  throw new Error(`render ${jobId} did not finish in two minutes`);
}

if (only !== 'ui') {
  for (const r of renders) {
    const url = await render(r.prompt);
    // half the recommended pixels at 2× keeps edges sharp without a 2560px-wide layout
    const page = await browser.openPage('about:blank', { width: r.width / 2, height: r.height / 2, dpr: 2 });
    await browser.evaluate(
      page.sessionId,
      `(async () => {
        document.head.innerHTML = '<style>html,body{margin:0;background:#0a1622;overflow:hidden}img{display:block;width:100vw;height:100vh;object-fit:cover}</style>';
        const img = document.createElement('img');
        img.src = ${JSON.stringify(url)};
        document.body.append(img);
        await img.decode();
        return img.naturalWidth;
      })()`,
    );
    await save(page.sessionId, r.name);
  }
}

await browser.close();
console.log(`\n${shots.length} picture slots filled in src/assets/screens/`);
