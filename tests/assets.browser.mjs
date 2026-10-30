/**
 * The studio's asset library in the server's SQLite file: a fresh studio shows no sample assets,
 * an imported still is saved with its bytes and survives a reload, and a deleted asset stays
 * deleted. Needs `npm run build` first.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, test } from "node:test";

import { openBrowser } from "./lib/browser.mjs";
import { pageOpener, poll, seedStorage, until } from "./lib/page.mjs";
import { startServer } from "./lib/server.mjs";

let app;
let browser;
const errors = [];
const open = pageOpener(() => ({ browser, app }), errors);

before(async () => {
  assert.ok(existsSync("web/dist/index.html"), "web/dist is missing: run `npm run build` first");
  app = await startServer();
  browser = await openBrowser();
});

after(async () => {
  await browser?.close();
  app?.stop();
});

const NAME = "server-still";
const LOCAL = "local-upgrade";
const REFUSED = "refused-file";
const SENTINEL = { id: "tg-sentinel", name: "server-tag", color: "#39d879" };

/** The library the server's database holds. */
async function serverLibrary() {
  const response = await fetch(`${app.base}/api/library`);
  assert.equal(response.status, 200);
  return response.json();
}

/** Put one item in the server's library, as another client would. */
async function putTag(tag) {
  const response = await fetch(`${app.base}/api/library/tag/${encodeURIComponent(tag.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(tag),
  });
  assert.equal(response.status, 200);
}

/** A page expression: an asset card with this exact name is on screen. */
const named = (name) => `[...document.querySelectorAll('.acard-name')].some((n) => n.textContent === ${JSON.stringify(name)})`;

/** A page expression: the sidebar lists this exact label, so the library finished loading. */
const sideLabel = (label) => `[...document.querySelectorAll('.side-item .side-text')].some((n) => n.textContent === ${JSON.stringify(label)})`;

/** Import a small still through the Assets page's file input, the way a person drops one in. */
async function importStill(page, name) {
  await until(page.run, "document.querySelector('input[type=file]')", "the assets file input", 10000);
  await page.run(`(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
    canvas.getContext('2d').fillRect(0, 0, 64, 36);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const input = document.querySelector('input[type=file]');
    const files = new DataTransfer();
    files.items.add(new File([blob], ${JSON.stringify(`${name}.png`)}, { type: 'image/png' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await until(page.run, named(name), `the imported ${name}`, 10000);
}

/** Select the card with this name and press the bulk bar's button with this label. */
const selectCard = (name) => `(() => {
  const card = [...document.querySelectorAll('.acard')].find((c) => c.querySelector('.acard-name')?.textContent === ${JSON.stringify(name)});
  card.querySelector('.acard-check input').click();
  return true;
})()`;

test("a fresh studio shows none of the sample assets", async () => {
  assert.deepEqual(await serverLibrary(), { assets: [], folders: [], tags: [] }, "the server starts empty");
  // an older build left sample renders in this browser; the server's library must replace them
  const sample = { id: "a_sample", name: "sample-render", kind: "still", tool: "reshoot", folderId: null, tagIds: [], favorite: false, createdAt: 1, aspect: "16:9", scene: "neon", seed: 1, source: "seed" };
  await seedStorage(open, { "kinemi.studio.v1": JSON.stringify({ v: 1, assets: [sample], folders: [], tags: [], chats: [], cast: [], settings: {}, drafts: {} }) });

  const { run, shot } = await open("/app/assets/");
  await until(
    run,
    "(() => { try { const s = JSON.parse(localStorage.getItem('kinemi.studio.v1') || 'null'); return !!s && Array.isArray(s.assets) && s.assets.length === 0; } catch { return false; } })()",
    "the server's empty library to replace the browser's",
    10000,
  );
  assert.equal(await run("document.querySelectorAll('.acard, .arow:not(.arow-head)').length"), 0);
  assert.equal(await run("document.body.innerText.includes('sample-render')"), false);
  assert.match(await run("document.querySelector('.assets-empty h2').textContent"), /Nothing here yet/);
  await shot("assets-empty");
});

test("an empty server takes over the library the browser already has", async () => {
  // the studio before this version kept its library in localStorage: an upgrade must not lose it
  const asset = {
    id: "a_local_upgrade",
    name: LOCAL,
    kind: "still",
    tool: "reshoot",
    folderId: null,
    tagIds: [],
    favorite: false,
    createdAt: 1,
    aspect: "16:9",
    scene: "neon",
    seed: 1,
    source: "import",
  };
  assert.deepEqual(await serverLibrary(), { assets: [], folders: [], tags: [] }, "the server starts empty");
  await seedStorage(open, {
    "kinemi.studio.v1": JSON.stringify({ v: 1, assets: [asset], folders: [], tags: [], chats: [], cast: [], settings: {}, drafts: {} }),
  });

  const page = await open("/app/assets/");
  await until(page.run, named(LOCAL), "the browser's own asset after the upgrade", 10000);
  await poll(async () => (await serverLibrary()).assets.some((a) => a.id === asset.id), "the upgraded asset on the server", 10000);
});

test("an imported asset is saved on the server with its file and is still there after a reload", async () => {
  // the server's tag proves the library loaded (and the file Remote is installed) before the import
  await putTag(SENTINEL);
  const page = await open("/app/assets/");
  await until(page.run, sideLabel(SENTINEL.name), "the server's tag in the sidebar", 10000);
  await importStill(page, NAME);

  const asset = await poll(async () => (await serverLibrary()).assets.find((a) => a.name === NAME), "the asset in the server's library", 10000);
  const file = await poll(async () => {
    const response = await fetch(`${app.base}/api/files/${encodeURIComponent(asset.id)}`);
    return response.status === 200 ? response : null;
  }, "the asset's file on the server", 10000);
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.ok((await file.arrayBuffer()).byteLength > 0, "the bytes came back");
  await page.shot("assets-imported");

  // forget the browser's own copy of the bytes: the reload must read them from the server
  await page.run(`new Promise((resolve, reject) => {
    const req = indexedDB.open('kinemi-files', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(${JSON.stringify(asset.id)});
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  })`);

  const again = await open("/app/assets/");
  await until(again.run, sideLabel(SENTINEL.name), "the library after a reload", 10000);
  await until(again.run, named(NAME), "the imported asset after a reload", 10000);
  await until(again.run, "document.querySelector('.acard img.poster-file')?.naturalWidth > 0", "the picture read back from the server", 10000);
});

test("an import the server cannot store leaves no asset behind", async () => {
  await putTag(SENTINEL);
  const page = await open("/app/assets/");
  await until(page.run, sideLabel(SENTINEL.name), "the library before the failed import", 10000);

  // the upload is the step that fails, the way it would with the server unreachable
  await page.run(`(() => {
    const real = window.fetch;
    window.__realFetch = real;
    window.fetch = (input, init) => String(input).includes('/api/files/') ? Promise.reject(new TypeError('offline')) : real(input, init);
    return true;
  })()`);
  await page.run(`(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
    canvas.getContext('2d').fillRect(0, 0, 64, 36);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const input = document.querySelector('input[type=file]');
    const files = new DataTransfer();
    files.items.add(new File([blob], ${JSON.stringify(`${REFUSED}.png`)}, { type: 'image/png' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  await until(page.run, "document.body.innerText.includes('Couldn’t store that file')", "the failed-import toast", 10000);
  await page.run("window.fetch = window.__realFetch");
  assert.equal(await page.run(named(REFUSED)), false, "the refused file is not in the library");
  assert.equal((await serverLibrary()).assets.some((a) => a.name === REFUSED), false, "and not on the server");
  await page.shot("assets-refused");
});

test("a deleted asset stays deleted after a reload", async () => {
  const asset = (await serverLibrary()).assets.find((a) => a.name === NAME);
  assert.ok(asset, "the imported asset is on the server");

  const { run } = await open("/app/assets/");
  await until(run, sideLabel(SENTINEL.name), "the library before deleting", 10000);
  await until(run, named(NAME), "the imported asset", 10000);
  await run(selectCard(NAME));
  await run("document.querySelector('.bulk [aria-label=\"Move to trash\"]').click()");
  await until(run, `!(${named(NAME)})`, "the asset to leave the library", 5000);

  await run(`[...document.querySelectorAll('.side-item')].find((item) => item.querySelector('.side-text')?.textContent === 'Trash').querySelector('.side-link').click()`);
  await until(run, named(NAME), "the asset in the trash", 5000);
  await run(selectCard(NAME));
  await run("[...document.querySelectorAll('.bulk button')].find((b) => b.textContent.includes('Delete forever')).click()");
  await until(run, "document.querySelector('.dialog .btn-danger')", "the confirmation", 5000);
  await run("document.querySelector('.dialog .btn-danger').click()");

  await poll(async () => !(await serverLibrary()).assets.some((a) => a.id === asset.id), "the delete in the server's library", 10000);
  await poll(async () => (await fetch(`${app.base}/api/files/${encodeURIComponent(asset.id)}`)).status === 404, "the file's delete on the server", 10000);

  const again = await open("/app/assets/");
  await until(again.run, sideLabel(SENTINEL.name), "the library after a reload", 10000);
  assert.equal(await again.run(named(NAME)), false, "the deleted asset did not come back");
  assert.equal(await again.run(named(LOCAL)), true, "the upgraded asset is untouched");
  await again.run(`[...document.querySelectorAll('.side-item')].find((item) => item.querySelector('.side-text')?.textContent === 'Trash').querySelector('.side-link').click()`);
  await until(again.run, "document.querySelector('.assets-empty h2')", "the empty trash", 5000);
  assert.equal(await again.run(named(NAME)), false, "the trash is empty too");
});

test("no page logged a console error", () => {
  assert.deepEqual(errors, []);
});
