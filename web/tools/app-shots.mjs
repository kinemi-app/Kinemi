// Screenshots of the studio dashboard in its main states, for visual QA.
//   node tools/app-shots.mjs [base] [out-dir] [width]
// Needs `npm run dev` (or preview). Playwright is not a project dependency.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const [base = 'http://127.0.0.1:4321', out = 'tools/.tmp/app', w = '1440'] = process.argv.slice(2);
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
fs.mkdirSync(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)('playwright');
const width = Number(w);
const height = width < 600 ? 844 : width < 1000 ? 1112 : 900;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 600 ? 2 : 1, reducedMotion: process.env.RM ? 'reduce' : 'no-preference' });
const page = await ctx.newPage();
// this container renders WebGL in software, where the studio keeps its 2D fallbacks: force the 3D on
if (!process.env.NO3D) {
  await page.goto(`${base}/app/?3d=on`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => localStorage.getItem('kinemi.3d') === 'on', null, { timeout: 8000 }).catch(() => {});
}
// renders need a connection: save a Comfy key once, through the dialog (NOCONNECT=1 skips it)
if (!process.env.NOCONNECT) {
  await page.goto(`${base}/app/`, { waitUntil: 'networkidle' });
  await page.click('.compute-chip');
  await page.fill('.dialog input[type=password]', 'comfy_shots_key_4242');
  await page.click('.dialog button[type=submit]');
  await page.waitForTimeout(300);
}
const problems = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}-${width}.png` });
  console.log('saved', `${out}/${name}-${width}.png`);
};
const step = async (name, fn) => {
  if (only && !only.includes(name)) return;
  await fn();
};

await step('welcome', async () => {
  await page.goto(`${base}/app/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await shot('welcome');
});

await step('thread', async () => {
  await page.goto(`${base}/app/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  if (width < 860) {
    await page.click('.drawer-btn');
    await page.waitForTimeout(500);
  }
  await page.click('.side-item >> text=Neon alley teaser');
  await page.waitForTimeout(1800);
  await shot('thread');
});

await step('send', async () => {
  await page.goto(`${base}/app/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.fill('.composer textarea', 'Slow crane up over a desert motel at golden hour, 24mm');
  await page.waitForTimeout(600);
  await shot('typed');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await shot('thinking');
  await page.waitForTimeout(3200);
  await shot('reply');
  await page.click('.call .btn-accent');
  await page.waitForTimeout(1600);
  await shot('rendering');
  await page.waitForTimeout(6500);
  await shot('rendered');
});

for (const [name, path] of [
  ['tools', '/app/tools/'],
  ['cinematic', '/app/tools/cinematic/'],
  ['presets', '/app/tools/presets/'],
  ['storyboard', '/app/tools/storyboard/'],
  ['soul', '/app/tools/soul/'],
  ['cast', '/app/tools/ai-cast/'],
  ['academy', '/app/tools/academy/'],
  ['previz', '/app/tools/3d-previz/'],
  ['canvas', '/app/tools/canvas/'],
  ['supercomputer', '/app/tools/supercomputer/'],
  ['reshoot', '/app/tools/re-shoot/'],
  ['assets', '/app/assets/'],
]) {
  await step(name, async () => {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await shot(name);
  });
}

await step('assets-flow', async () => {
  await page.goto(`${base}/app/assets/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // select two cards, then open the folder menu from the bulk bar
  const cards = page.locator('.acard');
  await cards.nth(0).hover();
  await page.locator('.acard-check input').nth(0).click();
  await page.locator('.acard-check input').nth(1).click();
  await page.waitForTimeout(400);
  await shot('assets-selected');
  await page.click('.bulk >> text=Move to');
  await page.waitForTimeout(400);
  await shot('assets-move-menu');
  await page.keyboard.press('Escape');
  await page.click('.bulk [aria-label="Clear the selection"]');
  // open a card in the drawer
  await page.locator('.acard-hit').nth(2).click();
  await page.waitForTimeout(1200);
  await shot('assets-drawer');
  await page.keyboard.press('Escape');
  // filter by a tag from the sidebar, then list layout
  await page.click('.side-item >> text=night');
  await page.waitForTimeout(800);
  await shot('assets-tag');
  await page.click('.seg-opt:has-text("List")');
  await page.waitForTimeout(800);
  await shot('assets-list');
  await page.click('.seg-opt:has-text("Grid")');
});

await step('comfy', async () => {
  if (width < 1000) return;
  await page.goto(`${base}/app/tools/cinematic/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.click('.stage-bar .seg-opt:has-text("Comfy graph")');
  await page.click('.seg-opt:has-text("8 s")');
  await page.waitForTimeout(700);
  await shot('cinematic-graph');
  await page.click('.stage-bar .seg-opt:has-text("API JSON")');
  await page.click('.seg-opt:has-text("10 s")');
  await page.waitForTimeout(700);
  await shot('cinematic-json');
  await page.click('.stage-bar .seg-opt:has-text("Monitor")');
});

await step('rail', async () => {
  if (width < 1000) return;
  await page.goto(`${base}/app/tools/cinematic/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.click('.sidebar-toggle');
  await page.waitForTimeout(800);
  await page.hover('.pad-key[aria-label="Orbit right"]');
  await page.waitForTimeout(900);
  await shot('rail-cinematic');
  await page.keyboard.press('[');
  await page.waitForTimeout(600);
});

await step('plan-run', async () => {
  await page.goto(`${base}/app/tools/supercomputer/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.click('.ws-render');
  await page.waitForTimeout(2200);
  await shot('supercomputer-running');
  await page.waitForFunction(() => !document.querySelector('.pcell.is-queued, .pcell.is-rendering'), null, { timeout: 90000 });
  await page.locator('.pcell.is-done').nth(0).locator('button[aria-label^="Approve"]').click();
  await page.locator('.pcell.is-done').nth(5).locator('button[aria-label^="Approve"]').click();
  await page.locator('.pcell.is-done').nth(2).locator('button[aria-label$="needs a fix"]').click();
  await page.waitForTimeout(600);
  await shot('supercomputer-review');
});

console.log(problems.length ? `\nconsole problems:\n  ${[...new Set(problems)].join('\n  ')}` : '\nno console errors');
await browser.close();
