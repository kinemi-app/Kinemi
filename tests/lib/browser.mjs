/**
 * A small Chromium driver for the browser checks: it finds a browser already on disk (CHROME_BIN,
 * Playwright's cache or the system Chrome) and speaks the DevTools protocol over Node's built-in
 * WebSocket, so the tests add no npm dependency.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const VIEWPORT = { width: 1440, height: 900 };

/** No single protocol call may hang the suite: a dead browser rejects instead of waiting forever. */
const REQUEST_TIMEOUT_MS = 30000;

/** Where Playwright puts its browsers on this platform. */
function playwrightCache() {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "ms-playwright");
  }
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "ms-playwright");
  }
  return join(homedir(), ".cache", "ms-playwright");
}

/** The usual Chrome install locations, so a desktop browser works without CHROME_BIN. */
function systemBrowsers() {
  if (process.platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  if (process.platform === "win32") {
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return [
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    ];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
}

/** CHROME_BIN wins, then Playwright's cache, then the system browser. */
function findChrome() {
  if (process.env.CHROME_BIN) {
    return process.env.CHROME_BIN;
  }
  const cache = playwrightCache();
  const builds = (existsSync(cache) ? readdirSync(cache) : [])
    .map((name) => {
      const match = name.match(/^(chromium|chromium_headless_shell)-(\d+)$/);
      return match ? { name, family: match[1], build: Number(match[2]) } : null;
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => b.build - a.build);
  const candidates = [];
  for (const { name, family } of builds) {
    if (family === "chromium_headless_shell") {
      candidates.push(
        join(cache, name, "chrome-headless-shell-linux64", "chrome-headless-shell"),
        join(cache, name, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
        join(cache, name, "chrome-headless-shell-mac-x64", "chrome-headless-shell"),
        join(cache, name, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
      );
    } else {
      candidates.push(
        join(cache, name, "chrome-linux", "chrome"),
        join(cache, name, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        join(cache, name, "chrome-win", "chrome.exe"),
      );
    }
  }
  const found = [...candidates, ...systemBrowsers()].find((candidate) => existsSync(candidate));
  if (found) {
    return found;
  }
  throw new Error("no Chromium found; set CHROME_BIN to a Chrome or chrome-headless-shell binary");
}

/** A full Chrome has to be told to go headless; the headless shell already is. */
function headlessArgs(binary) {
  return binary.includes("chrome-headless-shell") ? [] : ["--headless=new"];
}

/** No message ids, no borrowed client: the protocol calls these checks need. */
function devtoolsClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (typeof message.id === "number" && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(`${message.error.message} (code ${message.error.code})`));
      } else {
        resolve(message.result);
      }
      return;
    }
    for (const entry of listeners.get(message.method) ?? []) {
      if (entry.sessionId !== undefined && entry.sessionId !== message.sessionId) {
        continue;
      }
      entry.listener(message.params ?? {});
    }
  });

  socket.addEventListener("close", () => {
    for (const { reject } of pending.values()) {
      reject(new Error("the browser connection closed"));
    }
    pending.clear();
  });

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error(`cannot connect to ${wsUrl}`)), { once: true });
  });

  return {
    opened,
    send(method, params = {}, sessionId) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out after ${REQUEST_TIMEOUT_MS}ms`));
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    /** Listen for one protocol event, optionally only for one page session, never for every page. */
    on(method, listener, sessionId) {
      listeners.set(method, [...(listeners.get(method) ?? []), { listener, sessionId }]);
    },
    close() {
      socket.close();
    },
  };
}

function textOf(args) {
  return args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" ");
}

/** Software WebGL, for a screenshot that has to show the studio's 3D view. */
const WEBGL_ARGS = ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"];

async function launchBrowser(binary, profile, { webgl = false } = {}) {
  const child = spawn(
    binary,
    [
      ...headlessArgs(binary),
      ...(webgl ? WEBGL_ARGS : ["--disable-gpu"]),
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  const wsUrl = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("the browser did not open a DevTools port"));
    }, 15000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the browser exited with code ${code} before it was ready`));
    });
  });

  return { child, wsUrl };
}

/** Launch one browser for the whole run and hand back the calls the checks need. */
export async function openBrowser({ webgl = false } = {}) {
  const profile = await mkdtemp(join(tmpdir(), "kinemi-chrome-"));
  const { child, wsUrl } = await launchBrowser(findChrome(), profile, { webgl });
  const client = devtoolsClient(wsUrl);
  await client.opened;

  /** Navigate, collect console errors and uncaught exceptions, and wait for hydration. */
  async function openPage(url, { width, height, dpr = 1, mobile = false } = {}) {
    const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });

    const consoleErrors = [];
    client.on(
      "Runtime.consoleAPICalled",
      (event) => {
        if (event.type === "error") {
          consoleErrors.push(textOf(event.args));
        }
      },
      sessionId,
    );
    client.on(
      "Runtime.exceptionThrown",
      (event) => {
        consoleErrors.push(
          event.exceptionDetails.exception?.description ?? event.exceptionDetails.text,
        );
      },
      sessionId,
    );

    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    if (width && height) {
      await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile }, sessionId);
    }

    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the page did not finish loading ${url}`)), 20000);
      client.on(
        "Page.loadEventFired",
        () => {
          clearTimeout(timer);
          resolve();
        },
        sessionId,
      );
    });

    await client.send("Page.navigate", { url }, sessionId);
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return { sessionId, consoleErrors };
  }

  async function evaluate(sessionId, expression) {
    const reply = await client.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (reply.exceptionDetails) {
      throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    }
    return reply.result.value;
  }

  /** Save a screenshot to a path, creating its folder. */
  async function capture(sessionId, path) {
    const shot = await client.send("Page.captureScreenshot", { format: "png" }, sessionId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(shot.data, "base64"));
  }

  /** Move the real mouse to a point in the page, so hover, pointerover and pointerenter fire. */
  async function mouse(sessionId, x, y) {
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
  }

  /** Set a page's viewport and pixel density, for a picture at a slot's own size. */
  async function resize(sessionId, { width, height, dpr = 1, mobile = false }) {
    await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile }, sessionId);
  }

  /** Force a media feature, such as reduced motion, so a capture is not caught mid-animation. */
  async function media(sessionId, features) {
    await client.send("Emulation.setEmulatedMedia", { features }, sessionId);
  }

  /** Close the browser and delete its throwaway profile. */
  async function close() {
    client.close();
    child.kill("SIGKILL");
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  return { openPage, evaluate, capture, mouse, close, resize, media };
}
