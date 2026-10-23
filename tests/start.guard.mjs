/**
 * T-0034: the guarded launcher refuses a machine below the hardware floors and takes the Comfy
 * docker stack down before stopping the app. Docker and Next are faked, so the suite is
 * deterministic and never touches a real engine.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { checkHardware } from "../lib/runtime/guard.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const START_SCRIPT = join(PROJECT_ROOT, "scripts", "start.mjs");

const FLOORS = { ramGb: 16, vramGb: 8, diskGb: 20 };
const COMFORTABLE_FAKES = {
  KINEMI_FAKE_RAM_GB: "64",
  KINEMI_FAKE_VRAM_GB: "24",
  KINEMI_FAKE_DISK_GB: "500",
};

/** Every KINEMI_* value the launcher reads, so a developer's own settings cannot leak in. */
const LAUNCHER_ENV = [
  "KINEMI_MIN_RAM_GB",
  "KINEMI_MIN_VRAM_GB",
  "KINEMI_MIN_DISK_GB",
  "KINEMI_SKIP_GUARD",
  "KINEMI_COMPOSE_FILE",
  "KINEMI_DOCKER_CMD",
  "KINEMI_NEXT_CMD",
  "KINEMI_FAKE_RAM_GB",
  "KINEMI_FAKE_VRAM_GB",
  "KINEMI_FAKE_DISK_GB",
  "START_FAKE_HANG_UP",
  "START_FAKE_IGNORE_UP_TERM",
];

/**
 * A stand-in for docker or next: it appends its arguments to START_FAKE_LOG. A fake next stays
 * alive when START_FAKE_STAY_ALIVE is set, so the launcher can be signalled mid-run.
 */
const FAKE_COMMAND = String.raw`import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(process.env.START_FAKE_LOG, args.join(" ") + "\n");

if (args[0] === "start" && process.env.START_FAKE_STAY_ALIVE === "1") {
  process.on("SIGTERM", () => {
    appendFileSync(process.env.START_FAKE_LOG, "next received SIGTERM\n");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 30000);
}

if (args[0] === "compose" && args.includes("up") && process.env.START_FAKE_HANG_UP === "1") {
  process.on("SIGTERM", () => {
    appendFileSync(process.env.START_FAKE_LOG, "compose up received SIGTERM\n");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 30000);
}

if (args[0] === "compose" && args.includes("up") && process.env.START_FAKE_IGNORE_UP_TERM === "1") {
  process.on("SIGTERM", () => {
    appendFileSync(process.env.START_FAKE_LOG, "compose up ignored SIGTERM\n");
  });
  setTimeout(() => process.exit(0), 30000);
}
`;

function launcherEnv(extraEnv) {
  const env = { ...process.env };
  for (const name of LAUNCHER_ENV) {
    delete env[name];
  }
  delete env.START_FAKE_LOG;
  delete env.START_FAKE_STAY_ALIVE;
  return { ...env, ...extraEnv };
}

function launch(args, extraEnv) {
  const child = spawn(process.execPath, [START_SCRIPT, ...args], {
    cwd: PROJECT_ROOT,
    env: launcherEnv(extraEnv),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, output }));
  });

  return { child, done, output: () => output };
}

/** Write an executable fake command: a shebang script on POSIX, a .cmd wrapper on Windows. */
async function writeFakeCommand(directory, name) {
  if (process.platform === "win32") {
    const script = join(directory, `${name}.mjs`);
    await writeFile(script, FAKE_COMMAND);
    const wrapper = join(directory, `${name}.cmd`);
    await writeFile(wrapper, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    return wrapper;
  }

  const command = join(directory, name);
  await writeFile(command, `#!/usr/bin/env node\n${FAKE_COMMAND}`);
  await chmod(command, 0o755);
  return command;
}

async function readLog(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function waitForLog(path, marker, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await readLog(path);
    if (text.includes(marker)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`the launcher never logged ${JSON.stringify(marker)}`);
}

async function readCalls(path) {
  const text = (await readLog(path)).trim();
  return text === "" ? [] : text.split("\n");
}

/** Start the launcher against fake docker and Next binaries, with a compose file of its own. */
async function launchStack(directory, extraEnv = {}) {
  const log = join(directory, "calls.log");
  const docker = await writeFakeCommand(directory, "fake-docker");
  const next = await writeFakeCommand(directory, "fake-next");
  const composeFile = join(directory, "compose.yaml");
  await writeFile(composeFile, "services: {}\n");

  const run = launch([], {
    ...COMFORTABLE_FAKES,
    KINEMI_COMPOSE_FILE: composeFile,
    KINEMI_DOCKER_CMD: docker,
    KINEMI_NEXT_CMD: next,
    START_FAKE_LOG: log,
    ...extraEnv,
  });

  return {
    run,
    log,
    upLine: `compose -f ${composeFile} up -d`,
    downLine: `compose -f ${composeFile} down --timeout 15`,
  };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

test("checkHardware passes a machine that meets every floor", () => {
  assert.equal(checkHardware({ ramGb: 16, vramGb: 8, diskGb: 20 }, FLOORS), null);
});

test("checkHardware skips the VRAM floor when VRAM was not detected", () => {
  assert.equal(checkHardware({ ramGb: 32, diskGb: 100 }, FLOORS), null);
});

test("checkHardware names every shortfall in one line and ends with the ask", () => {
  const problem = checkHardware({ ramGb: 8, vramGb: 4, diskGb: 10 }, FLOORS);
  assert.ok(problem !== null, "expected a problem line");
  assert.match(problem, /RAM/);
  assert.match(problem, /VRAM/);
  assert.match(problem, /disk/i);
  assert.doesNotMatch(problem, /\n/);
  assert.match(problem, /ask the user/i);
  assert.match(problem, /starting the full stack/i);
});

test("--check refuses low RAM and tells the agent to ask the user", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kinemi-guard-"));
  const log = join(directory, "calls.log");
  try {
    const next = await writeFakeCommand(directory, "fake-next");
    const run = launch(["--check"], {
      KINEMI_FAKE_RAM_GB: "4",
      KINEMI_FAKE_VRAM_GB: "24",
      KINEMI_FAKE_DISK_GB: "500",
      KINEMI_NEXT_CMD: next,
      START_FAKE_LOG: log,
    });

    const result = await run.done;
    assert.equal(result.code, 1);
    assert.match(result.output, /ask the user/i);
    assert.match(result.output, /RAM/);
    assert.equal(existsSync(log), false, "next must not start when the guard refuses");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("--check exits 0 on a comfortable machine without starting Next", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kinemi-guard-"));
  const log = join(directory, "calls.log");
  try {
    const next = await writeFakeCommand(directory, "fake-next");
    const run = launch(["--check"], {
      ...COMFORTABLE_FAKES,
      KINEMI_NEXT_CMD: next,
      START_FAKE_LOG: log,
    });

    const result = await run.done;
    assert.equal(result.code, 0);
    assert.equal(existsSync(log), false, "next must not start for --check");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("KINEMI_SKIP_GUARD bypasses the floors", { timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "kinemi-guard-"));
  const log = join(directory, "calls.log");
  try {
    const next = await writeFakeCommand(directory, "fake-next");
    const run = launch([], {
      KINEMI_SKIP_GUARD: "1",
      KINEMI_FAKE_RAM_GB: "4",
      KINEMI_FAKE_VRAM_GB: "1",
      KINEMI_FAKE_DISK_GB: "1",
      KINEMI_NEXT_CMD: next,
      START_FAKE_LOG: log,
    });

    const result = await withTimeout(run.done, 15000, "the launcher");
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.output, /ask the user/i);
    assert.ok((await readCalls(log)).includes("start"), "Next must run when the guard is skipped");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "SIGTERM takes the Comfy stack down before stopping the app",
  {
    skip: process.platform === "win32" ? "Windows cannot deliver SIGTERM to a console process" : false,
    timeout: 30000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "kinemi-guard-"));
    let run;
    try {
      const stack = await launchStack(directory, { START_FAKE_STAY_ALIVE: "1" });
      run = stack.run;

      await waitForLog(stack.log, stack.upLine);
      await waitForLog(stack.log, "start");
      assert.equal(run.child.kill("SIGTERM"), true);

      const result = await withTimeout(run.done, 15000, "the launcher");
      assert.equal(result.code, 143);

      await waitForLog(stack.log, "next received SIGTERM");
      const calls = await readCalls(stack.log);
      assert.ok(calls.includes(stack.upLine), `missing "${stack.upLine}" in:\n${calls.join("\n")}`);
      assert.ok(
        calls.includes(stack.downLine),
        `missing "${stack.downLine}" in:\n${calls.join("\n")}`,
      );
      assert.ok(calls.indexOf(stack.downLine) > calls.indexOf(stack.upLine), "down must follow up");
      assert.ok(calls.includes("next received SIGTERM"), "Next must be told to stop");
      assert.ok(
        calls.indexOf("next received SIGTERM") > calls.indexOf(stack.downLine),
        "the app must stop after the stack is down",
      );
    } finally {
      run?.child.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("a Next process that exits by itself also takes the stack down", { timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "kinemi-guard-"));
  try {
    const stack = await launchStack(directory);

    const result = await withTimeout(stack.run.done, 15000, "the launcher");
    assert.equal(result.code, 0);

    const calls = await readCalls(stack.log);
    assert.ok(calls.includes(stack.upLine), `missing "${stack.upLine}" in:\n${calls.join("\n")}`);
    assert.ok(
      calls.includes(stack.downLine),
      `missing "${stack.downLine}" in:\n${calls.join("\n")}`,
    );
    assert.ok(calls.indexOf(stack.downLine) > calls.indexOf(stack.upLine), "down must follow up");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("comfortable fakes start Next and exit with its code", { timeout: 20000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "kinemi-guard-"));
  const log = join(directory, "calls.log");
  try {
    const next = await writeFakeCommand(directory, "fake-next");
    const run = launch(["-p", "4321"], {
      ...COMFORTABLE_FAKES,
      KINEMI_NEXT_CMD: next,
      START_FAKE_LOG: log,
    });

    const result = await withTimeout(run.done, 15000, "the launcher");
    assert.equal(result.code, 0);

    const calls = await readCalls(log);
    assert.ok(calls.includes("start -p 4321"), `missing the forwarded port in:\n${calls.join("\n")}`);
    assert.ok(calls.every((line) => !line.startsWith("compose ")), "no compose file means no docker call");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "SIGTERM during compose up stops the stack and never starts Next",
  {
    skip: process.platform === "win32" ? "Windows cannot deliver SIGTERM to a console process" : false,
    timeout: 30000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "kinemi-guard-"));
    let run;
    try {
      const stack = await launchStack(directory, { START_FAKE_HANG_UP: "1" });
      run = stack.run;

      await waitForLog(stack.log, stack.upLine);
      assert.equal(run.child.kill("SIGTERM"), true);

      const result = await withTimeout(run.done, 15000, "the launcher");
      assert.equal(result.code, 143);

      const calls = await readCalls(stack.log);
      assert.ok(
        calls.includes("compose up received SIGTERM"),
        `the hanging compose up must be stopped:\n${calls.join("\n")}`,
      );
      assert.ok(
        calls.includes(stack.downLine),
        `missing "${stack.downLine}" in:\n${calls.join("\n")}`,
      );
      assert.ok(calls.indexOf(stack.downLine) > calls.indexOf(stack.upLine), "down must follow up");
      assert.ok(
        calls.every((line) => !line.startsWith("start")),
        `Next must not start after a signal during compose up:\n${calls.join("\n")}`,
      );
    } finally {
      run?.child.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "a compose up that ignores SIGTERM is killed within the grace",
  {
    skip: process.platform === "win32" ? "Windows cannot deliver SIGTERM to a console process" : false,
    timeout: 30000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "kinemi-guard-"));
    let run;
    try {
      const stack = await launchStack(directory, { START_FAKE_IGNORE_UP_TERM: "1" });
      run = stack.run;

      await waitForLog(stack.log, stack.upLine);
      const startedAt = Date.now();
      assert.equal(run.child.kill("SIGTERM"), true);

      const result = await withTimeout(run.done, 15000, "the launcher");
      const elapsed = Date.now() - startedAt;
      assert.equal(result.code, 143);
      assert.ok(elapsed < 10000, `the shutdown waited ${elapsed}ms, not the five-second grace`);

      const calls = await readCalls(stack.log);
      assert.ok(
        calls.includes("compose up ignored SIGTERM"),
        `the fake must ignore SIGTERM:\n${calls.join("\n")}`,
      );
      assert.ok(
        calls.includes(stack.downLine),
        `missing "${stack.downLine}" in:\n${calls.join("\n")}`,
      );
      assert.ok(
        calls.every((line) => !line.startsWith("start")),
        `Next must not start after a signal during compose up:\n${calls.join("\n")}`,
      );
    } finally {
      run?.child.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  },
);
