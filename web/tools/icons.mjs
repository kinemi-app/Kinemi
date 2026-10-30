// Preview sheet of the pixel icons: node tools/icons.mjs -> tools/.tmp/icons.png
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const src = fs.readFileSync('src/lib/pixel-icons.ts', 'utf8');
const block = src.slice(src.indexOf('export const ICONS'), src.indexOf('} satisfies'));
const icons = {};
for (const m of block.matchAll(/(\w+): \[\n((?:\s+'[^']*',\n)+)\s+\]/g)) icons[m[1]] = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
const col = { '#': '#f2f7f4', '+': '#39d879', 1: '#39d879', 2: '#2ee6c4', 3: '#f2f7f4', 4: '#0d5f86', 5: '#145a37' };
const svg = (rows) => `<svg viewBox="0 0 9 9" width="108" height="108" shape-rendering="crispEdges">${rows.flatMap((r, y) => [...r].map((c, x) => (c !== '.' ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${col[c]}"/>` : ''))).join('')}</svg>`;
const html = `<body style="margin:0;background:#0d1b2a;display:flex;flex-wrap:wrap;gap:24px;padding:24px;width:1100px;font:12px monospace;color:#a7b4c0">${Object.entries(icons).map(([k, r]) => `<div style="display:grid;gap:6px;justify-items:center">${svg(r)}${k}</div>`).join('')}</body>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1150, height: 400 } });
await page.setContent(html);
await page.screenshot({ path: 'tools/.tmp/icons.png', fullPage: true });
await browser.close();
