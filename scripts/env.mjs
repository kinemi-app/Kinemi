/**
 * Reads a dotenv file before the launcher spawns Next. Kept as plain JavaScript on purpose:
 * `scripts/start.mjs` runs under bare `node`, so it cannot import a TypeScript module on the
 * Node version the README promises. Values already set in `process.env` always win.
 */
import { readFile } from "node:fs/promises";

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXPORT_PREFIX = "export ";
const QUOTES = ["'", '"'];

/** Strip one matching pair of quotes; anything else stays as written. */
function unquote(value) {
  const first = value[0];
  if (!QUOTES.includes(first) || value.length < 2 || value.at(-1) !== first) {
    return value;
  }
  return value.slice(1, -1);
}

/** `KEY=value` lines with optional `export `, `#` comments and one pair of quotes. */
export function parseEnv(text) {
  const values = {};

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const assignment = line.startsWith(EXPORT_PREFIX) ? line.slice(EXPORT_PREFIX.length) : line;
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = assignment.slice(0, separator).trim();
    if (!KEY_PATTERN.test(key)) {
      continue;
    }
    values[key] = unquote(assignment.slice(separator + 1).trim());
  }

  return values;
}

/**
 * Load one file into `process.env` without overriding anything already set. A missing file is not
 * an error: `.env` is optional, and a deployment may configure everything through the real
 * environment instead.
 */
export async function loadEnvFile(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return {};
    }
    throw cause;
  }

  const values = parseEnv(text);
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return values;
}
