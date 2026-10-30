// Close-ups of every 3D slot in the studio, to check the models.
//   node tools/app-3d.mjs [base] [out-dir]
import { createRequire } from 'node:module';
import fs from 'node:fs';

const [base = 'http://127.0.0.1:4321', out = 'tools/.tmp/3d'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
// this container renders WebGL in software, where the studio keeps its 2D fallbacks: force the 3D on
await page.goto(`${base}/app/?3d=on`, { waitUntil: 'networkidle' });
const problems = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const live = async (sel) => {
  await page.waitForSelector(`${sel}.is-live`, { timeout: 15000 }).catch(() => problems.push(`not live: ${sel}`));
  await page.waitForTimeout(900);
};
const snap = async (sel, name, pad = 0) => {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) return problems.push(`missing ${sel}`);
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 } });
  console.log('saved', name);
};

await page.goto(`${base}/app/`, { waitUntil: 'networkidle' });
await live('.orb-3d');
await snap('.welcome-orb', 'orb', 20);
await live('.gpu-3d');
await snap('.gpu-card', 'gpu');

await page.goto(`${base}/app/tools/`, { waitUntil: 'networkidle' });
await live('.tv-camera');
await snap('.tv-stage', 'camera');
await live('.tv-voxel');
await page.hover('.tv-card >> nth=5');
await page.waitForTimeout(1200);
await snap('.tv-grid', 'voxels');

await page.goto(`${base}/app/assets/`, { waitUntil: 'networkidle' });
await live('.assets-reel');
await snap('.assets-title', 'reel', 10);
await page.click('.side-item >> text=Trash');
await page.waitForTimeout(400);
// empty the trash view by filtering to something absent
await page.fill('.assets-search input', 'zzzz');
await live('.empty-reel');
await snap('.assets-empty', 'reel-empty');

await page.goto(`${base}/app/tools/3d-previz/`, { waitUntil: 'networkidle' });
await live('.monitor-3d');
await snap('.monitor-screen', 'previz');

await page.goto(`${base}/app/tools/cinematic/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.click('.ws-render');
// the first render asks where to run: save a key and it carries on
if (await page.locator('.dialog input[type=password]').count()) {
  await page.fill('.dialog input[type=password]', 'comfy_shots_key_4242');
  await page.click('.dialog button[type=submit]');
}
await page.waitForTimeout(500);
await page.click('.queue-btn');
await live('.queue-clapper');
await snap('.queue-panel', 'queue');
await live('.monitor-clapper');
await snap('.monitor-screen', 'monitor-rendering');

console.log(problems.length ? `\nproblems:\n  ${[...new Set(problems)].join('\n  ')}` : '\nno problems');
await browser.close();
