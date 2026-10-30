/**
 * Library and file storage contract: the asset library (assets, folders, tags) and imported
 * files live in the chats' SQLite file, behind GET /api/library, PUT/DELETE
 * /api/library/:kind/:id and GET/PUT/DELETE /api/files/:id. Each test names its own file with
 * KINEMI_DB, so nothing touches the owner's ~/.kinemi.
 */
import assert from "node:assert/strict";
import { request } from "node:http";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { scratchPath, startServer } from "./lib/server.mjs";

const servers = [];
after(() => servers.forEach((s) => s.stop()));

async function serve(env) {
  const server = await startServer({ env });
  servers.push(server);
  return server;
}

const json = { "content-type": "application/json" };
const putItem = (base, kind, id, body) =>
  fetch(`${base}/api/library/${kind}/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: json,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const deleteItem = (base, kind, id) => fetch(`${base}/api/library/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" });
const putFile = (base, id, bytes) => fetch(`${base}/api/files/${encodeURIComponent(id)}`, { method: "PUT", body: bytes });

const library = async (base) => {
  const response = await fetch(`${base}/api/library`);
  assert.equal(response.status, 200);
  return response.json();
};

/** A file whose first bytes are `head`, padded to `size`. */
const bytesOf = (head, size = head.length) => {
  const out = new Uint8Array(size);
  out.set(head);
  return out;
};
const ascii = (text) => [...text].map((c) => c.charCodeAt(0));

const SAMPLES = {
  "image/png": bytesOf([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a], 32),
  "image/jpeg": bytesOf([0xff, 0xd8, 0xff, 0xe0], 32),
  "image/gif": bytesOf(ascii("GIF89a"), 32),
  "image/webp": bytesOf([...ascii("RIFF"), 1, 0, 0, 0, ...ascii("WEBPVP8 ")], 32),
  "audio/wav": bytesOf([...ascii("RIFF"), 1, 0, 0, 0, ...ascii("WAVEfmt ")], 32),
  "video/mp4": bytesOf([0, 0, 0, 0x18, ...ascii("ftypmp42")], 32),
  "video/webm": bytesOf([0x1a, 0x45, 0xdf, 0xa3, 0x9f], 32),
  "audio/ogg": bytesOf(ascii("OggS"), 32),
  "audio/mpeg": bytesOf(ascii("ID3"), 32),
  "application/octet-stream": bytesOf(ascii("just some text"), 32),
};

/** GET with a Host header fetch won't let us set. */
function getWithHost(base, path, host) {
  const url = new URL(`${base}${path}`);
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path: url.pathname, headers: { host } }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body || "{}") }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("each kind is saved, listed, replaced and deleted", async () => {
  const { base } = await serve({ KINEMI_DB: scratchPath("lib-crud.sqlite") });
  assert.deepEqual(await library(base), { assets: [], folders: [], tags: [] });

  const asset = { id: "as-1", name: "Neon alley", fileId: "f-1", tags: ["tg-1"], folderId: "fo-1", extra: { deep: [1, 2] } };
  const folder = { id: "fo-1", name: "Day one" };
  const tag = { id: "tg-1", name: "night", color: "#e11d33" };
  assert.equal((await putItem(base, "asset", "as-1", asset)).status, 200);
  assert.equal((await putItem(base, "folder", "fo-1", folder)).status, 200);
  assert.equal((await putItem(base, "tag", "tg-1", tag)).status, 200);
  assert.deepEqual(await library(base), { assets: [asset], folders: [folder], tags: [tag] }, "each comes back exactly as saved, in its own list");

  const renamed = { ...asset, name: "Renamed" };
  assert.equal((await putItem(base, "asset", "as-1", renamed)).status, 200);
  assert.deepEqual((await library(base)).assets, [renamed], "a second PUT replaces, it does not add");

  // The same id under another kind is another item.
  assert.equal((await putItem(base, "tag", "as-1", { id: "as-1", name: "same id" })).status, 200);
  assert.equal((await library(base)).tags.length, 2);

  for (const [kind, id] of [["asset", "as-1"], ["folder", "fo-1"], ["tag", "tg-1"], ["tag", "as-1"]]) {
    assert.equal((await deleteItem(base, kind, id)).status, 204, `${kind}/${id}`);
  }
  assert.deepEqual(await library(base), { assets: [], folders: [], tags: [] });
  assert.equal((await deleteItem(base, "asset", "as-1")).status, 204, "deleting twice still succeeds");
});

test("a bad kind, id or body is refused with 400, an oversized item with 413", async () => {
  const { base } = await serve({ KINEMI_DB: scratchPath("lib-bad.sqlite") });
  const cases = [
    ["album", "a-1", { id: "a-1" }],
    ["asset", "bad id!", { id: "x" }],
    ["asset", "x".repeat(81), { id: "x" }],
    ["asset", "a-1", "{not json"],
    ["asset", "a-1", "[1, 2]"],
    ["asset", "a-1", "null"],
    ["asset", "a-1", '"text"'],
  ];
  for (const [kind, id, body] of cases) {
    const response = await putItem(base, kind, id, body);
    assert.equal(response.status, 400, `${kind} ${id.slice(0, 20)} ${JSON.stringify(body).slice(0, 40)}`);
    assert.match((await response.json()).error, /\w/);
  }
  assert.equal((await deleteItem(base, "album", "a-1")).status, 400);
  assert.equal((await deleteItem(base, "asset", "bad id!")).status, 400);

  const huge = await putItem(base, "asset", "a-huge", { id: "a-huge", blob: "x".repeat(4 * 1024 * 1024) });
  assert.equal(huge.status, 413);
  assert.deepEqual(await library(base), { assets: [], folders: [], tags: [] }, "nothing refused was stored");
});

test("a file comes back byte for byte with the type read from its bytes", async () => {
  const { base } = await serve({ KINEMI_DB: scratchPath("files-crud.sqlite") });
  for (const [type, bytes] of Object.entries(SAMPLES)) {
    const id = `f-${type.replace(/\W/g, "-")}`;
    const saved = await putFile(base, id, bytes);
    assert.equal(saved.status, 200, type);
    assert.deepEqual(await saved.json(), { ok: true, type, size: bytes.length });

    const got = await fetch(`${base}/api/files/${id}`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get("content-type"), type);
    assert.equal(got.headers.get("content-length"), String(bytes.length));
    assert.deepEqual(new Uint8Array(await got.arrayBuffer()), bytes, type);
  }

  const replaced = await putFile(base, "f-image-png", SAMPLES["image/gif"]);
  assert.equal((await replaced.json()).type, "image/gif", "a second PUT replaces the file and its type");
  assert.equal((await fetch(`${base}/api/files/f-image-png`)).headers.get("content-type"), "image/gif");

  assert.equal((await fetch(`${base}/api/files/f-image-png`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${base}/api/files/f-image-png`)).status, 404);
  assert.equal((await fetch(`${base}/api/files/f-image-png`, { method: "DELETE" })).status, 204, "deleting twice still succeeds");
});

test("a missing file is 404, a bad id 400, a file over 50 MB 413 and not stored", async () => {
  const { base } = await serve({ KINEMI_DB: scratchPath("files-bad.sqlite") });
  const missing = await fetch(`${base}/api/files/nope`);
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /\w/);

  assert.equal((await fetch(`${base}/api/files/bad%20id!`)).status, 400);
  assert.equal((await putFile(base, "bad id!", SAMPLES["image/png"])).status, 400);
  assert.equal((await fetch(`${base}/api/files/bad%20id!`, { method: "DELETE" })).status, 400);

  const exact = bytesOf(SAMPLES["image/png"], 50 * 1024 * 1024);
  assert.equal((await putFile(base, "f-exact", exact)).status, 200, "exactly 50 MB is allowed");
  const over = bytesOf(SAMPLES["image/png"], 50 * 1024 * 1024 + 1);
  const refused = await putFile(base, "f-big", over);
  assert.equal(refused.status, 413);
  assert.match((await refused.json()).error, /50 MB/);
  assert.equal((await fetch(`${base}/api/files/f-big`)).status, 404, "nothing refused was stored");
});

test("a v1 database file migrates to v2 and keeps its chats", async () => {
  const file = scratchPath("v1.sqlite");
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, messages TEXT NOT NULL)`);
  const message = { id: "m1", role: "user", text: "kept", at: 1_700_000_000_000 };
  old
    .prepare("INSERT INTO chats (id, title, created_at, updated_at, messages) VALUES (?, ?, ?, ?, ?)")
    .run("ch-old", "From v1", 1_700_000_000_000, 1_700_000_100_000, JSON.stringify([message]));
  old.exec("PRAGMA user_version = 1");
  old.close();

  const { base, stop } = await serve({ KINEMI_DB: file });
  const chats = (await (await fetch(`${base}/api/chats`)).json()).chats;
  assert.deepEqual(chats.map((c) => [c.id, c.title, c.messages]), [["ch-old", "From v1", [message]]]);

  assert.deepEqual(await library(base), { assets: [], folders: [], tags: [] });
  assert.equal((await putItem(base, "tag", "tg-1", { id: "tg-1" })).status, 200);
  assert.equal((await putFile(base, "f-1", SAMPLES["image/png"])).status, 200);
  stop();

  const migrated = new DatabaseSync(file, { readOnly: true });
  assert.equal(migrated.prepare("PRAGMA user_version").get().user_version, 2);
  migrated.close();
});

test("a fresh database file starts at v2 with all three tables", async () => {
  const file = scratchPath("fresh.sqlite");
  const { base, stop } = await serve({ KINEMI_DB: file });
  await library(base);
  stop();

  const fresh = new DatabaseSync(file, { readOnly: true });
  assert.equal(fresh.prepare("PRAGMA user_version").get().user_version, 2);
  const tables = fresh.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((t) => t.name);
  fresh.close();
  assert.deepEqual(tables, ["chats", "files", "library"]);
});

test("library items and files survive a server restart", async () => {
  const file = scratchPath("lib-restart.sqlite");
  const first = await serve({ KINEMI_DB: file });
  const asset = { id: "as-keep", name: "Keep me", fileId: "f-keep" };
  assert.equal((await putItem(first.base, "asset", "as-keep", asset)).status, 200);
  assert.equal((await putFile(first.base, "f-keep", SAMPLES["video/mp4"])).status, 200);
  first.stop();

  const second = await serve({ KINEMI_DB: file });
  assert.deepEqual((await library(second.base)).assets, [asset]);
  const got = await fetch(`${second.base}/api/files/f-keep`);
  assert.equal(got.headers.get("content-type"), "video/mp4");
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), SAMPLES["video/mp4"]);
});

test("without KINEMI_DB a request from another host is refused with 503 naming KINEMI_DB", async () => {
  const { base } = await serve({ KINEMI_DB: "" });
  for (const path of ["/api/library", "/api/files/f-1"]) {
    const remote = await getWithHost(base, path, "kinemi.example.com");
    assert.equal(remote.status, 503, path);
    assert.match(remote.body.error, /KINEMI_DB/);
  }
});
