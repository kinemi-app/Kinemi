#!/usr/bin/env node
// Kinemi on your own computer. Serves the built site from dist/ and, for the chat, runs the Claude Code or
// Codex CLI installed on this machine in an empty folder of its own (web/server/runner.mjs says how far each is limited).
// It listens on 127.0.0.1 only and answers the studio alone: other websites get nothing.
//
//   node server/local.mjs                      the site and the API on http://localhost:4321
//   node server/local.mjs --api-only --port 4322 --allow-origin http://localhost:4321
//                                              only the API, for `npm run dev` (Astro proxies /api to it)
//
// It also checks Comfy Cloud keys for Settings: Comfy Cloud doesn't take calls from web pages, a server can make them.
//
// Environment: PORT, KINEMI_CLAUDE_BIN, KINEMI_CODEX_BIN (to point at a CLI that isn't on PATH),
// KINEMI_COMFY_CLOUD_URL (defaults to https://cloud.comfy.org).
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail } from './cli.mjs';
import { ask, checkChat, status, version } from './runner.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(opt('port', process.env.PORT || 4321));
const DIST = path.resolve(ROOT, opt('dist', 'dist'));
const API_ONLY = args.includes('--api-only');
const COMFY_CLOUD = String(process.env.KINEMI_COMFY_CLOUD_URL || 'https://cloud.comfy.org').replace(/\/+$/, '');

/** Who may call the API: this server's own pages, plus the dev server when it proxies to us. */
const SELF = [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`];
const ORIGINS = new Set([...SELF.map((h) => `http://${h}`), ...String(opt('allow-origin', '')).split(',').filter(Boolean)]);

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const send = (res, status, body, headers = {}) => {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(data);
};

function readBody(req, limit = 256_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(fail('too-large', 'Request too large.'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

async function api(req, res, route) {
  // a page on another site can't use this: not by renaming itself localhost, not by posting to it
  if (!SELF.includes(String(req.headers.host))) return send(res, 403, { error: 'host' });
  const origin = req.headers.origin;
  if (origin && !ORIGINS.has(origin)) return send(res, 403, { error: 'origin' });

  if (route === 'status' && req.method === 'GET') {
    return send(res, 200, { ok: true, ...(await status()) });
  }
  if (route === 'comfycloud' && req.method === 'GET') {
    // only ever this one request, to Comfy Cloud: a key check, not an open proxy
    const key = String(req.headers['x-api-key'] ?? '');
    if (!key || key.length > 400) return send(res, 400, { error: 'key' }, { 'X-Kinemi-Proxy': '1' });
    try {
      const r = await fetch(`${COMFY_CLOUD}/api/user`, { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(10_000) });
      const body = await r.text();
      res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Kinemi-Proxy': '1' });
      return res.end(body || '{}');
    } catch {
      return send(res, 502, { error: 'unreachable' }, { 'X-Kinemi-Proxy': '1' });
    }
  }
  if (route === 'chat' && req.method === 'POST') {
    // the response closing before it was written means the page went away: stop the CLI. Listening from
    // the start also catches a page that leaves during checkChat, which may ask Codex for its models.
    const gone = new AbortController();
    res.on('close', () => res.writableFinished || gone.abort());
    if (!String(req.headers['content-type']).startsWith('application/json')) return send(res, 415, { error: 'json-only' });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return send(res, e.code === 'too-large' ? 413 : 400, { error: e.code ?? 'bad-json' });
    }
    const checked = await checkChat(body);
    if ('error' in checked) return send(res, checked.status, { error: checked.error });
    try {
      const out = await ask(checked.request, { signal: gone.signal });
      return send(res, 200, { ok: true, ...out });
    } catch (e) {
      return send(res, 502, { error: e.code ?? 'cli-error', message: String(e.message ?? '').slice(0, 400) });
    }
  }
  return send(res, 404, { error: 'not-found' });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

async function file(res, pathname, search) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Bad path');
  }
  const target = path.join(DIST, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (target !== DIST && !target.startsWith(DIST + path.sep)) return send(res, 403, 'Forbidden');
  const candidates = rel.endsWith('/') ? [path.join(target, 'index.html')] : [target, path.join(target, 'index.html'), `${target}.html`];
  for (const p of candidates) {
    const s = await stat(p).catch(() => null);
    if (!s?.isFile()) continue;
    if (!rel.endsWith('/') && p.endsWith(`${path.sep}index.html`) && p !== target) {
      // /app/tools → /app/tools/, like a static host
      res.writeHead(301, { Location: `${pathname}/${search}` });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(p)] ?? 'application/octet-stream',
      'Cache-Control': rel.startsWith('/_astro/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    return createReadStream(p).pipe(res);
  }
  const missing = path.join(DIST, '404.html');
  const has404 = await stat(missing).catch(() => null);
  res.writeHead(404, { 'Content-Type': has404 ? TYPES['.html'] : TYPES['.txt'] });
  return has404 ? createReadStream(missing).pipe(res) : res.end('Not found');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    const m = url.pathname.match(/^\/api\/local\/([a-z]+)$/);
    if (m) return await api(req, res, m[1]);
    if (API_ONLY) return send(res, 404, 'This server only answers /api/local/');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return await file(res, url.pathname, url.search);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'Something went wrong');
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  const where = `http://localhost:${PORT}/`;
  if (!API_ONLY) {
    const built = await stat(path.join(DIST, 'index.html')).catch(() => null);
    if (!built) console.warn(`No build in ${DIST}: run npm run build first.`);
  }
  console.log(API_ONLY ? `Kinemi local API on ${where}api/local/` : `Kinemi is running on ${where}  (the studio: ${where}app/)`);
  const [claude, codex] = await Promise.all([version('claude-code'), version('codex')]);
  console.log(`  Claude Code: ${claude.found ? claude.version : 'not found'} · Codex: ${codex.found ? codex.version : 'not found'}`);
});
