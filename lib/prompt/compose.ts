/** What the flow can add to a written idea: the stacked camera moves and the chosen look. */
export type PromptFacts = {
  camera?: string;
  look?: string;
};

/** The API's prompt ceiling: the helper never writes more than a submit accepts. */
const MAX_PROMPT_CHARS = 2000;

function factPart(value: string | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Turns one written sentence into a prompt: the idea, then the camera moves and the look when the
 * flow has them. An empty idea returns "", because there is nothing to fill from.
 */
export function composePromptHelp(sentence: string, facts: PromptFacts): string {
  const idea = sentence.trim().replace(/\.$/, "");
  if (idea === "") {
    return "";
  }

  const parts = [idea, factPart(facts.camera), factPart(facts.look)].filter((part) => part !== "");
  return `${parts.join(", ")}.`.slice(0, MAX_PROMPT_CHARS);
}
