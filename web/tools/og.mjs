// Renders the social preview (public/og.jpg, 1200 x 630) from the live hero.
// Needs `npm run dev` running. Usage: node tools/og.mjs
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.env.DEV_URL || 'http://127.0.0.1:4321';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-hand-stage].is-framed', { timeout: 15000 });
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '.nav{display:none!important}' });
await page.locator('[data-hero]').screenshot({ path: 'tools/.tmp/og-raw.png' });
await browser.close();
// scale to 1200 wide and center-crop to 630 tall
execFileSync('python3', ['-I', '-c', `
from PIL import Image
im = Image.open('tools/.tmp/og-raw.png').convert('RGB')
w, h = im.size
im = im.resize((1200, round(h * 1200 / w)), Image.LANCZOS)
top = max(0, (im.height - 630) // 2)
im.crop((0, top, 1200, top + 630)).save('public/og.jpg', quality=88, optimize=True, progressive=True)
print('og.jpg written')
`], { stdio: 'inherit' });
