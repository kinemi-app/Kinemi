// End-to-end checks of the studio dashboard: chat, tools, asset store, persistence.
//   node tools/app-e2e.mjs [base]
// Needs `npm run dev` or `npm run preview`. Exits non-zero when a check fails.
import { createRequire } from 'node:module';
import zlib from 'node:zlib';

const base = process.argv[2] || 'http://127.0.0.1:4321';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const problems = [];
// a refused key and the 404 page fail on purpose: their failed loads are expected
let expected = false;
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && !(expected && /Failed to load resource/.test(m.text())) && problems.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` · ${extra}` : ''}`);
  if (!ok) failed++;
};
const count = (sel) => page.locator(sel).count();
const sideCount = async (label) => Number((await page.locator('.side-item', { hasText: label }).first().locator('.side-count').textContent()) || 0);

// a tiny PNG for the import check
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([57, 216, 121], y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    let c = ~0;
    for (const b of td) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    crc.writeUInt32BE(~c >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- chat
await page.goto(`${base}/app/`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
check('welcome shows the greeting', (await page.locator('.welcome-title').textContent())?.includes('What are we shooting today'));

await page.fill('.composer textarea', 'Slow dolly-in on a rain-soaked neon street, 35mm, f/1.8');
await page.waitForTimeout(500);
check('composer previews the tool and cost', (await count('.composer-preview')) === 1);
await page.keyboard.press('Enter');
await page.waitForSelector('.call', { timeout: 6000 });
await page.waitForTimeout(1500);
check('reply runs Cinematic', (await page.locator('.call-tool').first().textContent())?.includes('Cinematic'));
const params = await page.locator('.call .param dd').allTextContents();
check('lens and aperture parsed', params.includes('35mm') && params.includes('f/1.8'), params.join(', '));
check('chat titled from the shot', (await page.locator('.thread-title h1').textContent())?.toLowerCase().includes('neon street'));

await page.fill('.composer textarea', 'Make it 9:16');
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
const p2 = await page.locator('.call').last().locator('.param dd').allTextContents();
check('follow-up changes the aspect', p2.some((t) => t.includes('9:16')), p2.join(', '));

const assetsBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('kinemi.studio.v1') || '{"assets":[]}').assets.length);
await page.locator('.call').last().locator('.btn-accent').click();
// nothing is connected yet: rendering asks for a Comfy key or a local GPU first, then carries on
await page.waitForSelector('.dialog input[type=password]', { timeout: 4000 });
check('render without a connection asks to connect', (await page.locator('.dialog').textContent())?.includes('Connect ComfyUI to render'));
await page.fill('.dialog input[type=password]', 'comfy_e2e_key_4321');
await page.click('.dialog button[type=submit]');
await page.waitForSelector('.call.is-done .call-result', { timeout: 15000 });
await page.waitForTimeout(600);
const assetsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('kinemi.studio.v1')).assets.length);
check('render lands in the asset store', assetsAfter === assetsBefore + 1, `${assetsBefore} → ${assetsAfter}`);
check('toast announces it', (await count('.toast')) > 0);

check('the chip shows the saved key', (await page.locator('.compute-text b').textContent()) === 'Comfy Cloud');

// ---------------------------------------------------------------- sidebar rail
await page.click('.sidebar-toggle');
await page.waitForTimeout(700);
check('collapse folds the sidebar into a rail', (await count('.app.no-sidebar')) === 1 && (await page.locator('.sidebar').boundingBox()).width < 70);
await page.hover('.sidebar .side-scroll .side-link >> nth=0');
await page.waitForTimeout(250);
check('rail items show their label on hover', (await count('.rail-tip')) === 1);
await page.keyboard.press('[');
await page.waitForTimeout(700);
check('[ expands it again', (await count('.app.no-sidebar')) === 0 && (await page.locator('.sidebar').boundingBox()).width > 200);

// ---------------------------------------------------------------- tools
await page.goto(`${base}/app/tools/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('16 tool cards', (await count('.tv-card')) === 16);
await page.click('.seg-opt:has-text("Studios 7")');
await page.waitForTimeout(300);
check('Studios filter shows 7', (await count('.tv-card')) === 7);
await page.click('.tv-card:has-text("Upscale")');
await page.waitForURL('**/app/tools/upscale/');
check('card opens the tool page', (await page.locator('.ws-title h1').textContent()) === 'Upscale');

await page.goto(`${base}/app/tools/soul/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const takesBefore = await count('.take');
await page.fill('.ws-controls textarea', 'Morning fog over a harbour, pastel boats');
await page.waitForTimeout(400);
const hex = await page.locator('.pal-hex').first().textContent();
await page.click('.ws-render');
await page.waitForSelector('.take', { timeout: 15000 });
await page.waitForFunction((n) => document.querySelectorAll('.take').length > n, takesBefore, { timeout: 15000 });
check('Soul renders a new take', (await count('.take')) === takesBefore + 1, `palette starts ${hex}`);

await page.goto(`${base}/app/tools/presets/`, { waitUntil: 'networkidle' });
check('the move library has 60 moves', (await count('.move-card')) === 60);
await page.click('.chip:has-text("Orbit")');
check('group filter narrows the library', (await count('.move-card')) === 6);
await page.locator('.move-card').first().locator('.btn-accent').click();
await page.waitForURL('**/app/tools/cinematic/');
check('Use in a shot opens Cinematic with the move', (await page.locator('.move-chip').first().textContent())?.includes('Orbit left'));

// visual camera controls
await page.click('.pad-key[aria-label="Crane up"]');
await page.waitForTimeout(200);
check('the rig pad stacks a second move', (await count('.rig-stack .move-chip')) === 2);
check('the prompt follows the pad', (await page.locator('.prompt-box pre').textContent())?.includes('crane up'));
await page.locator('.stops input').first().fill('4');
await page.waitForTimeout(200);
check('the focal ruler sets the lens', (await page.locator('.hud-tr').textContent())?.includes('85MM'));
await page.click('.cards-aspect .card-opt:has-text("9:16")');
await page.click('.cards-body .card-opt:has-text("Super 8")');
await page.waitForTimeout(200);
check('picture cards set aspect and body', (await page.locator('.cards-aspect [aria-checked="true"]').textContent())?.includes('9:16') && (await page.locator('.prompt-box pre').textContent())?.includes('super 8'));

// the Comfy graph behind it, live
await page.click('.stage-bar .seg-opt:has-text("Comfy graph")');
await page.waitForTimeout(300);
check('the Comfy graph draws the workflow', (await count('.cn')) >= 10 && (await page.locator('.cn-title').allTextContents()).includes('KSampler'));
await page.click('.seg-opt:has-text("10 s")');
await page.waitForTimeout(250);
check('a change lights up the node it touches', (await count('.cn.is-changed')) >= 1 && (await page.locator('.comfy-foot').textContent())?.includes('length'));
await page.click('.stage-bar .seg-opt:has-text("API JSON")');
await page.waitForTimeout(200);
check('API JSON is the /prompt payload', (await page.locator('.cj').textContent())?.includes('"class_type": "KSampler"'));
await page.click('.stage-bar .seg-opt:has-text("Monitor")');

// Supercomputer: a plan, not a chat
await page.goto(`${base}/app/tools/supercomputer/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('the plan lays out deliverables × places', (await count('.pcell')) === 16);
await page.locator('.pcell .pcell-main').nth(3).click();
await page.waitForTimeout(200);
check('a cell can be left out', (await count('.pcell.is-off')) === 1 && (await page.locator('.plan-head p').textContent())?.includes('15 renders'));
await page.click('.ws-render');
await page.waitForTimeout(700);
check('the batch runs four at a time', (await count('.pcell.is-rendering')) === 4);
await page.waitForFunction(() => document.querySelectorAll('.pcell.is-done').length === 15, null, { timeout: 90000 });
check('every cell comes back as a take', (await count('.pcell.is-done')) === 15);
await page.locator('.pcell.is-done').first().locator('button[aria-label^="Approve"]').click();
await page.waitForTimeout(200);
check('approving a take offers the upscale', (await page.locator('.ws-run .btn-ghost').textContent())?.includes('Upscale 1 approved'));

// the chat hands a campaign to it
await page.goto(`${base}/app/`, { waitUntil: 'networkidle' });
await page.click('.side-top .btn-primary');
await page.fill('.composer textarea', 'Plan a campaign for a sneaker drop in five cities');
await page.keyboard.press('Enter');
await page.waitForSelector('.call', { timeout: 6000 });
await page.waitForTimeout(1500);
check('the chat hands campaigns to Supercomputer', (await page.locator('.call .call-actions .btn-accent').last().textContent())?.includes('Open the plan'));
await page.locator('.call .call-actions .btn-accent').last().click();
await page.waitForSelector('.plan-grid');
check('Open the plan loads it in Supercomputer', (await page.locator('.plan-head h2').textContent())?.toLowerCase().includes('sneaker drop'));

// no try-out mode anywhere
let demo = false;
for (const path of ['/app/', '/app/tools/', '/app/assets/', '/app/tools/cinematic/', '/app/tools/academy/', '/app/settings/providers/', '/signin/', '/legal/privacy/', '/legal/terms/', '/']) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  if (/\bdemo\b/i.test(await page.evaluate(() => document.body.innerText))) demo = path;
}
check('no page says “demo”', !demo, demo || '');

// ---------------------------------------------------------------- academy
await page.goto(`${base}/app/tools/academy/`, { waitUntil: 'networkidle' });
check('the Academy has 14 lessons in 4 tracks', (await count('.lesson')) === 14 && (await count('.acad-track')) === 4);
const doneBefore = await count('.lesson.is-done');
await page.click('.reader-actions .btn-primary');
check('Academy marks a lesson done', (await count('.lesson.is-done')) === doneBefore + 1);
await page.goto(`${base}/app/tools/academy/?lesson=lenses`, { waitUntil: 'networkidle' });
check('a deep link opens one lesson', (await page.locator('#lesson-title').textContent()) === 'Lenses and aperture');
check('the lesson has a live figure', (await count('.acad-fig .lens-test, .acad-fig .optics, .acad-fig input[type=range]')) > 0);
for (let i = 0; i < (await count('.acad-q')); i++) {
  const q = page.locator('.acad-q').nth(i);
  for (let j = 0; j < (await q.locator('.acad-opt').count()); j++) {
    await q.locator('.acad-opt').nth(j).click();
    if (await q.locator('.acad-opt.is-right').count()) break;
  }
}
await page.waitForTimeout(300);
check('passing the quiz marks it done', (await count('.lesson.is-on.is-done')) === 1);
await page.click('.acad-try .btn-accent');
await page.waitForURL('**/app/tools/cinematic/');
await page.waitForTimeout(300);
check('Try it opens the tool set up for the lesson', (await page.locator('.hud-tr').textContent())?.includes('85MM'));
await page.goto(`${base}/app/tools/academy/`, { waitUntil: 'networkidle' });
await page.click('.acad-bar .seg-opt:has-text("Glossary")');
await page.fill('.acad-search input', 'seed');
await page.waitForTimeout(200);
check('the glossary finds a word', (await count('.acad-term')) >= 1 && (await page.locator('.acad-term dt').allTextContents()).includes('Seed'));

// ---------------------------------------------------------------- assets
await page.goto(`${base}/app/assets/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const total = await count('.acard');
check('asset grid shows every live asset', total > 25, `${total}`);

await page.click('.chip:has-text("Palettes")');
await page.waitForTimeout(300);
check('type filter: palettes only', (await count('.acard')) === (await page.locator('.chip.is-on .chip-n').textContent()) * 1);
await page.click('.pills .link-btn');
await page.waitForTimeout(300);

// drag a card onto a folder
const pitchBefore = await sideCount('Pitch frames');
await page.locator('.acard').nth(3).dragTo(page.locator('.side-item', { hasText: 'Pitch frames' }));
await page.waitForTimeout(400);
check('drag and drop moves into a folder', (await sideCount('Pitch frames')) === pitchBefore + 1, `${pitchBefore} → ${await sideCount('Pitch frames')}`);

// select two and tag them from the bulk bar
await page.locator('.acard-check input').nth(0).click();
await page.locator('.acard-check input').nth(1).click();
check('bulk bar appears with 2 selected', (await page.locator('.bulk-count b').textContent()) === '2');
const heroBefore = await sideCount('hero shot');
await page.click('.bulk >> text=Tag');
await page.click('.menu-item:has-text("hero shot")');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const heroAfter = await sideCount('hero shot');
check('bulk tag adds the tag to both', heroAfter === heroBefore + 2, `${heroBefore} → ${heroAfter}`);

// move them to a new folder through the bulk bar
await page.click('.bulk >> text=Move to');
await page.click('.menu-item:has-text("New folder")');
await page.fill('.dialog input', 'Test folder');
await page.click('.dialog .btn-primary');
await page.waitForTimeout(400);
check('new folder holds the 2 moved assets', (await sideCount('Test folder')) === 2);

// trash and restore
await page.click('.bulk [aria-label="Move to trash"]');
await page.waitForTimeout(300);
check('trash holds them', (await sideCount('Trash')) >= 4);
await page.click('.side-item >> text=Trash');
await page.waitForTimeout(300);
await page.locator('.acard-check input').first().click();
await page.click('.bulk >> text=Restore');
await page.waitForTimeout(300);
check('restore brings one back', (await sideCount('Trash')) >= 3);

// drawer: rename and tag
await page.click('.side-item >> text=All assets');
await page.waitForTimeout(300);
await page.locator('.acard-hit').first().click();
await page.waitForSelector('.drawer');
await page.click('.title-btn');
await page.fill('.drawer-title input', 'Renamed in the drawer');
await page.keyboard.press('Enter');
await page.fill('.tag-input', 'test tag');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('rename from the drawer', (await page.locator('.drawer-title h2').textContent())?.includes('Renamed in the drawer'));
check('new tag from the drawer', (await count('.side-item:has-text("test tag")')) === 1);
await page.keyboard.press('Escape');

// search
await page.keyboard.press('/');
await page.keyboard.type('renamed');
await page.waitForTimeout(300);
check('search finds it', (await count('.acard')) === 1);
await page.fill('.assets-search input', '');

// import a file
await page.setInputFiles('.assets-actions input[type=file]', { name: 'my-frame.png', mimeType: 'image/png', buffer: png(32, 18) });
await page.waitForSelector('.acard img.poster-file', { timeout: 6000 }).catch(() => {});
check('import shows the real image', (await count('.acard img.poster-file')) === 1);

// ---------------------------------------------------------------- persistence
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
check('folders survive a reload', (await sideCount('Test folder')) >= 1);
check('imported file survives a reload', (await count('.acard img.poster-file')) === 1);
await page.goto(`${base}/app/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
check('the new chat survives a reload', (await count('.side-item:has-text("Rain-soaked neon street")')) >= 1);

// ---------------------------------------------------------------- settings
// stand-ins for ComfyUI on this computer, OpenRouter and the Kinemi local server
const comfyStats = { system: { comfyui_version: '0.3.68', python_version: '3.12.7 (main, Oct 1 2025)', pytorch_version: '2.8.0+cu128', os: 'posix' }, devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync', type: 'cuda', index: 0, vram_total: 25757220864, vram_free: 23622320128 }] };
const combo = (list) => [list, {}];
const objectInfo = {
  UNETLoader: { input: { required: { unet_name: combo(['wan2.2_ti2v_5B_fp16.safetensors', 'flux1-dev.safetensors']), weight_dtype: combo(['default']) } } },
  // newer ComfyUI writes combos as ['COMBO', { options }]
  CLIPLoader: { input: { required: { clip_name: ['COMBO', { options: ['umt5_xxl_fp8_e4m3fn_scaled.safetensors', 'subdir/t5xxl_fp16.safetensors'] }] } } },
  VAELoader: { input: { required: { vae_name: combo(['wan2.2_vae.safetensors', 'ae.safetensors']) } } },
  CheckpointLoaderSimple: { input: { required: { ckpt_name: combo([]) } } },
  UpscaleModelLoader: { input: { required: { model_name: combo(['4x-UltraSharp.pth']) } } },
};
const cors = { 'Access-Control-Allow-Origin': '*' };
await ctx.route('http://127.0.0.1:8188/**', (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/system_stats') return route.fulfill({ json: comfyStats, headers: cors });
  const node = decodeURIComponent(u.pathname.replace('/object_info/', ''));
  if (objectInfo[node]) return route.fulfill({ json: { [node]: objectInfo[node] }, headers: cors });
  return route.fulfill({ json: {}, headers: cors });
});
let routerBody = null;
let routerFails = false;
await ctx.route('https://openrouter.ai/api/v1/**', async (route) => {
  const req = route.request();
  const auth = req.headers()['authorization'];
  if (auth !== 'Bearer sk-or-v1-e2e-test-key-9876') return route.fulfill({ status: 401, json: { error: { message: 'No auth' } }, headers: cors });
  if (req.url().includes('/models')) return route.fulfill({ json: { data: [{ id: 'anthropic/claude-test', name: 'Claude Test', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' } }, { id: 'openai/gpt-test', name: 'GPT Test', context_length: 128000, pricing: { prompt: '0.0000025', completion: '0.00001' } }] }, headers: cors });
  if (routerFails) return route.fulfill({ status: 401, json: { error: { message: 'User not found' } }, headers: cors });
  routerBody = JSON.parse(req.postData() || '{}');
  const answer = { reply: 'A slow orbit around the lighthouse, upright for phones, on an 85.', tool: 'cinematic', values: { prompt: 'A lighthouse on a cliff at dusk, waves breaking', moves: ['Orbit left'], lens: '85 mm', aspect: '9:16', bogus: 'dropped' }, render: false, chips: ['Render it', 'Try 35mm'] };
  return route.fulfill({ json: { model: 'anthropic/claude-test', choices: [{ message: { role: 'assistant', content: JSON.stringify(answer) } }] }, headers: cors });
});
await ctx.route('**/api/local/**', (route) => {
  const u = route.request().url();
  if (u.endsWith('/status')) return route.fulfill({ json: { ok: true, claude: { found: true, version: '2.1.310 (Claude Code)' }, codex: { found: false, error: 'not-installed' } } });
  const body = JSON.parse(route.request().postData() || '{}');
  const test = /connection test/i.test(body.system);
  const text = test ? '{"reply": "ready"}' : JSON.stringify({ reply: 'Set up a dolly in on the cellist, 50mm.', tool: 'cinematic', values: { prompt: 'A cellist rehearsing alone in an empty concert hall', moves: ['dolly-in'], lens: '50mm' } });
  return route.fulfill({ json: { ok: true, text, model: 'claude-haiku-5-5' } });
});

await page.goto(`${base}/app/`, { waitUntil: 'networkidle' });
await page.keyboard.press(',');
await page.waitForTimeout(500);
check(', opens Settings', page.url().includes('/app/settings/account/'));
let sectionsOk = true;
for (const id of ['account', 'providers', 'models', 'rendering', 'interface', 'notifications', 'data', 'about']) {
  await page.goto(`${base}/app/settings/${id}/`, { waitUntil: 'networkidle' });
  if (!(await count('.set-card')) || !(await count(`.side-item.is-on`))) sectionsOk = false;
}
check('every Settings section renders, with its sidebar', sectionsOk);

// the keys you bring live apart from the studio
await page.goto(`${base}/app/settings/providers/`, { waitUntil: 'networkidle' });
const masked = (await page.locator('.set-key-saved code').first().textContent()) ?? '';
check('the saved Comfy key shows masked', masked.includes('••') && masked.endsWith('4321') && !masked.includes('e2e_key'), masked);
const kept = await page.evaluate(() => ({ secrets: localStorage.getItem('kinemi.secrets.v1') ?? '', studio: localStorage.getItem('kinemi.studio.v1') ?? '', device: localStorage.getItem('kinemi.device.v1') ?? '' }));
check('the key is kept apart from the studio', kept.secrets.includes('comfy_e2e_key_4321') && !kept.studio.includes('comfy_e2e_key_4321') && !kept.device.includes('comfy_e2e_key_4321'));
await page.click('.toggle:has-text("Remember keys on this device")');
const tabOnly = await page.evaluate(() => [localStorage.getItem('kinemi.secrets.v1'), sessionStorage.getItem('kinemi.secrets.v1')]);
check('“Remember keys” off keeps them in this tab only', tabOnly[0] === null && !!tabOnly[1]?.includes('comfy_e2e_key_4321'));
await page.click('.toggle:has-text("Remember keys on this device")');

// your own GPU: test the connection
await page.fill('#comfy-address', 'http://127.0.0.1:8188');
await page.click('#renders button[type=submit]');
await page.waitForSelector('#renders .set-result.is-ok', { timeout: 6000 }).catch(() => {});
const stats = (await page.locator('#renders .set-result').textContent()) ?? '';
check('Test connection shows ComfyUI and the GPU', stats.includes('ComfyUI 0.3.68') && stats.includes('NVIDIA GeForce RTX 4090') && stats.includes('24 GB VRAM'), stats.slice(0, 120));
check('local GPU saved in the chip', (await page.locator('.compute-text b').textContent()) === 'Local GPU');

// models: check the files against ComfyUI, rename one
await page.goto(`${base}/app/settings/models/`, { waitUntil: 'networkidle' });
await page.click('button:has-text("Check files on my ComfyUI")');
await page.waitForSelector('#files .set-result', { timeout: 6000 }).catch(() => {});
await page.waitForTimeout(200);
check('Check files marks found, missing and absent nodes', (await count('.set-file .set-chip.is-ok')) >= 5 && (await count('.set-file .set-chip.is-bad')) >= 3 && (await count('.set-file .set-chip:has-text("Node not installed")')) === 1);
check('a file in a subfolder can be adopted', (await count('.set-file button:has-text("subdir/t5xxl_fp16.safetensors")')) === 1);
await page.fill('#file-wan2-2-ti2v-5B-fp16-safetensors', 'my_wan22.safetensors');
await page.keyboard.press('Tab');
await page.locator('.set-model').filter({ hasText: 'HunyuanVideo I2V' }).locator('.toggle').click();

// rendering: 30 fps, and a spending limit
await page.goto(`${base}/app/settings/rendering/`, { waitUntil: 'networkidle' });
await page.click('.seg[aria-label="Frame rate"] .seg-opt:has-text("30")');
await page.click('.toggle:has-text("Ask before anything over a limit")');
await page.locator('#limit input[type=range]').fill('10');
await page.goto(`${base}/app/tools/cinematic/`, { waitUntil: 'networkidle' });
await page.click('.stage-bar .seg-opt:has-text("API JSON")');
await page.waitForTimeout(300);
const api = (await page.locator('.cj').textContent()) ?? '';
check('a renamed model file reaches the API JSON', api.includes('my_wan22.safetensors'));
check('the frame rate reaches the API JSON', api.includes('"fps": 30'));
await page.click('.ws-controls .select:has-text("Wan")');
check('a hidden model leaves the picker', (await count('.menu-item:has-text("HunyuanVideo I2V")')) === 0 && (await count('.menu-item:has-text("HunyuanVideo")')) === 1);
await page.keyboard.press('Escape');
await page.goto(`${base}/app/tools/supercomputer/`, { waitUntil: 'networkidle' });
await page.click('.ws-render');
await page.waitForTimeout(300);
check('the spending limit asks first', (await page.locator('.dialog h2').textContent())?.startsWith('This costs'));
await page.click('.dialog .btn-ghost:has-text("Cancel")');

// parallel renders
await page.goto(`${base}/app/settings/providers/`, { waitUntil: 'networkidle' });
await page.click('.seg[aria-label="Parallel renders"] .seg-opt:has-text("2")');
await page.goto(`${base}/app/settings/rendering/`, { waitUntil: 'networkidle' });
await page.click('.toggle:has-text("Ask before anything over a limit")');
await page.click('.seg[aria-label="Frame rate"] .seg-opt:has-text("24")');
await page.goto(`${base}/app/tools/supercomputer/`, { waitUntil: 'networkidle' });
await page.click('.ws-render');
await page.waitForTimeout(800);
check('Parallel renders sets how many cells render at once', (await count('.pcell.is-rendering')) === 2);

// interface: single-key shortcuts can be switched off
await page.goto(`${base}/app/settings/interface/`, { waitUntil: 'networkidle' });
await page.click('.toggle:has-text("Single-key shortcuts")');
await page.goto(`${base}/app/`, { waitUntil: 'networkidle' });
await page.keyboard.press('2');
await page.waitForTimeout(300);
check('single-key shortcuts can be switched off', new URL(page.url()).pathname === '/app/');
await page.goto(`${base}/app/settings/interface/`, { waitUntil: 'networkidle' });
await page.click('.toggle:has-text("Single-key shortcuts")');
await page.click('.seg[aria-label="Animations"] .seg-opt:has-text("Reduce")');
check('Motion → Reduce calms the page', await page.evaluate(() => document.documentElement.classList.contains('motion-reduce')));
await page.click('.seg[aria-label="Animations"] .seg-opt:has-text("Follow my system")');

// data: a backup never carries the keys
await page.goto(`${base}/app/settings/data/`, { waitUntil: 'networkidle' });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Export the studio")')]);
const backup = (await import('node:fs')).readFileSync(await dl.path(), 'utf8');
check('Export writes the studio without the keys', backup.includes('"kinemi":"studio"') && JSON.parse(backup).assets.length > 20 && !backup.includes('comfy_e2e_key_4321'));

// the chat on OpenRouter, on your own key, one model
await page.goto(`${base}/app/settings/providers/`, { waitUntil: 'networkidle' });
await page.fill('#key-openrouter-api-key', 'sk-or-v1-e2e-test-key-9876');
await page.click('form.set-key:has(#key-openrouter-api-key) button[type=submit]');
await page.waitForSelector('#keys .set-keycol >> nth=1 >> .set-result.is-ok', { timeout: 6000 }).catch(() => {});
check('the OpenRouter key test loads the models', ((await page.locator('#keys .set-keycol').nth(1).locator('.set-result').textContent()) ?? '').includes('2 models'));
check('saving the key switches the chat to OpenRouter', (await count('.set-choice.is-on:has-text("OpenRouter")')) === 1);
await page.click('.set-picker-now button');
await page.click('.set-picker-list button:has-text("Claude Test")');
check('one model is picked for the chat', (await page.locator('.set-picker-now b').textContent()) === 'anthropic/claude-test');
await page.goto(`${base}/app/`, { waitUntil: 'networkidle' });
await page.click('.side-top .btn-primary');
await page.fill('.composer textarea', 'orbit around a lighthouse, vertical, on an 85');
await page.keyboard.press('Enter');
await page.waitForSelector('.call', { timeout: 10000 });
await page.waitForTimeout(1600);
const lp = await page.locator('.call').last().locator('.param dd').allTextContents();
check('OpenRouter’s answer becomes a checked tool call', lp.some((t) => t.includes('9:16')) && lp.some((t) => t.includes('85mm')), lp.join(', '));
check('the message says who answered', (await page.locator('.msg-by').last().textContent())?.includes('OpenRouter · anthropic/claude-test'));
check('the model got the tool catalogue', routerBody?.model === 'anthropic/claude-test' && String(routerBody?.messages?.[0]?.content).includes('Tools and the settings they take'));
routerFails = true;
expected = true;
await page.fill('.composer textarea', 'a crane up over a desert motel');
await page.keyboard.press('Enter');
await page.waitForTimeout(2600);
check('when the model fails, the built-in assistant answers', ((await page.locator('.msg-bot .msg-text').last().textContent()) ?? '').includes('The built-in assistant answered instead'));
expected = false;

// Claude Code on this computer
await page.goto(`${base}/app/settings/providers/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
check('on this computer, Claude Code and Codex are offered', (await count('.set-choice:has-text("Claude Code · on this computer")')) === 1 && (await count('.set-choice:has-text("Codex · on this computer")')) === 1);
check('the local server reports what is installed', (await count('.set-choice:has-text("Claude Code") .set-chip:has-text("2.1.310")')) === 1 && (await count('.set-choice:has-text("Codex") .set-chip:has-text("Not installed")')) === 1);
await page.click('.set-choice-head:has-text("Claude Code")');
await page.click('.set-choice.is-on button:has-text("Send a test message")');
await page.waitForSelector('.set-choice.is-on .set-result', { timeout: 6000 }).catch(() => {});
check('Claude Code answers the test', ((await page.locator('.set-choice.is-on .set-result').textContent()) ?? '').includes('claude-haiku-5-5'));
await page.goto(`${base}/app/`, { waitUntil: 'networkidle' });
await page.click('.side-top .btn-primary');
await page.fill('.composer textarea', 'a cellist alone in a concert hall');
await page.keyboard.press('Enter');
await page.waitForSelector('.call', { timeout: 10000 });
await page.waitForTimeout(1600);
check('the chat runs on Claude Code', (await page.locator('.msg-by').last().textContent())?.includes('Claude Code · claude-haiku-5-5'));
await page.goto(`${base}/app/settings/providers/`, { waitUntil: 'networkidle' });
await page.click('.set-choice-head:has-text("Built-in")');

// ---------------------------------------------------------------- pages outside the studio
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
const legal = await page.locator('.footer-legal a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
let legalOk = legal.length === 6;
for (const href of legal) if ((await page.request.get(`${base}${href}`)).status() !== 200) legalOk = false;
check('the footer links every policy page', legalOk, legal.join(' '));
await page.goto(`${base}/legal/imprint/`, { waitUntil: 'networkidle' });
check('the Imprint names § 5 DDG', ((await page.locator('.prose').textContent()) ?? '').includes('§ 5 DDG'));
await page.goto(`${base}/legal/cookies/`, { waitUntil: 'networkidle' });
check('Cookies and storage lists what is stored', (await count('.prose tbody tr')) >= 5);
await page.goto(`${base}/signin/`, { waitUntil: 'networkidle' });
check('without accounts, Sign in says there are none', (await page.locator('.auth-card h1').textContent()) === 'No accounts here');
expected = true;
const lost = await page.goto(`${base}/no-such-shot/`, { waitUntil: 'networkidle' });
expected = false;
check('an unknown address gets the 404 page', lost?.status() === 404 && ((await page.locator('h1').textContent()) ?? '').includes('isn’t in the edit'));

// ---------------------------------------------------------------- mobile drawer
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
m.on('pageerror', (e) => problems.push(`mobile pageerror: ${e.message}`));
await m.goto(`${base}/app/assets/`, { waitUntil: 'networkidle' });
await m.click('.drawer-btn');
await m.waitForTimeout(500);
check('mobile: sidebar opens as a drawer', await m.locator('.app.drawer-open').count() === 1);
let wide = [];
for (const path of ['/app/assets/', '/app/settings/providers/', '/app/settings/models/', '/app/tools/academy/', '/signin/', '/legal/privacy/', '/legal/licenses/']) {
  await m.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(300);
  if (await m.evaluate(() => document.documentElement.scrollWidth > innerWidth)) wide.push(path);
}
check('mobile: no horizontal overflow', !wide.length, wide.join(' '));

console.log(problems.length ? `\nconsole problems:\n  ${[...new Set(problems)].join('\n  ')}` : '\nno console errors');
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
