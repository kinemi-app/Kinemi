// Renders the robot hand from the dev server's /lab/hand page:
//   src/assets/hand/hand.png      transparent poster (Astro turns it into AVIF/WebP at build)
//   src/data/hand-tips.json       fingertip positions for the viewfinder frame
//   design/kinemi-hand.glb        the model itself, for Blender, Figma plugins, etc.
// Needs `npm run dev` running. Usage: node tools/render-hand.mjs [width]
import { createRequire } from 'node:module';
import fs from 'node:fs';

const { chromium } = createRequire(import.meta.url)('playwright');
const width = Number(process.argv[2] || 1440);
const height = Math.round(width * 1.25);
const base = process.env.DEV_URL || 'http://127.0.0.1:4321';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(`${base}/lab/hand?still&transparent`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready);

const { tips, png } = await page.evaluate(([w, h]) => window.__still(w, h), [width, height]);
fs.writeFileSync('src/assets/hand/hand.png', Buffer.from(png.split(',')[1], 'base64'));
const round = (v) => Math.round(v * 10000) / 10000;
fs.writeFileSync(
  'src/data/hand-tips.json',
  JSON.stringify({ index: tips.index.map(round), thumb: tips.thumb.map(round) }, null, 2) + '\n',
);
const glb = await page.evaluate(() => window.__glb());
fs.writeFileSync('design/kinemi-hand.glb', Buffer.from(glb, 'base64'));
await browser.close();
console.log('poster', `${width}x${height}`, 'tips', JSON.stringify(tips), 'glb', fs.statSync('design/kinemi-hand.glb').size, 'bytes');
