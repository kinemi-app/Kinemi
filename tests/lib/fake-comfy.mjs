/**
 * A stub ComfyUI deployment for the backend contract suites. It records every /prompt graph and
 * every upload, answers /history with the file the graph's Save node declares (SaveImage writes
 * `images`, SaveVideo writes `videos` and `gifs`, SaveAudio writes `audio`), and serves that file
 * back from /view so a run's result can be imported the way a real one is.
 *
 * No GPU or live deployment is involved; this proves the adapter sends the right graph and maps
 * the right output kind, not that a model rendered anything.
 */
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

/** The smallest valid PNG: enough for the asset route's byte sniffing. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
  "base64",
);

/** A real WebM, served for a video result so its bytes sniff as a video and not as the PNG. */
const WEBM = readFileSync(new URL("../fixtures/edit-source.webm", import.meta.url));

function respondJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** What /view serves for a filename: video for a clip, HTML to test the proxy's type guard, else PNG. */
function viewFile(filename) {
  if (/\.(mp4|webm)$/i.test(filename)) {
    return { type: "video/webm", body: WEBM };
  }
  if (/\.html$/i.test(filename)) {
    return { type: "text/html", body: Buffer.from("<script>document.title = 'owned'</script>") };
  }
  return { type: "image/png", body: PNG };
}

/** Serve one file, honouring a single `bytes=start-end` range the way ComfyUI's aiohttp does. */
function serveFile(filename, rangeHeader, response) {
  const { type, body } = viewFile(filename);
  const range = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader ?? "");
  if (!range) {
    response.writeHead(200, { "content-type": type, "content-length": String(body.length) });
    response.end(body);
    return;
  }
  const start = Number(range[1]);
  const end = range[2] === "" ? body.length - 1 : Math.min(Number(range[2]), body.length - 1);
  const part = body.subarray(start, end + 1);
  response.writeHead(206, {
    "content-type": type,
    "content-length": String(part.length),
    "content-range": `bytes ${start}-${end}/${body.length}`,
  });
  response.end(part);
}

function outputFor(classType, promptId, nodeId) {
  if (classType === "SaveImage") {
    return { images: [{ filename: `${promptId}-${nodeId}.png`, subfolder: "", type: "output" }] };
  }
  if (classType === "SaveVideo") {
    const file = { filename: `${promptId}-${nodeId}.mp4`, subfolder: "", type: "output" };
    return { videos: [file], gifs: [file] };
  }
  if (classType === "SaveAudio") {
    return { audio: [{ filename: `${promptId}-${nodeId}.wav`, subfolder: "", type: "output" }] };
  }
  return undefined;
}

/**
 * The generator's progress feed opens a real WebSocket to whatever URL the config names. The stubs
 * have no socket, so the handshake is refused with 404 and kept out of `requests`, which stay the
 * REST calls (a WebSocket handshake carries no Authorization header to assert on).
 */
function refuseSocket(pathname, response) {
  if (pathname !== "/ws") {
    return false;
  }
  response.writeHead(404);
  response.end();
  return true;
}

/** A run the Cloud stub says executed for 42.5 s, in epoch milliseconds. */
const DEFAULT_EXECUTION_TIMES = { start: 1_700_000_000_000, end: 1_700_000_042_500 };

/** Where the cloud stub's /api/view redirects: a "signed" storage link that must arrive keyless. */
const STORAGE_PATH = "/storage/";
const STORAGE_SIGNATURE = "sig=stub-signed";
/** A storage request carrying this query parameter answers 302 to its value, so links can chain. */
const STORAGE_NEXT_PARAM = "next";

/** The stills a Cloud output may list beside a clip: one with no MIME type, one marked image/png. */
function previewStills(promptId, nodeId) {
  const still = { filename: `${promptId}-${nodeId}-preview.png`, subfolder: "", type: "output" };
  return [still, { ...still, mime_type: "image/png" }];
}

/**
 * The outputs Comfy Cloud reports for a graph: like ComfyUI's, but a clip is listed under `images`
 * with a `video/mp4` MIME type, as a real Cloud run's /api/jobs/:id answered on 2026-10-30.
 * `previewFrame` "before-clip" lists two stills ahead of the clip; "instead-of-clip" lists only them.
 */
function cloudOutputs(graph, promptId, previewFrame) {
  const outputs = {};
  for (const [nodeId, node] of Object.entries(graph ?? {})) {
    const output = outputFor(node.class_type, promptId, nodeId);
    if (output?.videos) {
      const clips = output.videos.map((file) => ({ ...file, mime_type: "video/mp4" }));
      const stills = previewFrame ? previewStills(promptId, nodeId) : [];
      outputs[nodeId] = { images: previewFrame === "instead-of-clip" ? stills : [...stills, ...clips] };
    } else if (output !== undefined) {
      outputs[nodeId] = output;
    }
  }
  return outputs;
}

/**
 * Comfy Cloud's API, as docs.comfy.org/development/cloud/api-reference describes it: every call
 * under /api carries `X-API-Key`, a run is followed on /api/job/:id/status and read from
 * /api/jobs/:id, and /api/view answers 302 to a signed storage link that refuses the key.
 */
function handleCloud(state, request, response, body) {
  const { pathname } = new URL(request.url, "http://stub");
  if (refuseSocket(pathname, response)) {
    return;
  }
  state.requests.push({ method: request.method, path: request.url, headers: { ...request.headers } });

  if (pathname.startsWith(STORAGE_PATH)) {
    state.storage.push({ path: request.url, hasKey: request.headers["x-api-key"] !== undefined });
    if (request.headers["x-api-key"] !== undefined || !request.url.includes(STORAGE_SIGNATURE)) {
      response.writeHead(400);
      response.end();
      return;
    }
    const next = new URL(request.url, "http://stub").searchParams.get(STORAGE_NEXT_PARAM);
    if (next !== null) {
      response.writeHead(302, { location: next });
      response.end();
      return;
    }
    const filename = decodeURIComponent(pathname.slice(STORAGE_PATH.length));
    serveFile(filename, request.headers.range, response);
    return;
  }

  if (request.headers["x-api-key"] !== state.apiKey) {
    respondJson(response, 401, { error: "missing or wrong X-API-Key" });
    return;
  }

  if (request.method === "POST" && pathname === "/api/prompt") {
    if (state.insufficientCredits) {
      respondJson(response, 402, { error: { type: "InsufficientFundsError", message: "Account balance too low" } });
      return;
    }
    const id = `c${state.prompts.length + 1}`;
    const submitted = JSON.parse(body.toString());
    state.prompts.push({ id, graph: submitted.prompt, clientId: submitted.client_id });
    respondJson(response, 200, { prompt_id: id });
    return;
  }

  const status = /^\/api\/job\/([^/]+)\/status$/.exec(pathname);
  if (request.method === "GET" && status) {
    const id = decodeURIComponent(status[1]);
    const asked = (state.statusPolls.get(id) ?? 0) + 1;
    state.statusPolls.set(id, asked);
    if (asked < state.pollsUntilDone) {
      respondJson(response, 200, { id, status: "in_progress" });
      return;
    }
    const failure = state.failWith;
    respondJson(response, 200, failure ? { id, status: failure.status, error_message: failure.message } : { id, status: "success" });
    return;
  }

  const detail = /^\/api\/jobs\/([^/]+)$/.exec(pathname);
  if (request.method === "GET" && detail) {
    const id = decodeURIComponent(detail[1]);
    const entry = state.prompts.find((prompt) => prompt.id === id);
    const times = state.executionTimes
      ? { execution_start_time: state.executionTimes.start, execution_end_time: state.executionTimes.end }
      : {};
    respondJson(response, 200, { id, status: "completed", ...times, outputs: cloudOutputs(entry?.graph, id, state.previewFrame) });
    return;
  }

  if (request.method === "GET" && pathname === "/api/view") {
    state.views.push(request.url);
    const filename = new URL(request.url, "http://stub").searchParams.get("filename") ?? "";
    const origin = `http://${request.headers.host}`;
    const ownStorage = `${origin}${STORAGE_PATH}${encodeURIComponent(filename)}?${STORAGE_SIGNATURE}`;
    response.writeHead(302, { location: state.viewLocation ?? ownStorage });
    response.end();
    return;
  }

  if (request.method === "POST" && pathname === "/api/upload/image") {
    state.uploads.push({ name: `upload-${state.uploads.length + 1}.bin`, bytes: body.length });
    respondJson(response, 200, { name: state.uploads.at(-1).name, subfolder: "", type: "input" });
    return;
  }

  response.writeHead(404);
  response.end();
}

/**
 * Comfy Cloud's stub: the returned `url` ends in /api, the way COMFY_URL names Cloud. Options:
 * `insufficientCredits` answers every submit with 402; `pollsUntilDone` is the status poll that
 * first reports the end; `failWith: { status, message }` ends the run in that state instead;
 * `viewLocation` is the Location every /view 302 carries, instead of the stub's own signed storage;
 * `previewFrame` lists still frames beside a clip (see cloudOutputs); `executionTimes: { start, end }`
 * (epoch ms) is the execution_start_time and execution_end_time /api/jobs/:id answers, and `null`
 * leaves both out, as an older run's detail may.
 */
async function startCloud({
  apiKey,
  insufficientCredits = false,
  pollsUntilDone = 1,
  failWith,
  viewLocation,
  previewFrame,
  executionTimes = DEFAULT_EXECUTION_TIMES,
}) {
  const state = {
    apiKey,
    insufficientCredits,
    pollsUntilDone,
    failWith,
    viewLocation,
    previewFrame,
    executionTimes,
    prompts: [],
    uploads: [],
    views: [],
    /** Every request with its headers, so a test can see which auth header was sent where. */
    requests: [],
    /** Every request that reached the signed storage link, and whether it carried the key. */
    storage: [],
    statusPolls: new Map(),
  };
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => handleCloud(state, request, response, Buffer.concat(chunks)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/api`,
    prompts: state.prompts,
    uploads: state.uploads,
    views: state.views,
    requests: state.requests,
    storage: state.storage,
    statusPolls: state.statusPolls,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

/**
 * Start a stub ComfyUI server on a spare port. With `apiKey` it behaves like a keyed deployment:
 * every request without `Authorization: Bearer <apiKey>` gets a 401. With `cloud: true` it speaks
 * Comfy Cloud's API instead (see startCloud), and every request is recorded with its headers.
 */
export async function startComfy({ apiKey, cloud = false, ...cloudOptions } = {}) {
  if (cloud) {
    return startCloud({ apiKey, ...cloudOptions });
  }
  const prompts = [];
  const uploads = [];
  /** The path and query of every /view request that got through, as the stub received it. */
  const views = [];
  /** Every request with its headers, so a test can see which auth header was sent where. */
  const requests = [];
  let uploadCount = 0;

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      if (refuseSocket(new URL(request.url, "http://stub").pathname, response)) {
        return;
      }
      requests.push({ method: request.method, path: request.url, headers: { ...request.headers } });

      if (apiKey && request.headers.authorization !== `Bearer ${apiKey}`) {
        response.writeHead(401);
        response.end();
        return;
      }

      if (request.method === "POST" && request.url === "/prompt") {
        const parsed = JSON.parse(body.toString());
        const id = `p${prompts.length + 1}`;
        prompts.push({ id, graph: parsed.prompt, clientId: parsed.client_id });
        respondJson(response, 200, { prompt_id: id });
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/history/")) {
        const id = decodeURIComponent(request.url.slice("/history/".length));
        const entry = prompts.find((prompt) => prompt.id === id);
        const outputs = {};
        for (const [nodeId, node] of Object.entries(entry?.graph ?? {})) {
          const output = outputFor(node.class_type, id, nodeId);
          if (output !== undefined) {
            outputs[nodeId] = output;
          }
        }
        respondJson(response, 200, { [id]: { outputs } });
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/view?")) {
        views.push(request.url);
        const filename = new URL(request.url, "http://stub").searchParams.get("filename") ?? "";
        serveFile(filename, request.headers.range, response);
        return;
      }

      if (request.method === "POST" && request.url?.startsWith("/upload/")) {
        uploadCount += 1;
        const name = `upload-${uploadCount}.bin`;
        uploads.push({ name, bytes: body.length });
        respondJson(response, 200, { name, subfolder: "", type: "input" });
        return;
      }

      response.writeHead(404);
      response.end();
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}`,
    prompts,
    uploads,
    views,
    requests,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
