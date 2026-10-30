/**
 * Whether `npm start` runs the chat's Claude Code / Codex bridge, and how Next must listen for it.
 * The bridge runs commands on this computer, so it is only on while Next listens on loopback alone:
 * a Host header can be forged from the network, a listening address can't.
 *
 * KINEMI_LOCAL_CLI=off turns the bridge off and leaves Next where it was (every interface by default).
 * A hostname passed to `npm start -- -H …` is kept; the bridge is on only when it is a loopback one.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const OFF = new Set(["off", "0", "false", "no"]);

/** @returns {{ args: string[], bound: boolean }} Next's arguments, and whether the bridge may answer. */
export function nextLaunch(args, setting) {
  if (OFF.has(String(setting ?? "").trim().toLowerCase())) return { args, bound: false };
  const host = lastHostname(args);
  if (host === undefined) return { args: [...args, "-H", "127.0.0.1"], bound: true };
  return { args, bound: LOOPBACK.has(host ?? "") };
}

/** The hostname Next will use: the last one given, as in Next's own parser. null means -H with no value. */
function lastHostname(args) {
  let host;
  args.forEach((arg, i) => {
    if (arg === "-H" || arg === "--hostname") host = args[i + 1] ?? null;
    else if (arg.startsWith("--hostname=")) host = arg.slice("--hostname=".length);
  });
  return host;
}

/** The env flag the Next routes under app/api/local/ read; only the launcher sets it. */
export const BOUND_FLAG = "KINEMI_LOCAL_CLI_BOUND";
