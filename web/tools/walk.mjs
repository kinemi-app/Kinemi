// Scrolls down the page one screen at a time and saves a contact sheet of what a visitor sees.
//   node tools/walk.mjs [width] [height] -> tools/.tmp/walk-<width>.png
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');
const width = Number(process.argv[2] || 390);
const height = Number(process.argv[3] || 844);
const url = process.env.BASE_URL || 'http://127.0.0.1:4321/';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: width < 900, isMobile: width < 900 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const total = await page.evaluate(() => document.documentElement.scrollHeight);
const files = [];
for (let y = 0, i = 0; y < total; y += Math.round(height * 0.9), i++) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(1300);
  const f = `tools/.tmp/walk-${width}-${String(i).padStart(2, '0')}.png`;
  await page.screenshot({ path: f });
  files.push(f);
}
await browser.close();
execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
files = sys.argv[2:]
ims = [Image.open(f) for f in files]
cols = int(sys.argv[1])
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (w + 12), rows * (h + 12)), (40, 40, 40))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * (w + 12), (i // cols) * (h + 12)))
sheet.save('tools/.tmp/walk-${width}.png')
print(len(ims), 'frames', sheet.size)
`, String(width < 600 ? 6 : 3), ...files], { stdio: 'inherit' });
