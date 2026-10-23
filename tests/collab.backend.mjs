/**
 * N3 canvas rooms: GET /api/collab/:room streams presence and the board patch log, POST publishes
 * one patch to everyone, a late joiner replays the log, two rooms stay apart, and malformed ids or
 * bodies are refused. Starts a production server on a spare port; run `npm run build` first, then
 * `node --test tests/collab.backend.mjs`.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startServer } from "./lib/server.mjs";

const EVENT_TIMEOUT_MS = 5000;
const QUIET_TIMEOUT_MS = 400;

let BASE = "";
let studio;

before(async () => {
  studio = await startServer();
  BASE = studio.base;
});

after(() => {
  studio?.stop();
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Split one SSE frame ("event: x\ndata: {...}") into a named event; null for a comment. */
function readFrame(frame) {
  let name = "message";
  const data = [];
  for (const line of frame.split("\n")) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const field = line.slice(0, colon);
    const value = line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") {
      name = value;
    } else if (field === "data") {
      data.push(value);
    }
  }
  return data.length === 0 ? null : { name, data: JSON.parse(data.join("\n")) };
}

/** One open room stream, holding the events the test has not read yet. */
async function openRoom(room, clientId) {
  const abort = new AbortController();
  const response = await fetch(
    `${BASE}/api/collab/${encodeURIComponent(room)}?clientId=${encodeURIComponent(clientId)}`,
    { signal: abort.signal, headers: { accept: "text/event-stream" } },
  );
  assert.equal(response.status, 200, `${clientId} should open a stream in ${room}`);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);

  const events = [];
  const decoder = new TextDecoder();
  let buffer = "";

  const pump = (async () => {
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const event = readFrame(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          if (event) {
            events.push(event);
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // The test closed this stream; whatever arrived before stays readable.
    }
  })();

  return {
    async next(name, timeoutMs = EVENT_TIMEOUT_MS) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const index = events.findIndex((event) => event.name === name);
        if (index !== -1) {
          return events.splice(index, 1)[0].data;
        }
        await sleep(20);
      }
      const seen = events.map((event) => event.name).join(", ") || "nothing";
      throw new Error(`no "${name}" event for ${clientId} in ${room} (saw ${seen})`);
    },
    async close() {
      abort.abort();
      await pump;
    },
  };
}

function postPatch(room, body) {
  return fetch(`${BASE}/api/collab/${encodeURIComponent(room)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Read presence frames until the peer list matches, so a burst of joins or leaves cannot race. */
async function waitForPeers(stream, expected) {
  const wanted = [...expected].sort().join(",");
  for (;;) {
    const event = await stream.next("presence");
    if ([...event.peers].sort().join(",") === wanted) {
      return event;
    }
  }
}

const MOVE = { nodeId: "shot-1", x: 120, y: 80 };

test("a room streams presence and board patches, and replays the log to a late joiner", async () => {
  const room = "room-stream";
  const a = await openRoom(room, "client-a");
  try {
    const helloA = await a.next("hello");
    assert.equal(helloA.room, room);
    assert.equal(helloA.clientId, "client-a");
    assert.deepEqual(helloA.peers, ["client-a"], "hello lists the room, this client included");
    assert.deepEqual(helloA.patches, [], "a fresh room has an empty log");

    const b = await openRoom(room, "client-b");
    try {
      const helloB = await b.next("hello");
      assert.deepEqual([...helloB.peers].sort(), ["client-a", "client-b"]);
      await waitForPeers(a, ["client-a", "client-b"]);

      const response = await postPatch(room, {
        clientId: "client-a",
        patch: { type: "node-move", data: MOVE },
      });
      assert.equal(response.status, 200);
      const accepted = await response.json();
      assert.equal(accepted.seq, 1);
      assert.equal(typeof accepted.at, "number");

      for (const stream of [a, b]) {
        const patch = await stream.next("patch");
        assert.equal(patch.seq, 1);
        assert.equal(patch.clientId, "client-a");
        assert.equal(patch.type, "node-move");
        assert.deepEqual(patch.data, MOVE);
        assert.equal(typeof patch.at, "number");
      }

      const c = await openRoom(room, "client-c");
      try {
        const helloC = await c.next("hello");
        assert.deepEqual([...helloC.peers].sort(), ["client-a", "client-b", "client-c"]);
        assert.equal(helloC.patches.length, 1, "the late joiner replays the room log");
        assert.equal(helloC.patches[0].seq, 1);
        assert.equal(helloC.patches[0].type, "node-move");
        assert.deepEqual(helloC.patches[0].data, MOVE);
      } finally {
        await c.close();
      }
      await waitForPeers(a, ["client-a", "client-b"]);
    } finally {
      await b.close();
    }
    await waitForPeers(a, ["client-a"]);
  } finally {
    await a.close();
  }
});

test("each room keeps its own presence and patch log", async () => {
  const left = await openRoom("room-left", "client-left");
  try {
    await left.next("hello");
    const right = await openRoom("room-right", "client-right");
    try {
      const hello = await right.next("hello");
      assert.deepEqual(hello.peers, ["client-right"], "the other room's client is not here");
      assert.deepEqual(hello.patches, []);

      const response = await postPatch("room-left", {
        clientId: "client-left",
        patch: { type: "node-add", data: { nodeId: "shot-2" } },
      });
      assert.equal(response.status, 200);
      assert.equal((await left.next("patch")).type, "node-add");

      await assert.rejects(
        right.next("patch", QUIET_TIMEOUT_MS),
        /no "patch" event/,
        "a patch in one room stays out of the other",
      );
    } finally {
      await right.close();
    }
  } finally {
    await left.close();
  }
});

test("malformed ids, bodies and oversized patches are refused", async () => {
  const noClient = await fetch(`${BASE}/api/collab/room-checks`);
  assert.equal(noClient.status, 400, "a stream without clientId is refused");

  const badRoom = await fetch(`${BASE}/api/collab/${"r".repeat(65)}?clientId=client-a`);
  assert.equal(badRoom.status, 400, "a room id past 64 characters is refused");

  const badJson = await postPatch("room-checks", "{");
  assert.equal(badJson.status, 400, "a body that is not JSON is refused");

  const noType = await postPatch("room-checks", { clientId: "client-a", patch: { data: {} } });
  assert.equal(noType.status, 400, "a patch without a type is refused");

  const badClient = await postPatch("room-checks", {
    clientId: "bad client",
    patch: { type: "note" },
  });
  assert.equal(badClient.status, 400, "a client id a URL could not carry is refused");

  const oversized = await postPatch("room-checks", {
    clientId: "client-a",
    patch: { type: "note", data: "x".repeat(70_000) },
  });
  assert.equal(oversized.status, 413, "a patch body past the cap is refused");
});
