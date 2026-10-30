/**
 * Stand-ins for Claude Code and Codex, so the chat bridge tests run without either CLI installed or
 * signed in. Each answers a chat run with the arguments it was handed; Codex also lists CODEX_MODELS.
 */
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** What `codex debug models` prints (0.155.1), cut to the fields Kinemi reads. */
export const CODEX_MODELS = {
  models: [
    { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", default_reasoning_level: "medium", supported_reasoning_levels: [{ effort: "low" }] },
    { slug: "gpt-6-luna", display_name: "GPT-6-Luna", visibility: "list", default_reasoning_level: "medium", supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max"].map((effort) => ({ effort })) },
    { slug: "gpt-5.6-terra", display_name: "GPT-5.6-Terra", visibility: "list", default_reasoning_level: "medium", supported_reasoning_levels: ["low", "max", "ultra", "--yolo"].map((effort) => ({ effort })) },
  ],
};

/** Write a node script as an executable, with a .cmd beside it on Windows (no shebangs there). */
async function script(folder, name, body) {
  const file = join(folder, `${name}.mjs`);
  await writeFile(file, `#!/usr/bin/env node\nconst argv = process.argv.slice(2);\n${body}\n`);
  await chmod(file, 0o755);
  if (process.platform !== "win32") return file;
  const cmd = join(folder, `${name}.cmd`);
  await writeFile(cmd, `@"${process.execPath}" "%~dp0${name}.mjs" %*\r\n`);
  return cmd;
}

/** Claude Code prints one JSON object whose `result` is the answer. Each run adds a line to runs.log.
 *  Asked for the model `slow`, it writes its pid to slow.pid and answers after SLOW_MS, leaving
 *  slow.done: a run that was stopped never writes it. */
export const SLOW_MS = 1500;
export const fakeClaude = (folder) =>
  script(
    folder,
    "fake-claude",
    `const fs = await import('node:fs');
fs.appendFileSync(${JSON.stringify(join(folder, "runs.log"))}, argv.join(' ') + '\\n');
const answer = () => process.stdout.write(JSON.stringify({ result: JSON.stringify({ reply: 'ok', argv }), modelUsage: {} }) + '\\n');
if (!argv.includes('slow')) answer();
else {
  fs.writeFileSync(${JSON.stringify(join(folder, "slow.pid"))}, String(process.pid));
  setTimeout(() => (fs.writeFileSync(${JSON.stringify(join(folder, "slow.done"))}, 'x'), answer()), ${SLOW_MS});
}`,
  );

/** Codex prints its answer as is, and its model list for `debug models`. */
export const fakeCodex = (folder) =>
  script(
    folder,
    "fake-codex",
    `if (argv[0] === 'debug' && argv[1] === 'models') process.stdout.write(${JSON.stringify(JSON.stringify(CODEX_MODELS))} + '\\n');
else if (argv[0] === '--version') process.stdout.write('codex-cli 0.155.1\\n');
else if (argv.includes('broken')) { process.stderr.write('model broken is not available\\n'); process.exit(1); }
else process.stdout.write(JSON.stringify({ reply: 'ok', argv }) + '\\n');`,
  );

/** The env that points the bridge at both stand-ins. */
export async function fakeCliEnv(folder) {
  return { KINEMI_CLAUDE_BIN: await fakeClaude(folder), KINEMI_CODEX_BIN: await fakeCodex(folder) };
}
