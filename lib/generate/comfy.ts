import type { GenerateRequest, Job } from "../types";
import type { WorkflowOutput } from "./pipeline";
import { createJob, fail, finish, type Generator } from "./store";
import { graphFor } from "./workflows";

/**
 * The ComfyUI adapter: POST /prompt starts a run and answers with a prompt_id, GET /history/:id
 * answers with the outputs once it is done, /view serves the file. The graph for each request
 * comes from lib/generate/workflows, so this file only speaks HTTP and maps outputs.
 */

type ComfyConfig = { url: string; apiKey: string };

/** A submit can wait on a cold deployment; one poll is a single HTTP round trip. */
const SUBMIT_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 30_000;

type ComfyFile = { filename: string; subfolder?: string; type?: string };

/** What a submitted run declared, kept until the history answers with a file. */
type Run = {
  promptId: string;
  output: WorkflowOutput;
  width: number;
  height: number;
};

/**
 * The output key each kind reads. Native `SaveVideo` writes `videos`; VideoHelperSuite's
 * `VHS_VideoCombine` writes `gifs`; reading both keeps one deployment's node choice invisible
 * to the job route.
 */
const OUTPUT_KEYS: Record<WorkflowOutput, readonly string[]> = {
  image: ["images"],
  video: ["videos", "gifs"],
  audio: ["audio"],
};

/** The route reads this: no URL, no key, demo mode. */
export function comfyConfigFromEnv(): ComfyConfig | undefined {
  const url = process.env.COMFY_URL;
  if (!url) {
    return undefined;
  }
  return { url: url.replace(/\/+$/, ""), apiKey: process.env.COMFY_API_KEY ?? "" };
}

function headers(config: ComfyConfig): Record<string, string> {
  const result: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) {
    result.authorization = `Bearer ${config.apiKey}`;
  }
  return result;
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
    `Comfy could not be reached at ${config.url} while submitting the ${workflowLabel(request)} workflow`,
    { cause },
  );
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
      for (const key of OUTPUT_KEYS[kind]) {
        const value = output[key];
        const candidate = Array.isArray(value) ? value[0] : value;
        if (isComfyFile(candidate)) {
          return candidate;
        }
      }
    }
  }

  return undefined;
}

export function createComfyGenerator(config: ComfyConfig): Generator {
  /** Remote prompt_id and declared result per job id, filled in by submit. */
  const runs = new Map<string, Run>();

  return {
    async submit(request: GenerateRequest): Promise<Job> {
      // A mode or model without a graph throws here, before a job exists, which the route turns
      // into a 502 whose message names the missing graph.
      const graph = graphFor(request);
      const job = createJob(request, false);
      runs.set(job.id, {
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
          body: JSON.stringify({ prompt: graph.nodes, client_id: job.id }),
          signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
        });
      } catch (cause) {
        runs.delete(job.id);
        throw unreachable(config, request, cause);
      }

      if (!response.ok) {
        return fail(job, `Comfy refused the run: HTTP ${response.status}`);
      }

      const body = (await response.json()) as { prompt_id?: unknown };
      if (typeof body.prompt_id !== "string") {
        return fail(job, "Comfy answered without a prompt_id");
      }

      const run = runs.get(job.id);
      if (run) {
        run.promptId = body.prompt_id;
      }
      job.status = "running";
      return job;
    },

    async poll(job: Job): Promise<Job> {
      const run = runs.get(job.id);
      if (!run || run.promptId === "") {
        return job;
      }

      let response: Response;
      try {
        response = await fetch(`${config.url}/history/${run.promptId}`, {
          headers: headers(config),
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });
      } catch {
        // A restart or network blip is expected while a long render runs; the job stays running
        // and the next poll asks again instead of failing a run the deployment may still finish.
        return job;
      }
      if (!response.ok) {
        return job;
      }

      const output = readOutput(await response.json(), run.output);
      if (!output) {
        return job;
      }

      const params = new URLSearchParams({
        filename: output.filename,
        subfolder: output.subfolder ?? "",
        type: output.type ?? "output",
      });
      return finish(job, {
        url: `${config.url}/view?${params.toString()}`,
        kind: run.output,
        width: run.width,
        height: run.height,
      });
    },
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
