// API keys as people paste them: copied out of a .env line, a JSON file or a chat, they often keep
// the quotes around them, and a quote in the key makes the service refuse it.

/** Quote marks a key can arrive wrapped in: straight, back and curly. No API key starts or ends with one. */
const EDGE_QUOTES = /^["'`“”‘’]+|["'`“”‘’]+$/g;

/** A pasted key without the spaces and quote marks around it; anything inside it stays as it is. */
export function cleanKey(raw: string): string {
  return raw.trim().replace(EDGE_QUOTES, '').trim();
}
