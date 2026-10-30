// Screenshot helper for visual QA.
//   node tools/shot.mjs [url] [out-prefix] [widths...]
// Example: node tools/shot.mjs http://127.0.0.1:4321/ .tmp/home 1440 390
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const [url = 'http://127.0.0.1:4321/', prefix = 'tools/.tmp/shot', ...w] = process.argv.slice(2);
const widths = w.length ? w.map(Number) : [1440];
const full = process.env.FULL === '1';
const wait = Number(process.env.WAIT || 1500);
const scrollTo = process.env.SCROLL ? Number(process.env.SCROLL) : null;
fs.mkdirSync(path.dirname(prefix), { recursive: true });
// Playwright is installed globally in this environment; createRequire honours NODE_PATH.
const { chromium } = createRequire(import.meta.url)('playwright');

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
for (const width of widths) {
  const height = width < 600 ? 844 : width < 1000 ? 1112 : 900;
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: width < 600 ? 2 : 1 });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[${width}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => console.log(`[${width}] pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  if (full) {
    // walk down the page so scroll-triggered reveals fire, then return to the top
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 400) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(120); }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  if (scrollTo !== null) await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
  await page.waitForTimeout(wait);
  const file = `${prefix}-${width}.png`;
  await page.screenshot({ path: file, fullPage: full });
  console.log('saved', file);
  await page.close();
}
await browser.close();
