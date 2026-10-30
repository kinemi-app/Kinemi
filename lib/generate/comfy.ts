import type { GenerateRequest, Job } from "../types";
import { comfySettings, publicOrigin, type ComfySettings } from "../config/runtime";
import type { WorkflowOutput } from "./pipeline";
import { graphWeights } from "./comfy-progress";
import { createProgressFeed, type ProgressFeed } from "./comfy-progress-feed";
import { closedLive, finishedLive, localRunFailure, type CloudTimes } from "./comfy-run-end";
import { createJob, fail, finish, type Generator } from "./store";
import { graphFor, type GraphTarget } from "./workflows";

/**
 * The ComfyUI adapter: POST /prompt starts a run and answers with a prompt_id, GET /history/:id
 * answers with the outputs once it is done, /view serves the file. The graph for each request
 * comes from lib/generate/workflows, so this file only speaks HTTP and maps outputs.
 *
 * A result URL points at this server's COMFY_VIEW_ROUTE, never at the deployment: a keyed cloud
 * ComfyUI answers /view only with the key, which must stay on the server.
 *
 * Comfy Cloud (COMFY_URL on CLOUD_HOST, docs.comfy.org/development/cloud/api-reference) speaks a
 * variant: the key goes in `X-API-Key`, a run is followed on /job/:id/status and its outputs read
 * from /jobs/:id, and /view answers 302 to signed storage that must be fetched without the key.
 */

/**
 * `isCloud` is set from the host by comfyConfigFromEnv; a caller holding plain settings gets the
 * same answer from the host when it is left out.
 */
type ComfyConfig = ComfySettings & { isCloud?: boolean };

const CLOUD_HOST = "cloud.comfy.org";

/** Cloud's terminal states, from the API reference's prose and its OpenAPI enum, which differ. */
const CLOUD_SUCCESS = new Set(["success", "completed"]);
const CLOUD_FAILURE = new Set(["error", "non_retryable_error", "lost", "cancelled", "failed"]);

/** Cloud answers a submit with this when the account cannot pay for the run. */
const PAYMENT_REQUIRED = 402;

/** Where a browser fetches a finished run's file; app/api/comfy/view relays it from /view. */
export const COMFY_VIEW_ROUTE = "/api/comfy/view";

/** The /view folders a run writes to; `input` holds uploads and is not a result. */
const VIEW_TYPES = ["output", "temp"] as const;

/** One output file on the deployment: everything the proxy forwards to /view, nothing else. */
export type ComfyViewQuery = { filename: string; subfolder: string; type: (typeof VIEW_TYPES)[number] };

/** A submit can wait on a cold deployment; one poll is a single HTTP round trip. */
const SUBMIT_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 30_000;
/** How long /view may take to start answering; the body itself may stream for longer. */
const VIEW_TIMEOUT_MS = 30_000;
/** Enough of Comfy's refusal to name the missing node or file, not a whole HTML error page. */
const MAX_ERROR_BODY = 600;

type ComfyFile = { filename: string; subfolder?: string; type?: string; mime_type?: string };

/** What a submitted run declared, kept until the history answers with a file. */
type Run = {
  promptId: string;
  output: WorkflowOutput;
  width: number;
  height: number;
};

/** The runs a generator follows and the feed that reports how far each one is. */
type Session = { runs: Map<string, Run>; feed: ProgressFeed };

/**
 * The output key each kind reads. VideoHelperSuite's `VHS_VideoCombine` writes `gifs`; a
 * `SaveVideo` clip can arrive under `videos`, `video`, or (on Comfy Cloud) under `images` with a
 * video MIME type. Reading all of them keeps one deployment's node choice invisible to the job route.
 */
const OUTPUT_KEYS: Record<WorkflowOutput, readonly string[]> = {
  image: ["images"],
  // `video` is where Cloud's API reference reads a clip; a real Cloud run put it under `images`
  // with a video MIME type instead, which fileOfKind reads.
  video: ["videos", "gifs", "video"],
  audio: ["audio"],
};

function isCloudUrl(url: string): boolean {
  try {
    return new URL(url).hostname === CLOUD_HOST;
  } catch {
    return false;
  }
}

function isCloud(config: ComfyConfig): boolean {
  return config.isCloud ?? isCloudUrl(config.url);
}

/** The route reads this: no URL, no key, demo mode. */
export function comfyConfigFromEnv(): ComfyConfig | undefined {
  const settings = comfySettings();
  return settings === undefined ? undefined : { ...settings, isCloud: isCloudUrl(settings.url) };
}

/** The graph target for the deployment in the env; no deployment builds the local graphs. */
export function graphTargetFromEnv(): GraphTarget {
  return comfyConfigFromEnv()?.isCloud === true ? "cloud" : "local";
}

/** The key as the deployment expects it: `X-API-Key` on Comfy Cloud, a Bearer token elsewhere. */
export function comfyAuthHeaders(config: ComfyConfig): Record<string, string> {
  if (!config.apiKey) {
    return {};
  }
  return isCloud(config) ? { "x-api-key": config.apiKey } : { authorization: `Bearer ${config.apiKey}` };
}

function headers(config: ComfyConfig): Record<string, string> {
  return { "content-type": "application/json", ...comfyAuthHeaders(config) };
}

/** How a 502 names its run: the mode, plus the feature when the mode splits into one. */
function workflowLabel(request: GenerateRequest): string {
  const feature = request.params?.feature;
  return typeof feature === "string" && feature !== ""
    ? `${request.mode}.${feature}`
    : request.mode;
}

/** The error the route turns into a 502 when Comfy never answered. */
function unreachable(config: ComfyConfig, request: GenerateRequest, cause: unknown): Error {
  return new Error(
    `Comfy could not be reached at ${publicOrigin(config.url)} while submitting the ${workflowLabel(request)} workflow`,
    { cause },
  );
}

/** Comfy's refusal body, capped; undefined when it cannot be read, so the status still shows. */
async function refusalDetail(response: Response, config: ComfyConfig): Promise<string | undefined> {
  try {
    const body = (await response.text()).trim();
    if (body === "") {
      return undefined;
    }
    // A proxy in front of Comfy can echo the request URL; the key must never reach the job's error.
    return body.split(config.url).join(publicOrigin(config.url)).slice(0, MAX_ERROR_BODY);
  } catch {
    return undefined;
  }
}

function isComfyFile(value: unknown): value is ComfyFile {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { filename?: unknown }).filename === "string"
  );
}

/** Read the first file a graph's declared output kind can use, whichever output node wrote it. */
function readOutput(history: unknown, kind: WorkflowOutput): ComfyFile | undefined {
  if (typeof history !== "object" || history === null) {
    return undefined;
  }

  for (const entry of Object.values(history)) {
    const outputs = (entry as { outputs?: Record<string, Record<string, unknown>> }).outputs ?? {};
    for (const output of Object.values(outputs)) {
      const file = fileOfKind(output, kind);
      if (file !== undefined) {
        return file;
      }
    }
  }

  return undefined;
}

/** Comfy Cloud lists a clip under `images` with a `video/*` MIME type (a real run, 2026-10-30). */
function isCloudClip(value: unknown): value is ComfyFile {
  return isComfyFile(value) && typeof value.mime_type === "string" && value.mime_type.startsWith("video/");
}

function fileOfKind(output: Record<string, unknown>, kind: WorkflowOutput): ComfyFile | undefined {
  for (const key of OUTPUT_KEYS[kind]) {
    const value = output[key];
    const candidate = Array.isArray(value) ? value[0] : value;
    if (isComfyFile(candidate)) {
      return candidate;
    }
  }
  const listed = output.images;
  return kind === "video" && Array.isArray(listed) ? listed.find(isCloudClip) : undefined;
}

/** Forget a run that is over, in the generator and in the feed. */
function dropRun({ runs, feed }: Session, jobId: string): void {
  const promptId = runs.get(jobId)?.promptId;
  runs.delete(jobId);
  if (promptId !== undefined && promptId !== "") {
    feed.forget(promptId);
  }
}

async function submitRun(config: ComfyConfig, session: Session, request: GenerateRequest): Promise<Job> {
  // A mode or model without a graph throws here, before a job exists, which the route turns
  // into a 502 whose message names the missing graph.
  const graph = graphFor(request, isCloud(config) ? "cloud" : "local");
  const job = createJob(request, false);
  session.runs.set(job.id, {
    promptId: "",
    output: graph.output,
    width: graph.width,
    height: graph.height,
  });

  let response: Response;
  try {
    response = await fetch(`${config.url}/prompt`, {
      method: "POST",
      headers: headers(config),
      // Local ComfyUI sends progress only to the socket whose clientId matches this one.
      body: JSON.stringify({ prompt: graph.nodes, client_id: session.feed.clientId }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch (cause) {
    dropRun(session, job.id);
    throw unreachable(config, request, cause);
  }

  if (!response.ok) {
    const detail = await refusalDetail(response, config);
    dropRun(session, job.id);
    if (isCloud(config) && response.status === PAYMENT_REQUIRED) {
      return fail(
        job,
        `Comfy Cloud refused the run: not enough Comfy Cloud credits (HTTP ${PAYMENT_REQUIRED}). Add credits to the account, then try again.`,
      );
    }
    const suffix = detail === undefined ? "" : ` — ${detail}`;
    return fail(job, `Comfy refused the run: HTTP ${response.status}${suffix}`);
  }

  let body: { prompt_id?: unknown };
  try {
    body = (await response.json()) as { prompt_id?: unknown };
  } catch {
    dropRun(session, job.id);
    return fail(job, "Comfy answered the run without JSON");
  }
  if (typeof body.prompt_id !== "string") {
    dropRun(session, job.id);
    return fail(job, "Comfy answered without a prompt_id");
  }

  const run = session.runs.get(job.id);
  if (run) {
    run.promptId = body.prompt_id;
  }
  session.feed.track(body.prompt_id, graphWeights(graph.nodes), job.createdAt);
  job.status = "running";
  return job;
}

/**
 * GET one JSON document from the deployment, or undefined when it cannot be read right now: a
 * restart or network blip is expected while a long render runs, so the job stays running and the
 * next poll asks again instead of failing a run the deployment may still finish.
 */
async function getJson(config: ComfyConfig, path: string): Promise<unknown> {
  try {
    const response = await fetch(`${config.url}${path}`, {
      headers: headers(config),
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

async function pollRun(config: ComfyConfig, session: Session, job: Job): Promise<Job> {
  const run = session.runs.get(job.id);
  if (!run || run.promptId === "") {
    return job;
  }
  // The stored job is this very object, so the next GET returns what is set here.
  job.live = session.feed.live(run.promptId);
  if (job.live) {
    job.progress = Math.round(job.live.fraction * 100);
  }
  if (isCloud(config)) {
    return pollCloudRun(config, session, job, run);
  }

  const history = await getJson(config, `/history/${run.promptId}`);
  const reason = localRunFailure(history, run.promptId, job.live);
  if (reason !== undefined) {
    job.live = closedLive(job.live);
    dropRun(session, job.id);
    return fail(job, `ComfyUI ended the run with an error: ${reason}`);
  }
  const output = readOutput(history, run.output);
  if (!output) {
    return job;
  }
  job.live = finishedLive(session.feed, job, run.promptId);
  return finishRun(session, job, run, output);
}

/** Cloud: wait on the run's status, then read its outputs once, from /jobs/:id. */
async function pollCloudRun(config: ComfyConfig, session: Session, job: Job, run: Run): Promise<Job> {
  const id = encodeURIComponent(run.promptId);
  const status = (await getJson(config, `/job/${id}/status`)) as
    | { status?: unknown; error_message?: unknown }
    | undefined;
  const state = typeof status?.status === "string" ? status.status : "";
  if (CLOUD_FAILURE.has(state)) {
    job.live = closedLive(job.live);
    dropRun(session, job.id);
    const detail = typeof status?.error_message === "string" && status.error_message !== "" ? `: ${status.error_message}` : "";
    return fail(job, `Comfy Cloud ended the run with status ${state}${detail}`);
  }
  if (!CLOUD_SUCCESS.has(state)) {
    return job;
  }

  const detail = (await getJson(config, `/jobs/${id}`)) as (CloudTimes & { outputs?: unknown }) | undefined;
  if (detail === undefined) {
    return job;
  }
  const output = readOutput([detail], run.output);
  if (!output) {
    dropRun(session, job.id);
    return fail(job, `Comfy Cloud finished the run without a ${run.output} output`);
  }
  job.live = finishedLive(session.feed, job, run.promptId, detail);
  return finishRun(session, job, run, output);
}

/** Point the job at this server's view route for the run's file and forget the run. */
function finishRun(session: Session, job: Job, run: Run, output: ComfyFile): Job {
  const params = new URLSearchParams({
    filename: output.filename,
    subfolder: output.subfolder ?? "",
    type: output.type ?? "output",
  });
  const finished = finish(job, {
    url: `${COMFY_VIEW_ROUTE}?${params.toString()}`,
    kind: run.output,
    width: run.width,
    height: run.height,
  });
  dropRun(session, job.id);
  return finished;
}

/** A path part that cannot leave its folder: no separators, no `..`, no NUL. */
function isPlainName(part: string): boolean {
  return part !== "" && part !== "." && part !== ".." && !/[/\\\0]/.test(part);
}

/**
 * Read a proxy request's query into one output file, or undefined when it names anything else:
 * a missing or nested filename, a subfolder that climbs or starts at the root, or a folder that is
 * not a run's output. Every other parameter is dropped, so the proxy cannot be steered.
 */
export function parseViewQuery(params: URLSearchParams): ComfyViewQuery | undefined {
  const filename = params.get("filename") ?? "";
  const subfolder = params.get("subfolder") ?? "";
  const type = params.get("type") ?? "output";
  if (!isPlainName(filename)) {
    return undefined;
  }
  if (subfolder !== "" && !subfolder.split("/").every(isPlainName)) {
    return undefined;
  }
  const viewType = VIEW_TYPES.find((allowed) => allowed === type);
  return viewType === undefined ? undefined : { filename, subfolder, type: viewType };
}

/**
 * GET one output file from the deployment with the server's key, forwarding a byte range so a
 * video can seek. The timeout covers only the wait for headers; the caller streams the body.
 *
 * Cloud's /view answers 302 to signed storage. Node's fetch would resend `X-API-Key` across that
 * redirect, so it is read by hand and the signed link is asked with the range alone.
 */
export async function fetchComfyView(
  config: ComfyConfig,
  query: ComfyViewQuery,
  range: string | null,
): Promise<Response> {
  const rangeHeaders: Record<string, string> = range ? { range } : {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VIEW_TIMEOUT_MS);
  try {
    const view = await fetch(`${config.url}/view?${new URLSearchParams(query).toString()}`, {
      headers: { ...comfyAuthHeaders(config), ...rangeHeaders },
      signal: controller.signal,
      redirect: isCloud(config) ? "manual" : "follow",
    });
    const location = view.headers.get("location");
    if (!isCloud(config) || !isRedirect(view.status) || location === null) {
      return view;
    }
    // the 302's own body is never read; cancel it so the connection isn't held open
    await view.body?.cancel();
    const storageUrl = resolveStorageLocation(config, location, config.url);
    return await fetchStorage(config, storageUrl, rangeHeaders, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** How many times signed storage may itself redirect before the link is given up on. */
const MAX_STORAGE_REDIRECTS = 3;

/**
 * GET the signed storage link with the range alone, following its own redirects by hand so every
 * hop passes the same scheme check as the first one (a default `follow` would take an https link
 * on to http://). A relative Location resolves against the URL that sent it.
 */
async function fetchStorage(
  config: ComfyConfig,
  first: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Response> {
  let target = first;
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetch(target, { headers, signal, redirect: "manual" });
    const location = response.headers.get("location");
    if (!isRedirect(response.status) || location === null) {
      return response;
    }
    await response.body?.cancel();
    if (redirects >= MAX_STORAGE_REDIRECTS) {
      throw new Error(`Comfy Cloud storage redirected more than ${MAX_STORAGE_REDIRECTS} times`);
    }
    target = resolveStorageLocation(config, location, target);
  }
}

/** Hostnames as `URL.hostname` spells them; an IPv6 literal keeps its brackets. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Where a redirect from Cloud's /view or from its storage points (a relative Location resolves
 * against `base`, the URL that sent it), if it is safe to follow: https only. The one exception is
 * the test stub, a loopback http Cloud that redirects to its own loopback storage. The error names
 * the scheme and host but never the query, which carries the signed token.
 */
function resolveStorageLocation(config: ComfyConfig, location: string, base: string | URL): URL {
  const target = new URL(location, base);
  const isStubRedirect = isLoopbackHttp(new URL(config.url)) && isLoopbackHttp(target);
  if (target.protocol !== "https:" && !isStubRedirect) {
    throw new Error(`Comfy Cloud redirected /view to a non-https location (${target.protocol}//${target.host})`);
  }
  return target;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

export function createComfyGenerator(config: ComfyConfig, deps: { feed?: ProgressFeed } = {}): Generator {
  const feed = deps.feed ?? createProgressFeed({ url: config.url, apiKey: config.apiKey, isCloud: isCloud(config) });
  /** Remote prompt_id and declared result per job id, filled in by submit. */
  const session: Session = { runs: new Map<string, Run>(), feed };

  return {
    submit: (request) => submitRun(config, session, request),
    poll: (job) => pollRun(config, session, job),
  };
}

let cached: Generator | undefined;

/** One generator per process, so a submitted run's remote id is still there when polling. */
export function comfyGeneratorFromEnv(): Generator | undefined {
  const config = comfyConfigFromEnv();
  if (!config) {
    return undefined;
  }
  cached ??= createComfyGenerator(config);
  return cached;
}
