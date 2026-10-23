/**
 * A stub ComfyUI deployment for the backend contract suites. It records every /prompt graph and
 * every upload, and answers /history with the file the graph's Save node declares: SaveImage
 * writes `images`, SaveVideo writes `videos` and `gifs`, SaveAudio writes `audio`.
 *
 * No GPU or live deployment is involved; this proves the adapter sends the right graph and maps
 * the right output kind, not that a model rendered anything.
 */
import { once } from "node:events";
import { createServer } from "node:http";

function respondJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
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

/** Start a stub ComfyUI server on a spare port. */
export async function startComfy() {
  const prompts = [];
  const uploads = [];
  let uploadCount = 0;

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);

      if (request.method === "POST" && request.url === "/prompt") {
        const parsed = JSON.parse(body.toString());
        const id = `p${prompts.length + 1}`;
        prompts.push({ id, graph: parsed.prompt });
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
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
