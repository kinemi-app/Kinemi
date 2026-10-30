/**
 * B5 contract: only a file on the configured ComfyUI origin can be imported, its bytes decide the
 * kind, and an imported clip travels into the next graph as `videoName`. A local stub stands in
 * for ComfyUI's /view and /upload nodes.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, before, test } from "node:test";

import { startServer } from "./lib/server.mjs";

/** A 1x1 PNG, enough for the byte sniffing. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
  "base64",
);
const WEBM = readFileSync("tests/fixtures/edit-source.webm");

const API_KEY = "stub-key";

/** The outputs the stub's /view serves, by filename, the way ComfyUI hands out results. */
const OUTPUTS = {
  "media.png": { contentType: "image/png", body: PNG },
  "media.webm": { contentType: "video/webm", body: WEBM },
  "notes.txt": { contentType: "text/plain", body: "this is not a media file" },
};

let app;
let comfy;
let BASE = "";

function respondJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** The URL a finished run hands out for one output on the stub. */
function viewUrl(filename) {
  return `${comfy.url}/view?${new URLSearchParams({ filename, subfolder: "", type: "output" })}`;
}

/**
 * A ComfyUI stub keyed like a cloud deployment: every request without the Bearer key gets a 401.
 * /view serves the outputs above and /upload/image accepts an upload.
 */
async function startMediaComfy() {
  let uploads = 0;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://stub");
      if (request.headers.authorization !== `Bearer ${API_KEY}`) {
        respondJson(response, 401, { error: "missing or wrong key" });
        return;
      }
      const output = OUTPUTS[url.searchParams.get("filename") ?? ""];
      if (request.method === "GET" && url.pathname === "/view" && output) {
        response.writeHead(200, { "content-type": output.contentType });
        response.end(output.body);
        return;
      }
      if (request.method === "POST" && url.pathname === "/upload/image") {
        uploads += 1;
        respondJson(response, 200, {
          name: `remote-${uploads}.bin`,
          subfolder: "",
          type: "input",
        });
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
    uploadCount: () => uploads,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

async function postJson(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

before(async () => {
  comfy = await startMediaComfy();
  app = await startServer({ comfyUrl: comfy.url, env: { COMFY_API_KEY: API_KEY } });
  BASE = app.base;
});

after(async () => {
  app?.stop();
  await comfy?.stop();
});

test("a URL on another origin is refused", async () => {
  const { response, body } = await postJson("/api/assets/from-url", {
    url: "http://127.0.0.1:9/elsewhere.png",
  });
  assert.equal(response.status, 400);
  assert.match(body.error, /ComfyUI origin/);
});

test("a malformed URL is refused", async () => {
  const { response } = await postJson("/api/assets/from-url", { url: "not a url" });
  assert.equal(response.status, 400);
  assert.equal(comfy.uploadCount(), 0, "nothing should reach the deployment");
});

test("a ComfyUI image is sniffed, uploaded and named", async () => {
  const { response, body } = await postJson("/api/assets/from-url", {
    url: viewUrl("media.png"),
  });

  assert.equal(response.status, 200, body.error);
  assert.equal(body.kind, "image");
  assert.match(body.name, /^remote-\d+\.bin$/);
  assert.equal(comfy.uploadCount(), 1, "the imported bytes should reach /upload/image");
});

test("a response that is not media is refused with 415", async () => {
  const { response } = await postJson("/api/assets/from-url", {
    url: viewUrl("notes.txt"),
  });
  assert.equal(response.status, 415);
});

test("a refused download answers 502", async () => {
  const { response } = await postJson("/api/assets/from-url", {
    url: viewUrl("missing.png"),
  });
  assert.equal(response.status, 502);
});

test("an imported clip reaches the next graph as videoName", async () => {
  const imported = await postJson("/api/assets/from-url", {
    url: viewUrl("media.webm"),
  });
  assert.equal(imported.response.status, 200, imported.body.error);
  assert.equal(imported.body.kind, "video");

  const request = {
    mode: "genjutsu",
    modelId: "wan22-i2v",
    prompt: "transfer the motion onto the character",
    durationS: 1,
    params: {
      videoName: imported.body.name,
      source: "canvas",
      upstream: "Opening shot",
    },
  };
  const preview = await postJson("/api/generate/graph", request);
  assert.equal(preview.response.status, 200);

  const loadVideo = Object.values(preview.body.graph.nodes).find(
    (node) => node.class_type === "LoadVideo",
  );
  assert.equal(
    loadVideo?.inputs.file,
    imported.body.name,
    "the imported asset name must be what the graph loads",
  );
});
