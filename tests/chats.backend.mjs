/**
 * Chat storage contract: the studio's chats live in a SQLite file on this computer, behind
 * GET /api/chats, PUT /api/chats/:id and DELETE /api/chats/:id. Each test names its own file
 * with KINEMI_DB, so nothing touches the owner's ~/.kinemi.
 */
import assert from "node:assert/strict";
import { request } from "node:http";
import { after, test } from "node:test";

import { scratchPath, startServer } from "./lib/server.mjs";

const servers = [];
after(() => servers.forEach((s) => s.stop()));

async function serve(env) {
  const server = await startServer({ env });
  servers.push(server);
  return server;
}

const chat = (id, title, updatedAt, messages = []) => ({ id, title, createdAt: 1_700_000_000_000, updatedAt, messages });
const message = (id, role = "user") => ({ id, role, text: `text of ${id}`, at: 1_700_000_000_000, chips: ["Open Cinematic"] });

const put = (base, id, body) =>
  fetch(`${base}/api/chats/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const list = async (base) => {
  const response = await fetch(`${base}/api/chats`);
  assert.equal(response.status, 200);
  return (await response.json()).chats;
};

/** GET with a Host header fetch won't let us set. */
function getWithHost(base, host) {
  const url = new URL(`${base}/api/chats`);
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

test("chats are created, listed newest first, replaced and deleted", async () => {
  const { base } = await serve({ KINEMI_DB: scratchPath("crud.sqlite") });
  assert.deepEqual(await list(base), []);

  assert.equal((await put(base, "ch-old", chat("ch-old", "Old one", 1_700_000_100_000))).status, 200);
  const full = chat("ch-new", "Neon alley", 1_700_000_200_000, [message("m1"), message("m2", "assistant")]);
  assert.equal((await put(base, "ch-new", full)).status, 200);

  const both = await list(base);
  assert.deepEqual(both.map((c) => c.id), ["ch-new", "ch-old"]);
  assert.deepEqual(both[0], full, "a chat comes back exactly as it was saved, extra message fields included");

  assert.equal((await put(base, "ch-old", chat("ch-old", "  Renamed  ", 1_700_000_300_000))).status, 200);
  const renamed = await list(base);
  assert.equal(renamed.length, 2);
  assert.equal(renamed[0].id, "ch-old");
  assert.equal(renamed[0].title, "Renamed");

  const gone = await fetch(`${base}/api/chats/ch-old`, { method: "DELETE" });
  assert.equal(gone.status, 204);
  assert.deepEqual((await list(base)).map((c) => c.id), ["ch-new"]);
  assert.equal((await fetch(`${base}/api/chats/ch-old`, { method: "DELETE" })).status, 204, "deleting twice still succeeds");
});

test("chats survive a server restart", async () => {
  const file = scratchPath("restart.sqlite");
  const first = await serve({ KINEMI_DB: file });
  assert.equal((await put(first.base, "ch-keep", chat("ch-keep", "Keep me", 1_700_000_400_000, [message("m1")]))).status, 200);
  first.stop();

  const second = await serve({ KINEMI_DB: file });
  const chats = await list(second.base);
  assert.deepEqual(chats.map((c) => [c.id, c.title, c.messages.length]), [["ch-keep", "Keep me", 1]]);
});

test("bad ids and bodies are refused with 400, an oversized one with 413", async () => {
  const { base } = await serve({ KINEMI_DB: scratchPath("bad.sqlite") });
  const cases = [
    ["bad id!", chat("bad id!", "x", 1)],
    ["ch-a", chat("ch-b", "id mismatch", 1)],
    ["ch-a", chat("ch-a", "", 1)],
    ["ch-a", chat("ch-a", "x".repeat(301), 1)],
    ["ch-a", { ...chat("ch-a", "no messages", 1), messages: "nope" }],
    ["ch-a", chat("ch-a", "bad role", 1, [{ ...message("m1"), role: "system" }])],
    ["ch-a", chat("ch-a", "no time", 1, [{ ...message("m1"), at: "yesterday" }])],
    ["ch-a", { ...chat("ch-a", "bad time", 1), updatedAt: -5 }],
    ["ch-a", "{not json"],
  ];
  for (const [id, body] of cases) {
    const response = await put(base, id, body);
    assert.equal(response.status, 400, `${id} ${JSON.stringify(body).slice(0, 80)}`);
    assert.match((await response.json()).error, /\w/);
  }
  assert.equal((await fetch(`${base}/api/chats/bad%20id!`, { method: "DELETE" })).status, 400);

  const huge = chat("ch-huge", "Huge", 1, [{ ...message("m1"), text: "x".repeat(4 * 1024 * 1024) }]);
  assert.equal((await put(base, "ch-huge", huge)).status, 413);
  assert.deepEqual(await list(base), [], "nothing refused was stored");
});

test("without KINEMI_DB a request from another host is refused with 503 naming KINEMI_DB", async () => {
  const { base } = await serve({ KINEMI_DB: "" });
  const remote = await getWithHost(base, "kinemi.example.com");
  assert.equal(remote.status, 503);
  assert.match(remote.body.error, /KINEMI_DB/);
});
