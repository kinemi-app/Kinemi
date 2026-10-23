/**
 * AC1 and AC2: the seven studio routes answer 200 with their own <h1> on the production build,
 * and every parity row A1-U3 is a panel that holds an enabled, named control. A disabled
 * placeholder fails: the smoke asks for a control a person can use now, not a label. The browser
 * check proves that control carries a React handler.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startServer } from "./lib/server.mjs";

let BASE = "";
let studio;

before(async () => {
  studio = await startServer();
  BASE = studio.base;
});

after(() => {
  studio?.stop();
});

const STUDIOS = [
  {
    path: "/audio",
    heading: "Audio Studio",
    panels: [
      { id: "A1", label: "Voiceover / text-to-speech" },
      { id: "A2", label: "Voice cloning" },
      { id: "A3", label: "Voice swap" },
      { id: "A4", label: "Dubbing and translation" },
      { id: "A5", label: "Multi-speaker scene" },
      { id: "A6", label: "Sound effects" },
    ],
  },
  {
    path: "/ads",
    heading: "Marketing Studio",
    panels: [
      { id: "M1", label: "Product to ad" },
      { id: "M2", label: "UGC, unboxing and tutorial" },
      { id: "M3", label: "Hook variations" },
      { id: "M4", label: "Marketplace and posters" },
    ],
  },
  {
    path: "/fashion",
    heading: "Fashion Factory",
    panels: [
      { id: "F1", label: "Garment and model swap" },
      { id: "F2", label: "Drape and lighting" },
      { id: "F3", label: "Influencer campaign" },
    ],
  },
  {
    path: "/canvas",
    heading: "Canvas",
    panels: [
      { id: "N1", label: "Node board" },
      { id: "N2", label: "Templates" },
      { id: "N3", label: "Collaboration canvas" },
    ],
  },
  {
    path: "/previz",
    heading: "3D Previz",
    panels: [
      { id: "D1", label: "3D previz" },
      { id: "D2", label: "Exports" },
      { id: "D3", label: "Motion designer" },
    ],
  },
  {
    path: "/studio",
    heading: "Supercomputer",
    panels: [
      { id: "S1", label: "Campaign planner" },
      { id: "S2", label: "Batch runs" },
      { id: "S3", label: "CLI and Skills" },
      { id: "S4", label: "Scheduled runs" },
    ],
  },
  {
    path: "/upscale",
    heading: "Upscale",
    panels: [
      { id: "U1", label: "4K upscale" },
      { id: "U2", label: "60 fps interpolation" },
      { id: "U3", label: "Deflicker and restoration" },
    ],
  },
];

/** Every parity ID the seven studios must carry, in reading order. */
const EXPECTED_IDS = [
  "A1", "A2", "A3", "A4", "A5", "A6",
  "M1", "M2", "M3", "M4",
  "F1", "F2", "F3",
  "N1", "N2", "N3",
  "D1", "D2", "D3",
  "S1", "S2", "S3", "S4",
  "U1", "U2", "U3",
];

/** A Panel is one <section> with its title in an <h2>; neither nests another section. */
const PANELS = /<section\b[\s\S]*?<\/section>/g;
const BUTTONS = /<button\b[^>]*>[\s\S]*?<\/button>/g;
const FIELDS = /<(?:input|select|textarea)\b[^>]*>/g;

/** True when the opening tag carries neither the disabled attribute nor aria-disabled="true". */
function isEnabled(opening) {
  return !/\sdisabled(?:[\s=>/]|$)/.test(opening) && !/\baria-disabled="true"/.test(opening);
}

/**
 * A control inside the panel with an accessible name, enabled now: a button whose text, aria-label
 * or title is non-empty, or a field with an aria-label, a title or a <label for>. A panel with only
 * a disabled button fails, which is what a placeholder looks like.
 */
function hasEnabledNamedControl(panel) {
  const namedButton = (panel.match(BUTTONS) ?? []).some((button) => {
    const opening = button.match(/^<button\b[^>]*>/)?.[0] ?? "";
    const text = button.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").trim();
    const named = text !== "" || /\b(?:aria-label|title)="[^"]+"/.test(opening);
    return named && isEnabled(opening);
  });
  if (namedButton) {
    return true;
  }

  for (const field of panel.match(FIELDS) ?? []) {
    if (!isEnabled(field)) {
      continue;
    }
    if (/\b(?:aria-label|title)="[^"]+"/.test(field)) {
      return true;
    }
    const id = field.match(/\bid="([^"]+)"/)?.[1];
    if (id && new RegExp(`<label[^>]*\\bfor="${id}"`, "i").test(panel)) {
      return true;
    }
  }

  return false;
}

function escapeForRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The panel whose heading is exactly this label, or undefined when the page has none. */
function findPanel(html, label) {
  const heading = new RegExp(`<h2[^>]*>\\s*${escapeForRegExp(label)}\\s*</h2>`);
  return (html.match(PANELS) ?? []).find((panel) => heading.test(panel));
}

test("every studio route heads its own page and every parity panel holds an enabled control", async () => {
  let panels = 0;
  const found = STUDIOS.flatMap((route) => route.panels.map((panel) => panel.id));
  assert.deepEqual(found, EXPECTED_IDS, "the seven routes carry all 26 parity IDs, once each");

  for (const route of STUDIOS) {
    const response = await fetch(`${BASE}${route.path}`);
    assert.equal(response.status, 200, `${route.path} should answer 200`);

    const html = await response.text();
    const main = html.match(/<main[\s>][\s\S]*?<\/main>/);
    assert.ok(main, `${route.path} should render a <main>`);

    const heading = main[0].match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    assert.ok(heading, `${route.path} should render an <h1> inside <main>`);
    const text = heading[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    assert.equal(text, route.heading, `${route.path} should head its own page`);

    for (const panel of route.panels) {
      assert.ok(main[0].includes(panel.label), `${route.path} should name "${panel.label}" (${panel.id})`);
      const section = findPanel(main[0], panel.label);
      assert.ok(section, `${route.path} should render a panel titled "${panel.label}" (${panel.id})`);
      assert.ok(
        hasEnabledNamedControl(section),
        `${route.path} panel "${panel.label}" (${panel.id}) should hold an enabled, named control, not a disabled placeholder`,
      );
      panels += 1;
    }
  }

  assert.equal(panels, 26, "26 parity panels across the seven studios");
});

test("a disabled placeholder is not an enabled control", () => {
  const placeholder =
    '<section><h2>Placeholder</h2><button type="button" disabled="">Coming soon</button></section>';
  const real = '<section><h2>Real</h2><button type="button">Run</button></section>';

  assert.equal(hasEnabledNamedControl(placeholder), false, "a disabled button should not count");
  assert.equal(hasEnabledNamedControl(real), true, "an enabled button should count");
});
