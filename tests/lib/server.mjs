/** Shared by the two suites: one production build, served on a spare port, killed cleanly. */
import { spawn } from "node:child_process";
import { createServer } from "node:net";

/** A port nobody holds right now, so a second run or a stale server cannot collide. */
export async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

export async function waitForServer(base, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base);
      if (response.ok) {
        return;
      }
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`the server did not answer on ${base} within ${timeoutMs}ms`);
}

/**
 * Start `npm run start` on a free port with no Comfy endpoint configured, so every route
 * takes its demo path. Pass `comfyUrl` to point the adapter at an endpoint, for example an
 * unreachable one, to exercise its failure path. Resolves once the home page answers; `stop`
 * kills the whole group.
 */
export async function startServer({ comfyUrl } = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  const isWindows = process.platform === "win32";

  const env = { ...process.env, KINEMI_SKIP_GUARD: "1" };
  delete env.COMFY_URL;
  delete env.COMFY_API_KEY;
  if (comfyUrl) {
    env.COMFY_URL = comfyUrl;
  }

  const child = spawn("npm", ["run", "start", "--", "-p", String(port)], {
    stdio: "ignore",
    detached: !isWindows,
    shell: isWindows,
    env,
  });

  const stop = () => {
    if (!child.pid) {
      return;
    }
    if (isWindows) {
      // Windows has no POSIX process groups; taskkill walks the npm -> next tree.
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    }
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill();
    }
  };

  try {
    await waitForServer(base);
  } catch (error) {
    // A server that never answered must not outlive the test run.
    stop();
    throw error;
  }

  return { base, stop };
}
