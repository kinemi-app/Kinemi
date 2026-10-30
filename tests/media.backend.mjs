/**
 * web/src/app/lib/media.ts: Download saves a server render under the extension its file really has,
 * whether the server answered with a data: URL (demo), a ComfyUI /view?filename= link or a plain path.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { serverExtension } from "../web/src/app/lib/media.ts";

const BASE = "http://localhost:3000/app/assets/";

test("a data: URL names its own type", () => {
  assert.equal(serverExtension("data:image/svg+xml;charset=utf-8,%3Csvg%3E", "image", BASE), "svg");
  assert.equal(serverExtension("data:audio/wav;base64,UklGRg==", "audio", BASE), "wav");
});

test("a ComfyUI /view link takes the extension of its filename, not of /view", () => {
  const url = "http://comfy.example:8188/view?filename=kinemi_00001_.mp4&subfolder=&type=output";
  assert.equal(serverExtension(url, "video", BASE), "mp4");
});

test("a plain path keeps its extension, relative or absolute", () => {
  assert.equal(serverExtension("/api/assets/take-1.webm", "video", BASE), "webm");
  assert.equal(serverExtension("https://cdn.example/a/b/still.jpg?sig=1", "image", BASE), "jpg");
});

test("no readable extension falls back to the media kind, and to png without one", () => {
  assert.equal(serverExtension("http://comfy.example/view?type=output", "video", BASE), "mp4");
  assert.equal(serverExtension("http://comfy.example/view?type=output", "audio", BASE), "wav");
  assert.equal(serverExtension("http://comfy.example/view", undefined, BASE), "png");
});
