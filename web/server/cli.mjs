// The two CLIs the chat can run on this computer: what each takes on its command line, what it reads
// on stdin and how its answer is read. Kept out of the HTTP server so a test can check the arguments
// without starting a process or signing in to anything.
//
// Effort is '' for the CLI's own default, or one of the levels that CLI itself accepts; the lists
// differ, so each CLI keeps its own. Checked against the installed binaries (28 Oct 2026):
// `claude --help` (2.1.309) lists --effort low, medium, high, xhigh, max. Codex (0.155.1) lists its
// levels per model in `codex debug models` (gpt-6-luna: low to max; gpt-5.6-terra adds ultra; none
// takes minimal), so runner.mjs reads them from there; `efforts` below is only the fallback when that
// list can't be read. web/src/app/prefs.ts EFFORT_LEVELS offers the same fallback lists in Settings.

export const fail = (code, message) => Object.assign(new Error(message), { code });

// an effort level as a CLI names it: a short lowercase word, never a flag
const LEVEL = /^[a-z]{2,12}$/;

export const CLIS = {
  'claude-code': {
    name: 'Claude Code',
    // an env var, so a copy of the CLI outside PATH still works
    binEnv: 'KINEMI_CLAUDE_BIN',
    bin: 'claude',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    // print mode, JSON out, no tools, no MCP servers, nothing saved; the system prompt comes from a file
    args: ({ model = '', effort = '' } = {}) => [
      '-p',
      '--output-format',
      'json',
      '--tools',
      '',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--system-prompt-file',
      'system.txt',
      '--max-budget-usd',
      '1',
      ...(effort ? ['--effort', effort] : []),
      ...(model ? ['--model', model] : []),
    ],
    input: ({ prompt }) => prompt,
    read(out) {
      const j = JSON.parse(out);
      if (j.is_error) throw fail('cli-error', String(j.result || 'Claude Code reported an error.'));
      return { text: String(j.result ?? ''), model: Object.keys(j.modelUsage ?? {})[0] };
    },
  },
  codex: {
    name: 'Codex',
    binEnv: 'KINEMI_CODEX_BIN',
    bin: 'codex',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    // the models this Codex offers, with the levels each takes
    modelArgs: ['debug', 'models'],
    readModels(out) {
      const j = JSON.parse(out);
      const list = Array.isArray(j) ? j : j?.models;
      if (!Array.isArray(list)) throw fail('cli-error', 'Codex listed no models.');
      return list
        .filter((m) => m && typeof m.slug === 'string' && m.visibility !== 'hide')
        .map((m) => ({
          id: m.slug,
          name: String(m.display_name || m.slug),
          efforts: (m.supported_reasoning_levels ?? []).map((l) => (typeof l === 'string' ? l : l?.effort)).filter((l) => typeof l === 'string' && LEVEL.test(l)),
          default: typeof m.default_reasoning_level === 'string' ? m.default_reasoning_level : '',
        }));
    },
    // non-interactive, read-only sandbox, nothing saved; the prompt comes on stdin, the answer on stdout
    args: ({ model = '', effort = '' } = {}) => [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'read-only',
      ...(effort ? ['-c', `model_reasoning_effort=${effort}`] : []),
      ...(model ? ['--model', model] : []),
      '-',
    ],
    input: ({ system, prompt }) => `${system}\n\n${prompt}`,
    read: (out) => ({ text: out.trim() }),
  },
};

/** Whether a CLI accepts this effort level, from `levels` (a model's own) or the CLI's fallback list;
 *  '' (its own default) is not a level. */
export const isEffort = (id, level, levels = CLIS[id]?.efforts) => typeof level === 'string' && !!CLIS[id] && (levels?.includes(level) ?? false);
