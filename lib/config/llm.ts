/**
 * The planner's endpoint, model and key. Kept free of Node built-ins so the planner module can
 * also be imported by the studio's client component; every value is read at call time.
 */
export type LlmSettings = { url: string; apiKey: string; model: string };

function trimmed(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/** Undefined unless both the URL and the model are set; an empty key is allowed. */
export function llmSettings(): LlmSettings | undefined {
  const url = trimmed("LLM_URL");
  const model = trimmed("LLM_MODEL");
  if (url === "" || model === "") {
    return undefined;
  }
  return { url: url.replace(/\/+$/, ""), apiKey: trimmed("LLM_API_KEY"), model };
}
