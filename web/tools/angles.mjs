// Contact sheet of hand angles: node tools/angles.mjs "rx,ry,rz" "rx,ry,rz" ...
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const sets = process.argv.slice(2);
const extra = process.env.Q ? '&' + process.env.Q : '';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 700, height: 800 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
for (const s of sets) {
  const [rx, ry, rz, q = ''] = s.split(',');
  await page.goto(`http://127.0.0.1:4321/lab/hand?still&rx=${rx}&ry=${ry}&rz=${rz}${extra}${q ? '&' + q : ''}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ready);
  await page.waitForTimeout(600);
  const file = `tools/.tmp/angle_${s.replace(/[,=&]/g, '_')}.png`;
  await page.locator('#stage').screenshot({ path: file });
  console.log(file);
}
await browser.close();
// stitch a contact sheet
const { execFileSync } = await import('node:child_process');
execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
files = sys.argv[1:]
ims = [Image.open(f) for f in files]
w = sum(i.width for i in ims); h = max(i.height for i in ims)
sheet = Image.new('RGB', (w, h))
x = 0
for i in ims:
    sheet.paste(i, (x, 0)); x += i.width
sheet.thumbnail((2000, 1000))
sheet.save('tools/.tmp/sheet.png')
`, ...sets.map((s) => `tools/.tmp/angle_${s.replace(/[,=&]/g, '_')}.png`)]);
console.log('sheet: tools/.tmp/sheet.png');
