// Checks server/local.mjs, the Kinemi server for your own computer, with stand-ins for the claude and
// codex commands and for Comfy Cloud. Needs a build in dist/ (npm run build).
//   node tools/local-server.mjs
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4399;
const CLOUD_PORT = 4398;
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` · ${extra}` : ''}`);
  if (!ok) failed++;
};

// stand-in commands that note how they were called
const bin = mkdtempSync(path.join(tmpdir(), 'kinemi-bin-'));
const log = mkdtempSync(path.join(tmpdir(), 'kinemi-log-'));
writeFileSync(
  path.join(bin, 'claude'),
  `#!/bin/sh
if [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; exit 0; fi
printf '%s\\n' "$@" > "${log}/claude-args.txt"
pwd > "${log}/claude-cwd.txt"
cat system.txt > "${log}/claude-system.txt"
cat > "${log}/claude-stdin.txt"
if [ -f "${log}/signed-out" ]; then echo "Invalid API key · Please run /login" >&2; exit 1; fi
echo '{"type":"result","subtype":"success","is_error":false,"result":"{\\"reply\\":\\"ready\\"}","modelUsage":{"claude-stand-in":{}}}'
`,
);
writeFileSync(
  path.join(bin, 'codex'),
  `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 0.99.0"; exit 0; fi
printf '%s\\n' "$@" > "${log}/codex-args.txt"
cat > "${log}/codex-stdin.txt"
echo '{"reply":"ready from codex"}'
`,
);
chmodSync(path.join(bin, 'claude'), 0o755);
chmodSync(path.join(bin, 'codex'), 0o755);

// a stand-in for Comfy Cloud's /api/user
const cloud = http.createServer((req, res) => {
  const ok = req.headers['x-api-key'] === 'comfyui-good-key';
  res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(ok ? { email: 'ada@example.com' } : { code: 'UNAUTHORIZED' }));
});
await new Promise((r) => cloud.listen(CLOUD_PORT, '127.0.0.1', r));

if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.log('No build in dist/: run npm run build first.');
  process.exit(1);
}
const server = spawn(process.execPath, ['server/local.mjs', '--port', String(PORT)], {
  cwd: ROOT,
  env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, KINEMI_COMFY_CLOUD_URL: `http://127.0.0.1:${CLOUD_PORT}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve) => server.stdout.on('data', (d) => /running on/.test(String(d)) && resolve()));

const at = `http://127.0.0.1:${PORT}`;
const req = (p, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((resolve) => {
    const r = http.request(`${at}${p}`, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    if (body) r.write(body);
    r.end();
  });
const chat = (o, headers = {}) => req('/api/local/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(o) });

// the site
const home = await req('/app/');
check('serves the studio', home.status === 200 && home.body.includes('<html'));
const bare = await req('/app/tools?x=1');
check('a folder without its slash is redirected, query kept', bare.status === 301 && bare.headers.location === '/app/tools/?x=1');
const lost = await req('/no-such-page/');
check('an unknown page gets the 404 page', lost.status === 404 && lost.body.includes('isn’t in the edit'));
const sneaky = await req('/../package.json');
check('nothing outside dist/ is served', sneaky.status !== 200 || !sneaky.body.includes('"kinemi-web"'));

// what's installed
const status = JSON.parse((await req('/api/local/status')).body);
check('reports the installed CLIs', status.claude?.found && status.claude.version.startsWith('9.9.9') && status.codex?.found);

// Claude Code
const sys = 'You are a test. Answer {"reply": "ready"}.';
const c = await chat({ provider: 'claude-code', model: 'sonnet', system: sys, prompt: 'Are you there?' });
const cj = JSON.parse(c.body);
check('Claude Code answers through the server', c.status === 200 && cj.text === '{"reply":"ready"}' && cj.model === 'claude-stand-in');
const args = readFileSync(path.join(log, 'claude-args.txt'), 'utf8').split('\n');
check('…in print mode with every tool switched off', args.includes('-p') && args[args.indexOf('--tools') + 1] === '' && args.includes('--no-session-persistence') && args.includes('--strict-mcp-config'));
check('…the system prompt from a file, the model as asked', readFileSync(path.join(log, 'claude-system.txt'), 'utf8') === sys && args[args.indexOf('--model') + 1] === 'sonnet');
check('…the message on stdin, never on the command line', readFileSync(path.join(log, 'claude-stdin.txt'), 'utf8') === 'Are you there?' && !args.some((a) => a.includes('Are you there')));
const cwd = readFileSync(path.join(log, 'claude-cwd.txt'), 'utf8').trim();
check('…in an empty folder of its own, cleaned up after', cwd.includes('kinemi-') && !cwd.startsWith(ROOT) && !existsSync(cwd));

// Codex
const x = await chat({ provider: 'codex', system: sys, prompt: 'Hello' });
check('Codex answers through the server', x.status === 200 && JSON.parse(x.body).text === '{"reply":"ready from codex"}');
const xargs = readFileSync(path.join(log, 'codex-args.txt'), 'utf8').split('\n');
check('…non-interactive, in a read-only sandbox', xargs[0] === 'exec' && xargs[xargs.indexOf('--sandbox') + 1] === 'read-only' && xargs.includes('--skip-git-repo-check') && xargs.includes('--ephemeral'));
check('…system and message on stdin', readFileSync(path.join(log, 'codex-stdin.txt'), 'utf8') === `${sys}\n\nHello`);

// a signed-out CLI
writeFileSync(path.join(log, 'signed-out'), '');
const so = await chat({ provider: 'claude-code', system: sys, prompt: 'hi' });
check('a signed-out CLI is reported as such', so.status === 502 && JSON.parse(so.body).error === 'signed-out');
rmSync(path.join(log, 'signed-out'));

// other websites get nothing
check('another site’s page is refused', (await chat({ provider: 'claude-code', system: sys, prompt: 'hi' }, { Origin: 'https://evil.example' })).status === 403);
check('a renamed host (DNS rebinding) is refused', (await chat({ provider: 'claude-code', system: sys, prompt: 'hi' }, { Host: `evil.example:${PORT}` })).status === 403);
check('only JSON is taken', (await req('/api/local/chat', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status === 415);
check('an unknown provider is refused', (await chat({ provider: 'bash', system: sys, prompt: 'hi' })).status === 400);
check('a model name with odd characters is refused', (await chat({ provider: 'codex', model: 'gpt; rm -rf /', system: sys, prompt: 'hi' })).status === 400);

// Comfy Cloud keys, checked by the server
const good = await req('/api/local/comfycloud', { headers: { 'X-API-Key': 'comfyui-good-key' } });
check('a Comfy Cloud key is checked through the server', good.status === 200 && good.headers['x-kinemi-proxy'] === '1' && JSON.parse(good.body).email === 'ada@example.com');
const bad = await req('/api/local/comfycloud', { headers: { 'X-API-Key': 'comfyui-bad-key' } });
check('…and a wrong one comes back refused', bad.status === 401);

server.kill();
cloud.close();
rmSync(bin, { recursive: true, force: true });
rmSync(log, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
