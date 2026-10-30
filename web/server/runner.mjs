// Running the chat's CLIs on this computer: shared by web/server/local.mjs (the Astro build's server)
// and the Next routes under app/api/local/ (`npm start`). Each CLI runs in an empty folder of its own,
// one call at a time. Claude Code runs with its tools off; Codex runs in its read-only sandbox, which
// still lets it read files this user can read. The HTTP side (who may call) stays with each server.
//
// Environment: KINEMI_CLAUDE_BIN, KINEMI_CODEX_BIN (to point at a CLI that isn't on PATH).
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CLIS, fail, isEffort } from './cli.mjs';

const WIN = process.platform === 'win32';

/** The binary to run: the one an env var names, or the one on PATH. */
const bin = (id) => process.env[CLIS[id].binEnv] || CLIS[id].bin;

const stoppedError = () => fail('stopped', 'The page stopped waiting for this answer.');
const EXIT_GRACE_MS = 5000;

/** Stop a CLI and everything it started. On Windows the CLI runs under cmd.exe, and killing that shell
 *  leaves the CLI itself running (and spending quota), so taskkill takes down the whole tree there. */
export function stop(child, { win = WIN, launch = spawn } = {}) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (win && child.pid) {
    const killer = launch('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill());
    return;
  }
  child.kill();
}

/** Run a command with arguments that never pass through a shell's hands, except on Windows, where
 *  npm's .cmd launchers need one: there every argument is a fixed flag, a checked model name or a file name. */
export function run(command, argv, { input = '', cwd, timeout = 120_000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(stoppedError());
    let child;
    try {
      child = spawn(command, argv.map((a) => (WIN && a === '' ? '""' : a)), { cwd, shell: WIN, windowsHide: true, env: { ...process.env, NO_COLOR: '1' } });
    } catch (e) {
      return reject(e);
    }
    let out = '';
    let err = '';
    let stopped = false;
    // the error a run stopped on purpose ends with: given once its CLI has exited, so the queue never
    // starts the next CLI while the last one is still dying (taskkill on Windows is a process of its own)
    let why = null;
    const end = (reason = null) => {
      if (stopped) return;
      stopped = true;
      why = reason;
      stop(child);
      // 'close' normally follows the kill at once; this only covers a CLI that never reports it
      if (why) setTimeout(() => reject(why), EXIT_GRACE_MS).unref();
    };
    const timer = setTimeout(() => end(fail('timeout', 'No answer within two minutes.')), timeout);
    // the page went away (reload, closed tab, its own timeout): nobody will read the answer, so stop spending quota
    const onAbort = () => end(stoppedError());
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    child.stdout.on('data', (d) => (out.length < 2_000_000 ? (out += d) : end()));
    child.stderr.on('data', (d) => (err.length < 200_000 ? (err += d) : null));
    child.on('error', (e) => {
      done();
      reject(e.code === 'ENOENT' ? fail('not-installed', `${command} isn't installed or isn't on PATH.`) : e);
    });
    child.on('close', (code) => {
      done();
      if (why) return reject(why);
      if (code === 0) return resolve(out);
      // a shell reports a missing command as exit code 127 (9009 on Windows)
      if (code === 127 || code === 9009) return reject(fail('not-installed', `${command} isn't installed or isn't on PATH.`));
      const text = `${err}\n${out}`.trim();
      if (/log ?in|logged out|not authenticated|unauthori[sz]ed|auth(entication)? (required|failed)|api key/i.test(text)) return reject(fail('signed-out', text.slice(-400)));
      reject(fail('cli-error', text.slice(-400) || `Exited with code ${code}.`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

/** A CLI's answer kept for a while: --version and the model list don't change between two clicks. */
function cached(ms, load) {
  const hits = new Map();
  return async (id) => {
    const hit = hits.get(id);
    if (hit && Date.now() - hit.at < ms) return hit.value;
    const value = await load(id);
    hits.set(id, { at: Date.now(), value });
    return value;
  };
}

export const version = cached(30_000, async (id) => {
  try {
    const out = await run(bin(id), ['--version'], { timeout: 10_000 });
    return { found: true, version: out.trim().split('\n')[0].slice(0, 80) };
  } catch (e) {
    return { found: false, error: e.code === 'not-installed' ? 'not-installed' : 'cli-error' };
  }
});

/** The models a CLI lists with their effort levels, or null when it lists none (Claude Code takes aliases). */
export const models = cached(60_000, async (id) => {
  const cli = CLIS[id];
  if (!cli?.modelArgs) return null;
  try {
    return cli.readModels(await run(bin(id), cli.modelArgs, { timeout: 15_000 }));
  } catch {
    return null;
  }
});

/** The levels a request may name: the chosen model's own, any listed model's when none is chosen,
 *  and the CLI's fallback list when it lists no models. */
export async function levelsFor(id, model) {
  const list = await models(id);
  if (!list?.length) return CLIS[id].efforts;
  const one = model && list.find((m) => m.id === model);
  if (one) return one.efforts;
  return [...new Set(list.flatMap((m) => m.efforts))];
}

/** What the studio's Settings shows: each CLI found or not, and Codex's models with their levels. */
export async function status() {
  const [claude, codex, codexModels] = await Promise.all([version('claude-code'), version('codex'), models('codex')]);
  return { claude, codex: codexModels ? { ...codex, models: codexModels } : codex };
}

// never a leading dash: the CLI gets the model as its own argument, and a dash-led one reads as a flag
const MODEL = /^[\w.:/@[\]][\w.:/@[\]-]{0,79}$/;

/** Check a chat request's body. Resolves to `{ request }` for ask(), or to `{ status, error }` to send back. */
export async function checkChat(body) {
  const id = body?.provider;
  if (!Object.hasOwn(CLIS, String(id))) return { status: 400, error: 'provider' };
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : '';
  if (model && !MODEL.test(model)) return { status: 400, error: 'model' };
  // an effort the page didn't send, or an empty one, leaves the CLI on its own default
  const effort = body.effort === undefined || body.effort === null ? '' : String(body.effort);
  if (effort && !isEffort(id, effort, await levelsFor(id, model))) return { status: 400, error: 'effort' };
  if (typeof body.system !== 'string' || typeof body.prompt !== 'string') return { status: 400, error: 'prompt' };
  return { request: { id, system: body.system, prompt: body.prompt, model, effort } };
}

// one CLI call at a time: they are slow, and this keeps a runaway page from starting dozens.
// `signal` is the request's: run() never starts a CLI for a page that left while its turn waited.
let queue = Promise.resolve();
export function ask({ id, system, prompt, model, effort }, { signal } = {}) {
  const job = queue.then(async () => {
    const cli = CLIS[id];
    const cwd = await mkdtemp(path.join(tmpdir(), 'kinemi-'));
    try {
      await writeFile(path.join(cwd, 'system.txt'), system);
      const out = await run(bin(id), cli.args({ model, effort }), { input: cli.input({ system, prompt }), cwd, signal });
      return cli.read(out);
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  });
  queue = job.catch(() => {});
  return job;
}
