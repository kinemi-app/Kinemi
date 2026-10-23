#!/usr/bin/env node

/**
 * Kinemi's command line. It talks to a running app: start one with `npm run start` (or `npm run
 * dev`) and point --base at it. `schedule` and `parity` work offline.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const HOME = join(homedir(), ".kinemi");
const SCHEDULES = join(HOME, "schedules.json");
const DEFAULT_BASE = process.env.KINEMI_BASE ?? "http://localhost:4321";
const POLL_MS = 700;
const REQUEST_TIMEOUT_MS = 20000;
const JOB_TIMEOUT_MS = 120000;

const USAGE = `kinemi - plan and run campaigns against a Kinemi server

  kinemi plan --brief "text" [--out plan.json] [--base url]
  kinemi batch --plan plan.json [--concurrency 2] [--base url] [--dry-run]
  kinemi schedule add --cron "0 9 * * *" --plan plan.json [--name text] [--base url]
  kinemi schedule list
  kinemi schedule print
  kinemi schedule remove --id <id>
  kinemi parity

The server base defaults to ${DEFAULT_BASE}, or KINEMI_BASE.
Schedules live in ${SCHEDULES}; nothing is installed into your crontab by this tool.`;

function fail(message, code = 1) {
  console.error(message);
  process.exitCode = code;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const [key, inline] = token.slice(2).split("=");
    if (inline !== undefined) {
      args[key] = inline;
    } else if (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
      args[key] = argv[index + 1];
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function request(base, path, init) {
  let response;
  try {
    response = await fetch(new URL(path, base), {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") {
      throw new Error(`${path} did not answer within ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw cause;
  }
  const text = await response.text();
  let body;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const reason = body && typeof body.error === "string" ? `: ${body.error}` : "";
    throw new Error(`${path} answered ${response.status}${reason}`);
  }
  return body;
}

function postJson(base, path, payload) {
  return request(base, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function readBase(args) {
  const base = typeof args.base === "string" ? args.base : DEFAULT_BASE;
  try {
    return new URL(base).toString();
  } catch {
    throw new Error(`--base "${base}" is not a URL`);
  }
}

async function commandPlan(args) {
  const brief = args.brief;
  if (typeof brief !== "string" || brief.trim().length < 12) {
    return fail("plan needs --brief with at least 12 characters\n\n" + USAGE, 2);
  }

  const body = await postJson(readBase(args), "/api/studio/plan", { brief });
  const shots = Array.isArray(body?.shots) ? body.shots : [];
  for (const shot of shots) {
    console.log(`${shot.index}. ${shot.title} · ${shot.mode} · ${shot.durationS}s · ${shot.modelId}`);
    console.log(`   ${shot.prompt}`);
  }
  if (typeof args.out === "string") {
    const path = resolve(args.out);
    await writeFile(path, `${JSON.stringify(shots, null, 2)}\n`);
    console.log(`\n${shots.length} shots written to ${path}`);
  }
}

async function runShot(shot, base) {
  const started = Date.now();
  const accepted = await postJson(base, "/api/generate", {
    mode: shot.mode,
    modelId: shot.modelId,
    prompt: shot.prompt,
    durationS: shot.durationS,
  });

  for (;;) {
    await sleep(POLL_MS);
    const job = await request(base, `/api/jobs/${accepted.jobId}`);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (job.status === "succeeded") {
      return { ok: true, line: `${shot.index}. ${shot.title} · ok · ${seconds}s` };
    }
    if (job.status === "failed") {
      return { ok: false, line: `${shot.index}. ${shot.title} · failed · ${job.error ?? "no reason"}` };
    }
    if (Date.now() - started > JOB_TIMEOUT_MS) {
      return { ok: false, line: `${shot.index}. ${shot.title} · timed out after ${seconds}s` };
    }
  }
}

async function commandBatch(args) {
  if (typeof args.plan !== "string") {
    return fail("batch needs --plan <file>\n\n" + USAGE, 2);
  }

  const raw = JSON.parse(await readFile(resolve(args.plan), "utf8"));
  const shots = Array.isArray(raw) ? raw : raw?.shots;
  if (!Array.isArray(shots) || shots.length === 0) {
    return fail(`${args.plan} holds no shots`);
  }
  for (const shot of shots) {
    if (typeof shot.mode !== "string" || typeof shot.modelId !== "string" || typeof shot.prompt !== "string") {
      return fail(`${args.plan} has a shot without mode, modelId or prompt`);
    }
  }

  if (args["dry-run"]) {
    console.log(`${shots.length} shots valid: ${shots.map((shot) => shot.mode).join(", ")}`);
    return;
  }

  const base = readBase(args);
  const limit = Math.min(8, Math.max(1, Number(args.concurrency ?? 2) || 2));
  console.log(`${shots.length} shots, ${limit} at a time, against ${base}`);

  let cursor = 0;
  const results = new Array(shots.length);
  async function worker() {
    while (cursor < shots.length) {
      const index = cursor;
      cursor += 1;
      const shot = shots[index];
      try {
        results[index] = await runShot(shot, base);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        results[index] = { ok: false, line: `${shot.index}. ${shot.title} · failed · ${reason}` };
      }
      console.log(results[index].line);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, shots.length) }, worker));

  const ok = results.filter((result) => result.ok).length;
  console.log(`\n${ok}/${shots.length} succeeded`);
  if (ok !== shots.length) {
    process.exitCode = 1;
  }
}

const CRON_FIELDS = 5;

async function readSchedules() {
  let raw;
  try {
    raw = await readFile(SCHEDULES, "utf8");
  } catch (cause) {
    if (cause instanceof Error && cause.code === "ENOENT") {
      return [];
    }
    throw new Error(`cannot read ${SCHEDULES}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${SCHEDULES} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!Array.isArray(entries)) {
    throw new Error(`${SCHEDULES} does not hold a list of schedules`);
  }
  return entries;
}

async function writeSchedules(entries) {
  await mkdir(HOME, { recursive: true });
  await writeFile(SCHEDULES, `${JSON.stringify(entries, null, 2)}\n`);
}

function cronLine(entry) {
  const plan = entry.plan;
  return `${entry.cron} cd ${process.cwd()} && node bin/kinemi.mjs batch --plan "${plan}" --base ${entry.base} >> "${join(HOME, `${entry.id}.log`)}" 2>&1`;
}

async function commandSchedule(args) {
  const action = args._[1] ?? "list";
  const entries = await readSchedules();

  if (action === "list") {
    if (entries.length === 0) {
      console.log(`no schedules in ${SCHEDULES}`);
      return;
    }
    for (const entry of entries) {
      console.log(`${entry.id}  ${entry.cron}  ${entry.name ?? "(unnamed)"}  ${entry.plan}`);
    }
    return;
  }

  if (action === "print") {
    for (const entry of entries) {
      console.log(cronLine(entry));
    }
    return;
  }

  if (action === "add") {
    const cron = args.cron;
    if (typeof cron !== "string" || cron.trim().split(/\s+/).length !== CRON_FIELDS) {
      return fail(`schedule add needs --cron with ${CRON_FIELDS} fields, for example "0 9 * * *"`, 2);
    }
    if (typeof args.plan !== "string") {
      return fail("schedule add needs --plan <file>", 2);
    }
    const entry = {
      id: randomUUID().slice(0, 8),
      cron: cron.trim(),
      plan: resolve(args.plan),
      base: readBase(args),
      name: typeof args.name === "string" ? args.name : undefined,
    };
    await writeSchedules([...entries, entry]);
    console.log(`added ${entry.id}`);
    console.log(cronLine(entry));
    console.log("nothing was installed; put that line in your crontab yourself");
    return;
  }

  if (action === "remove") {
    if (typeof args.id !== "string") {
      return fail("schedule remove needs --id", 2);
    }
    const kept = entries.filter((entry) => entry.id !== args.id);
    if (kept.length === entries.length) {
      return fail(`no schedule with id ${args.id}`);
    }
    await writeSchedules(kept);
    console.log(`removed ${args.id}`);
    return;
  }

  fail(`unknown schedule action "${action}"\n\n${USAGE}`, 2);
}

function commandParity() {
  const child = spawn(process.execPath, ["scripts/check-parity.mjs"], { stdio: "inherit" });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (command === undefined || command === "help" || args.help) {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case "plan":
      return commandPlan(args);
    case "batch":
      return commandBatch(args);
    case "schedule":
      return commandSchedule(args);
    case "parity":
      return commandParity();
    default:
      return fail(`unknown command "${command}"\n\n${USAGE}`, 2);
  }
}

main().catch((cause) => {
  fail(cause instanceof Error ? cause.message : String(cause));
});
