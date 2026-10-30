/**
 * The frontend (web/dist, the Astro build) served by Next's catch-all route: pages, folder
 * redirects, hashed assets, the 404 page, path traversal, and the old routes' redirects. API
 * routes must still win over the catch-all.
 */
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

import { startServer } from "./lib/server.mjs";

/** Media fixtures for the never-packed rule: the build ships no glb or mp4 of its own. */
const FIXTURES = join(process.cwd(), "web", "dist", "__compression-test__");

let app;
before(async () => {
  app = await startServer();
});
after(async () => {
  await rm(FIXTURES, { recursive: true, force: true });
  app?.stop();
});

const get = (path, init) => fetch(`${app.base}${path}`, { redirect: "manual", ...init });

/** A request that keeps the wire bytes: fetch unpacks them and drops the encoding headers. */
function wire(path, { headers = {}, method = "GET" } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(app.base + path);
    const request = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("the landing, the studio and its deep links are pages", async () => {
  for (const path of ["/", "/app/", "/app/tools/", "/app/tools/cinematic/", "/app/assets/", "/app/settings/providers/", "/signin/", "/legal/privacy/"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/, path);
    assert.equal(response.headers.get("cache-control"), "no-cache", path);
    assert.match(await response.text(), /Kinemi/i, path);
  }
});

test("a folder without its trailing slash redirects and keeps the query", async () => {
  const response = await get("/app/tools/cinematic?lesson=dolly");
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "/app/tools/cinematic/?lesson=dolly");
});

test("hashed assets are cached for good and typed", async () => {
  const html = await (await get("/")).text();
  const asset = html.match(/\/_astro\/[^"'\s)]+\.(?:js|css|woff2|avif|webp)/)?.[0];
  assert.ok(asset, "the landing page links at least one /_astro/ file");

  const response = await get(asset);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.notEqual(response.headers.get("content-type"), "application/octet-stream");
});

test("a script and a page are packed, and a client that cannot unpack gets the bytes whole", async () => {
  const studio = await (await get("/app/")).text();
  const script = studio.match(/\/_astro\/[^"'\s)]+\.js/)?.[0];
  assert.ok(script, "the studio links at least one /_astro/ script");

  const plain = await wire(script, { headers: { "accept-encoding": "identity" } });
  const gzipped = await wire(script, { headers: { "accept-encoding": "gzip" } });
  assert.equal(gzipped.headers["content-encoding"], "gzip");
  // Next adds its own vary values for its router headers; ours has to be in there
  assert.match(gzipped.headers.vary ?? "", /accept-encoding/);
  assert.ok(Number(gzipped.headers["content-length"]) < Number(plain.headers["content-length"]), "gzip is smaller than the raw script");
  assert.deepEqual(gunzipSync(gzipped.body), plain.body);

  const brotli = await wire(script, { headers: { "accept-encoding": "br" } });
  assert.equal(brotli.headers["content-encoding"], "br");
  assert.deepEqual(brotliDecompressSync(brotli.body), plain.body);

  const page = await wire("/app/tools/cinematic/", { headers: { "accept-encoding": "gzip, deflate" } });
  assert.equal(page.headers["content-encoding"], "gzip");
  assert.equal(page.headers["cache-control"], "no-cache");
  assert.match(gunzipSync(page.body).toString(), /Kinemi/i);

  const bare = await wire("/app/tools/cinematic/", { headers: { "accept-encoding": "identity" } });
  assert.equal(bare.headers["content-encoding"], undefined);
  assert.equal(Number(bare.headers["content-length"]), bare.body.byteLength);

  // no accept-encoding header at all: the raw bytes, and Vary still keeps caches apart
  const silent = await wire("/app/tools/cinematic/");
  assert.equal(silent.headers["content-encoding"], undefined);
  assert.equal(Number(silent.headers["content-length"]), silent.body.byteLength);
  assert.match(silent.headers.vary ?? "", /accept-encoding/);

  const landing = await wire("/", { headers: { "accept-encoding": "gzip, br" } });
  assert.equal(landing.headers["content-encoding"], "br");
  assert.match(brotliDecompressSync(landing.body).toString(), /Kinemi/i);

  // q=0 means "not this one": the bytes go out whole even though both names appear
  const refused = await wire(script, { headers: { "accept-encoding": "br;q=0, gzip;q=0" } });
  assert.equal(refused.headers["content-encoding"], undefined);
  assert.deepEqual(refused.body, plain.body);
});

test("images, fonts and media are never packed", async () => {
  const landing = await (await get("/")).text();
  const linked = [...landing.matchAll(/\/_astro\/[^"'\s)]+\.(?:avif|webp|woff2|png|jpg)/g)].map((match) => match[0]);
  const files = [...new Set([...linked, "/apple-touch-icon.png", "/og.jpg"])];
  assert.ok(files.length >= 3, "the build ships images and fonts");

  // No 3D model or video ships in the build, so these live under its root for the run; the
  // extension set decides, and each is over the 1 KB floor so no size rule can mask a wrong one.
  const media = { "clip.mp4": "video/mp4", "model.glb": "model/gltf-binary" };
  const bytes = Buffer.from(Array.from({ length: 4096 }, (_, index) => (index * 31 + 7) % 256));
  await mkdir(FIXTURES, { recursive: true });
  for (const name of Object.keys(media)) {
    await writeFile(join(FIXTURES, name), bytes);
  }

  const mediaPaths = Object.keys(media).map((name) => `/__compression-test__/${name}`);
  for (const file of [...files, ...mediaPaths]) {
    const packed = await wire(file, { headers: { "accept-encoding": "gzip, br" } });
    const plain = await wire(file, { headers: { "accept-encoding": "identity" } });
    assert.equal(packed.headers["content-encoding"], undefined, file);
    assert.deepEqual(packed.body, plain.body, file);
  }

  for (const [name, type] of Object.entries(media)) {
    const response = await wire(`/__compression-test__/${name}`, { headers: { "accept-encoding": "gzip, br" } });
    assert.equal(response.status, 200, name);
    assert.equal(response.headers["content-type"], type, name);
    assert.deepEqual(response.body, bytes, name);
  }
});

test("HEAD is bodyless and still announces the encoding", async () => {
  const response = await wire("/app/", { method: "HEAD", headers: { "accept-encoding": "gzip" } });
  assert.equal(response.status, 200);
  assert.equal(response.body.length, 0);
  assert.equal(response.headers["content-encoding"], "gzip");
  assert.ok(Number(response.headers["content-length"]) > 0);
});

test("an unknown path gets the design's 404 page with status 404", async () => {
  const response = await get("/no-such-page/");
  assert.equal(response.status, 404);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(await response.text(), /Kinemi/i);
});

test("paths that climb out of web/dist never reach the repository", async () => {
  for (const path of ["/..%2fpackage.json", "/%2e%2e/%2e%2e/package.json", "/app/..%2f..%2f..%2fpackage.json", "/%00"]) {
    const response = await get(path);
    assert.notEqual(response.status, 200, path);
    assert.doesNotMatch(await response.text(), /"name": "kinemi"/, path);
  }
});

test("HEAD answers like GET without a body", async () => {
  const response = await get("/", { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("API routes win over the frontend's catch-all", async () => {
  const response = await get("/api/status");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
});

const OLD = {
  "/studios": "/app/tools/",
  "/cinematic": "/app/tools/cinematic/",
  "/storyboard": "/app/tools/storyboard/",
  "/reshoot": "/app/tools/re-shoot/",
  "/genjutsu": "/app/tools/genjutsu/",
  "/presets": "/app/tools/presets/",
  "/soul": "/app/tools/soul/",
  "/cast": "/app/tools/ai-cast/",
  "/edit": "/app/tools/edit/",
  "/academy": "/app/tools/academy/",
  "/audio": "/app/tools/audio-studio/",
  "/ads": "/app/tools/marketing-studio/",
  "/fashion": "/app/tools/fashion-factory/",
  "/canvas": "/app/tools/canvas/",
  "/previz": "/app/tools/3d-previz/",
  "/studio": "/app/tools/supercomputer/",
  "/upscale": "/app/tools/upscale/",
};

test("each old route redirects permanently to a studio page that exists", async () => {
  for (const [from, to] of Object.entries(OLD)) {
    const response = await get(from);
    assert.equal(response.status, 308, from);
    assert.equal(response.headers.get("location"), to, from);
    assert.equal((await get(to)).status, 200, to);
  }
});
