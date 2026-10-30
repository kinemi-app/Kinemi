// QA pass: console errors, reduced motion, JavaScript off, heading outline.
// Needs `npm run dev` (or `npm run preview` with BASE_URL). Usage: node tools/qa.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const url = process.env.BASE_URL || 'http://127.0.0.1:4321/';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });

async function run(name, ctxOpts, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...ctxOpts });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await fn(page);
  console.log(`\n[${name}] ${problems.length ? problems.join('\n  ') : 'no console errors'}`);
  await ctx.close();
}

const hiddenCount = (page) =>
  page.evaluate(() => {
    // visible content that is still invisible after load = a bug
    const els = [...document.querySelectorAll('main h2, main h3, main p, main a, footer a')];
    return els.filter((el) => {
      let n = el;
      while (n && n !== document.body) {
        const cs = getComputedStyle(n);
        if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') return !el.closest('.prompt-text');
        n = n.parentElement;
      }
      return false;
    }).length;
  });

await run('default', {}, async (page) => {
  for (let y = 0; y < 9000; y += 500) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1200);
  console.log('hidden after full scroll:', await hiddenCount(page));
  const outline = await page.evaluate(() => [...document.querySelectorAll('h1, h2, h3')].map((h) => `${h.tagName} ${h.textContent.trim().replace(/\s+/g, ' ').slice(0, 50)}`));
  console.log(outline.join('\n'));
  const imgs = await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length);
  console.log('images without alt:', imgs);
  const hand = await page.evaluate(() => document.querySelector('[data-hand-stage]').className);
  console.log('hand stage classes:', hand);
});

await run('reduced-motion', { reducedMotion: 'reduce' }, async (page) => {
  await page.waitForTimeout(800);
  console.log('hidden at load (reduced motion):', await hiddenCount(page));
  console.log('hand stage classes:', await page.evaluate(() => document.querySelector('[data-hand-stage]').className));
  await page.screenshot({ path: 'tools/.tmp/qa-reduced.png' });
});

await run('no-js', { javaScriptEnabled: false }, async (page) => {
  console.log('hidden without JS:', await hiddenCount(page));
  await page.screenshot({ path: 'tools/.tmp/qa-nojs.png' });
});

await browser.close();
