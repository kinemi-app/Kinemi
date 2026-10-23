#!/usr/bin/env node
/**
 * Guarded launcher for Kinemi. Probes RAM, VRAM and free disk against the floors the full Comfy
 * stack needs, brings the docker compose stack up when one is configured, then runs `next start`
 * with the forwarded arguments. A signal or a child exit takes the stack down first.
 */
import { spawn, spawnSync } from "node:child_process";
import console from "node:console";
import { statfs } from "node:fs/promises";
import os from "node:os";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

import { checkHardware } from "../lib/runtime/guard.mjs";

const DEFAULT_FLOORS = { ramGb: 16, vramGb: 8, diskGb: 20 };
const BYTES_PER_GB = 1e9;
const MEGABYTES_PER_GB = 1e3;
const NVIDIA_SMI_TIMEOUT_MS = 5_000;
const COMPOSE_UP_TIMEOUT_MS = 10 * 60_000;
const COMPOSE_DOWN_TIMEOUT_S = 15;
const COMPOSE_DOWN_CAP_MS = 20_000;
const NEXT_STOP_GRACE_MS = 5_000;
const NEXT_KILL_GRACE_MS = 2_000;
const COMMAND_STOP_GRACE_MS = 5_000;
const SIGNALS = ["SIGINT", "SIGTERM"];
const SKIP_VALUES = new Set(["1", "true", "yes", "on"]);

const composeFile = readCommand("KINEMI_COMPOSE_FILE", "");
const dockerCommand = readCommand("KINEMI_DOCKER_CMD", "docker");
const nextCommand = readCommand("KINEMI_NEXT_CMD", "next");
const isWindows = process.platform === "win32";

let nextChild;
let nextClosed = Promise.resolve();
let commandChild;
let commandDone = Promise.resolve();
let isShuttingDown = false;
let teardownPromise;

function readCommand(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

function readNumber(name) {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  }
  return value;
}

function readFloors() {
  return {
    ramGb: readNumber("KINEMI_MIN_RAM_GB") ?? DEFAULT_FLOORS.ramGb,
    vramGb: readNumber("KINEMI_MIN_VRAM_GB") ?? DEFAULT_FLOORS.vramGb,
    diskGb: readNumber("KINEMI_MIN_DISK_GB") ?? DEFAULT_FLOORS.diskGb,
  };
}

function shouldSkipGuard() {
  return SKIP_VALUES.has((process.env.KINEMI_SKIP_GUARD ?? "").trim().toLowerCase());
}

async function freeDiskGb() {
  const stats = await statfs(process.cwd());
  return (stats.bavail * stats.bsize) / BYTES_PER_GB;
}

function probeVramGb() {
  const fake = readNumber("KINEMI_FAKE_VRAM_GB");
  if (fake !== undefined) {
    return fake;
  }

  const probe = spawnSync(
    "nvidia-smi",
    ["--query-gpu=memory.total", "--format=csv,noheader,nounits"],
    { encoding: "utf8", timeout: NVIDIA_SMI_TIMEOUT_MS, windowsHide: true },
  );
  const firstLine = probe.status === 0 ? probe.stdout.trim().split("\n")[0] : undefined;
  const megabytes = Number(firstLine);
  if (!Number.isFinite(megabytes) || megabytes <= 0) {
    console.log("VRAM not detected, floor skipped");
    return undefined;
  }
  return megabytes / MEGABYTES_PER_GB;
}

async function probeResources() {
  const fakeRam = readNumber("KINEMI_FAKE_RAM_GB");
  const fakeDisk = readNumber("KINEMI_FAKE_DISK_GB");
  return {
    ramGb: fakeRam ?? os.totalmem() / BYTES_PER_GB,
    vramGb: probeVramGb(),
    diskGb: fakeDisk ?? (await freeDiskGb()),
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Run one docker command to completion. The child stays in `commandChild` so a signal can stop a
 * `compose up` mid-pull instead of leaving it to race the `compose down` that follows.
 */
function runCommand(command, args, timeoutMs) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: isWindows,
    windowsHide: true,
  });
  commandChild = child;

  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} did not finish within ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });

  const settle = () => {
    if (commandChild === child) {
      commandChild = undefined;
    }
  };
  commandDone = done.then(settle, settle).then(() => undefined);

  return done;
}

function stopCommand() {
  if (commandChild === undefined) {
    return;
  }
  try {
    commandChild.kill("SIGTERM");
  } catch {
    // Already gone; the exit handler still settles commandDone.
  }
}

/**
 * Stop the command in flight and wait for it, but never past the grace: a `compose up` that ignores
 * SIGTERM would otherwise hold the whole shutdown for its ten-minute timeout.
 */
async function stopCommandAndWait() {
  if (commandChild === undefined) {
    await commandDone;
    return;
  }
  stopCommand();
  await Promise.race([commandDone, wait(COMMAND_STOP_GRACE_MS)]);

  const child = commandChild;
  if (child === undefined) {
    return;
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Already gone; the exit handler settles commandDone.
  }
  await Promise.race([commandDone, wait(NEXT_KILL_GRACE_MS)]);
}

async function composeUp() {
  console.log(`Starting the Comfy stack from ${composeFile}`);
  const code = await runCommand(
    dockerCommand,
    ["compose", "-f", composeFile, "up", "-d"],
    COMPOSE_UP_TIMEOUT_MS,
  );
  if (code !== 0) {
    throw new Error(`${dockerCommand} compose up -d exited with code ${code}`);
  }
}

async function composeDown() {
  try {
    const code = await runCommand(
      dockerCommand,
      ["compose", "-f", composeFile, "down", "--timeout", String(COMPOSE_DOWN_TIMEOUT_S)],
      COMPOSE_DOWN_CAP_MS,
    );
    if (code !== 0) {
      console.error(`${dockerCommand} compose down exited with code ${code}`);
    }
  } catch (error) {
    // The app still has to stop even when docker cannot be reached.
    console.error(`${dockerCommand} compose down failed: ${error.message}`);
  }
}

function tearDown() {
  if (teardownPromise === undefined) {
    teardownPromise = composeFile === "" ? Promise.resolve() : composeDown();
  }
  return teardownPromise;
}

async function stopNext() {
  const child = nextChild;
  if (child?.pid === undefined) {
    return;
  }

  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    await Promise.race([nextClosed, wait(NEXT_STOP_GRACE_MS)]);
    return;
  }

  try {
    // The child leads its own process group, so Next's workers stop with it.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([nextClosed, wait(NEXT_STOP_GRACE_MS)]);

  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await Promise.race([nextClosed, wait(NEXT_KILL_GRACE_MS)]);
  }
}

function exitCodeFor(code, signal) {
  if (typeof code === "number") {
    return code;
  }
  const number = signal === null ? undefined : os.constants.signals[signal];
  return number === undefined ? 1 : 128 + number;
}

function signalExitCode(signal) {
  return 128 + (os.constants.signals[signal] ?? 15);
}

async function shutDown({ code, stopChild }) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  await stopCommandAndWait();
  await tearDown();
  if (stopChild) {
    await stopNext();
  }
  process.exit(code);
}

function spawnNext(args) {
  const child = spawn(nextCommand, ["start", ...args], {
    env: process.env,
    stdio: "inherit",
    detached: !isWindows,
    shell: isWindows,
    windowsHide: true,
  });

  nextClosed = new Promise((resolve) => {
    child.once("close", resolve);
    child.once("error", resolve);
  });

  child.once("error", (error) => {
    console.error(`could not start ${nextCommand}: ${error.message}`);
    void shutDown({ code: 1, stopChild: false });
  });
  child.once("close", (code, signal) => {
    void shutDown({ code: exitCodeFor(code, signal), stopChild: false });
  });

  return child;
}

async function run(args) {
  const checkOnly = args.includes("--check");
  const forwardedArgs = args.filter((arg) => arg !== "--check");

  if (checkOnly || !shouldSkipGuard()) {
    const problem = checkHardware(await probeResources(), readFloors());
    if (problem !== null) {
      console.error(problem);
      process.exit(1);
    }
    if (checkOnly) {
      console.log("Hardware floors met.");
      return;
    }
  }

  for (const signal of SIGNALS) {
    process.once(signal, () => {
      void shutDown({ code: signalExitCode(signal), stopChild: true });
    });
  }

  if (composeFile !== "") {
    await composeUp();
  }
  if (isShuttingDown) {
    // A signal during compose up already tore the stack down; never start Next after that.
    return;
  }

  nextChild = spawnNext(forwardedArgs);
}

run(process.argv.slice(2)).catch(async (error) => {
  if (isShuttingDown) {
    return;
  }
  console.error(`start: ${error instanceof Error ? error.message : String(error)}`);
  await tearDown();
  process.exit(1);
});
