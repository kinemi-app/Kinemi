/**
 * The camera rig's top view in a real Chrome: its keys sit inside the plan, clear of each other and of
 * the camera and the subject, the camera rests on the orbit ring, and the sightline covers the subject.
 * Needs `npm run build` first.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, test } from "node:test";

import { openBrowser } from "./lib/browser.mjs";
import { pageOpener, sleep, until } from "./lib/page.mjs";
import { startServer } from "./lib/server.mjs";

/** How far the camera's centre may sit off the ring, in CSS pixels. */
const RING_TOLERANCE_PX = 1.5;

let app;
let browser;
const errors = [];
const open = pageOpener(() => ({ browser, app }), errors);

before(async () => {
  assert.ok(existsSync("web/dist/index.html"), "web/dist is missing: run `npm run build` first");
  app = await startServer();
  browser = await openBrowser();
});

after(async () => {
  await browser?.close();
  app?.stop();
});

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (inner, outer) =>
  inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;

test("the top view keeps its keys inside the plan, clear of the camera, the subject and each other", async () => {
  const { run, shot } = await open("/app/tools/cinematic/");
  await until(run, "document.querySelector('.rp-plan .pad-key')", "the rig's top-view keys", 10000);
  // the panels open with a 0.22 s rise; measure once every box has settled
  await sleep(500);

  const rig = await run(`(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const centre = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
    const ring = box(document.querySelector('[data-rig=ring]'));
    const camera = centre(box(document.querySelector('.rp-cam-body')));
    const ringCentre = centre(ring);
    return {
      plan: box(document.querySelector('.rp-plan')),
      keys: [...document.querySelectorAll('.rp-plan .pad-key')].map((k) => ({ name: k.getAttribute('aria-label'), ...box(k) })),
      allKeys: [...document.querySelectorAll('.rig .pad-key')].map((k) => ({ name: k.getAttribute('aria-label'), ...box(k) })),
      camera: box(document.querySelector('[data-rig=camera]')),
      subject: box(document.querySelector('[data-rig=subject]')),
      ring,
      beam: box(document.querySelector('.rp-beam')),
      cameraDistance: Math.hypot(camera.x - ringCentre.x, camera.y - ringCentre.y),
      ringRadius: ring.width / 2,
    };
  })()`);

  assert.equal(rig.keys.length, 6, "the plan shows one key per top-view move");
  await shot("rig-top-view");

  // (a) no key overlaps another key
  for (let i = 0; i < rig.allKeys.length; i += 1) {
    for (let j = i + 1; j < rig.allKeys.length; j += 1) {
      assert.ok(!overlaps(rig.allKeys[i], rig.allKeys[j]), `(a) ${rig.allKeys[i].name} overlaps ${rig.allKeys[j].name}`);
    }
  }

  // (b) no key overlaps the camera or the subject
  for (const key of rig.allKeys) {
    assert.ok(!overlaps(key, rig.camera), `(b) ${key.name} overlaps the camera`);
    assert.ok(!overlaps(key, rig.subject), `(b) ${key.name} overlaps the subject`);
  }

  // (c) every key sits inside the plan rectangle
  for (const key of rig.keys) {
    assert.ok(inside(key, rig.plan), `(c) ${key.name} is outside the plan: ${JSON.stringify({ key, plan: rig.plan })}`);
  }

  // (d) the camera's body centre rests on the orbit ring, whose centre is the subject
  assert.ok(Math.abs(rig.ring.width - rig.ring.height) <= 0.5, "the orbit ring is a circle");
  assert.ok(
    Math.abs(rig.cameraDistance - rig.ringRadius) <= RING_TOLERANCE_PX,
    `(d) the camera is ${rig.cameraDistance.toFixed(2)} px from the ring's centre, expected ${rig.ringRadius.toFixed(2)} px +- ${RING_TOLERANCE_PX}`,
  );

  // (e) the sightline sits under the subject: its box covers the subject or hangs below it
  assert.ok(rig.beam.width > 0 && rig.beam.height > 0, "the sightline is drawn");
  assert.ok(
    inside(rig.subject, rig.beam) || rig.beam.top >= rig.subject.bottom,
    `(e) the sightline is neither around nor below the subject: ${JSON.stringify({ beam: rig.beam, subject: rig.subject })}`,
  );
});

test("no page logged a console error", () => {
  assert.deepEqual(errors, []);
});
