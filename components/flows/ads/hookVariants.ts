/** Short lines written in the browser; the list never calls the API. */

export const MIN_VARIANTS = 3;
export const MAX_VARIANTS = 9;
export const DEFAULT_VARIANTS = 5;
export const MAX_HOOK_IDEA = 240;

const HOOK_TEMPLATES: Array<(idea: string) => string> = [
  (idea) => `POV: ${idea}`,
  (idea) => `Stop scrolling: ${idea}`,
  (idea) => `3 reasons to try ${idea}`,
  (idea) => `Nobody talks about this: ${idea}`,
  (idea) => `Watch this before you buy: ${idea}`,
  (idea) => `${idea}, in five seconds`,
  (idea) => `The part everyone misses: ${idea}`,
  (idea) => `Try this once: ${idea}`,
  (idea) => `What ${idea} actually looks like`,
];

export function normalizeIdea(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
}

export function hookLines(idea: string, count: number): string[] {
  const clean = normalizeIdea(idea);
  if (clean === "") {
    return [];
  }
  return HOOK_TEMPLATES.slice(0, count).map((template) => template(clean));
}
