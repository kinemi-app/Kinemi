/**
 * Where a finished schedule run can be announced. Each target is configured by environment
 * variables only, so nothing secret is ever read from the repository or written to a log.
 */

export type NotifyTarget = "slack" | "notion" | "drive";

export type PublishPayload = {
  title: string;
  text: string;
  url?: string;
};

const TIMEOUT_MS = 15_000;
/** Enough of a failing response to explain it without echoing a wall of HTML or a token. */
const MAX_ERROR_BODY = 300;
const NOTION_VERSION = "2022-06-28";
const NOTION_PAGES_URL = "https://api.notion.com/v1/pages";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
/** Notion caps a rich text content value at 2000 characters. */
const NOTION_CONTENT_MAX = 2000;

/**
 * The targets whose environment is complete, in the order the variables are documented. A target
 * with half a configuration is left out rather than failing later at publish time.
 */
export function configuredTargets(): NotifyTarget[] {
  const targets: NotifyTarget[] = [];
  if (process.env.SLACK_WEBHOOK_URL) {
    targets.push("slack");
  }
  if (process.env.NOTION_TOKEN && process.env.NOTION_DATABASE_ID) {
    targets.push("notion");
  }
  if (process.env.GDRIVE_TOKEN) {
    targets.push("drive");
  }
  return targets;
}

/** A missing variable is named, never its value: the message may reach a terminal or a log. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set; add it to the environment before publishing`);
  }
  return value;
}

/** Remove any configured secret a remote service might echo back in an error body. */
function redact(text: string): string {
  let result = text;
  for (const secret of [
    process.env.SLACK_WEBHOOK_URL,
    process.env.NOTION_TOKEN,
    process.env.GDRIVE_TOKEN,
  ]) {
    if (secret) {
      result = result.replaceAll(secret, "[redacted]");
    }
  }
  return result;
}

class PublishError extends Error {
  readonly status: number;

  constructor(target: NotifyTarget, status: number, body: string) {
    const detail = body === "" ? "" : `: ${body}`;
    super(`${target} publish failed with HTTP ${status}${detail}`);
    this.name = "PublishError";
    this.status = status;
  }
}

async function errorBody(response: Response): Promise<string> {
  try {
    const text = (await response.text()).replace(/\s+/g, " ").trim();
    return text.length > MAX_ERROR_BODY ? `${text.slice(0, MAX_ERROR_BODY)}…` : text;
  } catch {
    // The status already explains the failure; an unreadable body adds nothing worth throwing for.
    return "";
  }
}

async function send(
  fetchImpl: typeof fetch,
  target: NotifyTarget,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") {
      throw new Error(`${target} did not answer within ${TIMEOUT_MS / 1000}s`, { cause });
    }
    throw new Error(`${target} could not be reached`, { cause });
  }

  if (!response.ok) {
    throw new PublishError(target, response.status, redact(await errorBody(response)));
  }
  return response;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function readId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" && id !== "" ? id : undefined;
}

async function publishSlack(payload: PublishPayload, fetchImpl: typeof fetch): Promise<string> {
  const webhook = requireEnv("SLACK_WEBHOOK_URL");
  await send(fetchImpl, "slack", webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: payload.text }),
  });
  return "sent";
}

async function publishNotion(payload: PublishPayload, fetchImpl: typeof fetch): Promise<string> {
  const token = requireEnv("NOTION_TOKEN");
  const databaseId = requireEnv("NOTION_DATABASE_ID");
  const content = (payload.url ?? payload.text).slice(0, NOTION_CONTENT_MAX);

  const response = await send(fetchImpl, "notion", NOTION_PAGES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "notion-version": NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: { title: { title: [{ text: { content: payload.title } }] } },
      children: [
        {
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content } }] },
        },
      ],
    }),
  });

  return readId(await readJson(response)) ?? "sent";
}

async function publishDrive(payload: PublishPayload, fetchImpl: typeof fetch): Promise<string> {
  const token = requireEnv("GDRIVE_TOKEN");
  const metadata = JSON.stringify({ name: payload.title, mimeType: "application/json" });
  const form = new FormData();
  form.append("metadata", new Blob([metadata], { type: "application/json" }));
  form.append("file", new Blob([JSON.stringify(payload)], { type: "application/json" }), "payload.json");

  const response = await send(fetchImpl, "drive", DRIVE_UPLOAD_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });

  const id = readId(await readJson(response));
  if (id === undefined) {
    throw new Error("drive answered without a file id");
  }
  return id;
}

/**
 * Announce a finished run. Returns a short reference: the created id for Notion and Drive, or
 * "sent" for Slack. Throws on a missing environment, a timeout or a non-2xx answer.
 */
export async function publish(
  target: NotifyTarget,
  payload: PublishPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  switch (target) {
    case "slack":
      return publishSlack(payload, fetchImpl);
    case "notion":
      return publishNotion(payload, fetchImpl);
    case "drive":
      return publishDrive(payload, fetchImpl);
  }
}
