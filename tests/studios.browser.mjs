/**
 * AC8: every parity panel carries an enabled control, and every enabled control in it is wired to
 * a React handler. The static smoke proves the control is enabled; this proves no enabled button,
 * field or select in a parity panel is a dead placeholder, so a dead action button cannot hide
 * behind a live textarea.
 *
 * It runs directly, not through `npm run test:browser`: that script names tests/home.browser.mjs,
 * and package.json is outside this task. Run `node --test tests/studios.browser.mjs` after a build.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openBrowser } from "./lib/browser.mjs";
import { startServer } from "./lib/server.mjs";

/** The seven studio routes and how many parity panels each one carries. */
const STUDIO_ROUTES = [
  { path: "/audio", panels: 6 },
  { path: "/ads", panels: 4 },
  { path: "/fashion", panels: 3 },
  { path: "/canvas", panels: 3 },
  { path: "/previz", panels: 3 },
  { path: "/studio", panels: 4 },
  { path: "/upscale", panels: 3 },
];

/** Panels on those pages that frame the stage or the upload, not a parity row. */
const AUXILIARY_PANELS = ["Length", "Stage", "Source clip", "Model"];

let BASE = "";
let studio;
let browser;

before(async () => {
  studio = await startServer();
  BASE = studio.base;
  browser = await openBrowser();
});

after(async () => {
  await browser?.close();
  studio?.stop();
});

/**
 * React attaches an element's props to the DOM node under a `__reactProps$…` key. A placeholder
 * rendered by React has props too, but no click or change handler; that is the difference here.
 */
function panelWiring() {
  return `JSON.stringify(
    [...document.querySelectorAll("main section")]
      .filter((section) => {
        const title = section.querySelector("h2")?.textContent.trim();
        return title !== undefined && !${JSON.stringify(AUXILIARY_PANELS)}.includes(title);
      })
      .map((section) => {
        const nodes = [...section.querySelectorAll("button, input, select, textarea")].filter(
          (node) =>
            !node.disabled && node.getAttribute("aria-disabled") !== "true" && !node.readOnly,
        );
        const dead = nodes.filter((node) => {
          const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
          const props = key === undefined ? undefined : node[key];
          if (props === undefined) {
            return true;
          }
          const events =
            node.tagName === "BUTTON"
              ? ["onClick", "onPointerDown"]
              : ["onChange", "onInput", "onDrop"];
          return !events.some((event) => typeof props[event] === "function");
        });
        return {
          title: section.querySelector("h2").textContent.trim(),
          enabled: nodes.length,
          dead: dead.length,
        };
      }),
  )`;
}

test("all 26 parity panels wire every enabled control", async (t) => {
  let panels = 0;

  for (const route of STUDIO_ROUTES) {
    const { sessionId, consoleErrors } = await browser.openPage(`${BASE}${route.path}`);
    const found = JSON.parse(await browser.evaluate(sessionId, panelWiring()));

    assert.equal(found.length, route.panels, `${route.path} should carry ${route.panels} parity panels`);
    for (const panel of found) {
      assert.ok(
        panel.enabled > 0,
        `${route.path} panel "${panel.title}" should hold an enabled control, not a disabled placeholder`,
      );
      assert.equal(
        panel.dead,
        0,
        `${route.path} panel "${panel.title}" should wire every enabled control, including its action button`,
      );
      t.diagnostic(`${route.path} ${panel.title}: ${panel.enabled} enabled, ${panel.dead} dead`);
    }
    assert.deepEqual(consoleErrors, [], `${route.path} should log no console error`);
    panels += found.length;
  }

  assert.equal(panels, 26, "all 26 parity panels should hold a wired control");
});
