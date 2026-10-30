/**
 * The new frontend (web/, served from web/dist by the Next server) in a real Chrome: the landing
 * page, the studio, a chat, a Cinematic render end to end, a Re-shoot that uploads its source,
 * old routes and the 404 page. Demo mode, so no ComfyUI is needed. Needs `npm run build` first.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";

import { openBrowser } from "./lib/browser.mjs";
import { pageOpener, poll, sleep, until } from "./lib/page.mjs";
import { startServer } from "./lib/server.mjs";

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

/** The chats the server's database holds. */
async function serverChats() {
  const response = await fetch(`${app.base}/api/chats`);
  assert.equal(response.status, 200);
  return (await response.json()).chats;
}

/** Record the page's API calls: method, path, request body and response body. */
const RECORD_API = `(() => {
  window.__api = [];
  const original = window.fetch;
  window.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const response = await original(input, init);
    if (url.includes('/api/')) {
      const entry = { method: init.method ?? 'GET', path: new URL(url, location.href).pathname, body: typeof init.body === 'string' ? init.body : null };
      window.__api.push(entry);
      response.clone().text().then((text) => (entry.response = text));
    }
    return response;
  };
  return true;
})()`;

test("the landing page renders from web/dist", async () => {
  const { run, shot } = await open("/");
  assert.match(await run("document.title"), /kinemi/i);
  assert.ok(await run("!!document.querySelector('h1')"), "the landing has a headline");
  await shot("landing");
});

test("every landing picture slot holds a real image", async () => {
  const { run } = await open("/");
  const empty = await run(`Array.from(document.querySelectorAll('[data-shot]')).map((el) => el.getAttribute('data-shot'))`);
  assert.deepEqual(empty, [], "no landing slot is still an empty viewfinder");
  const count = await run("document.querySelectorAll('img.shot-img').length");
  assert.equal(count, 3, "the landing places all three pictures");
  // the render-* slots were captures of the demo backend's placeholder, not real renders
  const renders = await run(`Array.from(document.querySelectorAll('img.shot-img')).map((img) => img.currentSrc || img.src).filter((src) => /render-/.test(src))`);
  assert.deepEqual(renders, [], "no landing picture is a demo render");
  // ask for every picture at once, so a lazy one below the fold still has to arrive
  await run("Array.from(document.querySelectorAll('img.shot-img')).forEach((img) => { img.loading = 'eager'; })");
  const pics = "document.querySelectorAll('img.shot-img')";
  const arrived = `Array.from(${pics}).filter((img) => img.complete && img.naturalWidth > 0).length`;
  await until(run, `Array.from(${pics}).every((img) => img.complete && img.naturalWidth > 0)`, "every landing picture", 20000).catch(() => undefined);
  const loaded = await run(arrived);
  const missing = await run(`Array.from(${pics}).filter((img) => !img.naturalWidth).map((img) => img.currentSrc || img.src)`);
  assert.equal(loaded, 3, `${loaded} of 3 pictures arrived; missing ${JSON.stringify(missing)}`);
  assert.deepEqual(missing, [], "no picture is broken");
});

// The smallest font of any element in a card that carries text of its own, at any depth.
const SMALLEST_CARD_FONT = `Math.min(...[card, ...card.querySelectorAll('*')]
  .filter((el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()))
  .map((el) => parseFloat(getComputedStyle(el).fontSize)))`;

test("the open-models cards are readable registry models, not pictures", async () => {
  const registry = JSON.parse(readFileSync("data/models.json", "utf8"));
  const { run } = await open("/");
  const cards = await run(`Array.from(document.querySelectorAll('#models .model-card')).map((card) => ({
    id: card.dataset.model,
    name: card.querySelector('.mc-name')?.textContent.trim(),
    vendor: card.querySelector('.mc-vendor')?.textContent.trim(),
    lines: Array.from(card.children).map((el) => el.className),
    smallest: ${SMALLEST_CARD_FONT},
  }))`);
  assert.equal(cards.length, 4, "four model cards");
  for (const card of cards) {
    const model = registry.find((m) => m.id === card.id);
    assert.ok(model, `${card.id} is in data/models.json`);
    assert.equal(card.name, model.name);
    assert.equal(card.vendor, model.vendor);
    assert.deepEqual(card.lines, ["mc-name", "mc-line", "mc-vendor"], `${card.id} has no type or length kicker`);
    assert.ok(card.smallest >= 12, `${card.id} text is at least 12px, got ${card.smallest}`);
  }
  assert.equal(await run("document.querySelectorAll('#models img').length"), 1, "only the studio window is a picture");
});

test("the open-models cards stay readable on a 375px phone", async () => {
  const { run, shot } = await open("/", { width: 375, height: 812, mobile: true });
  // the landing scrolls smoothly and fades sections in: jump there, then wait for the cards to show
  await run("document.documentElement.style.scrollBehavior = 'auto', document.querySelector('#models .model-card').scrollIntoView({ block: 'center', behavior: 'instant' }), true");
  await until(run, `(() => { const c = document.querySelector('#models .model-card'); const r = c.getBoundingClientRect();
    let sharp = true;
    for (let el = c; el; el = el.parentElement) sharp &&= getComputedStyle(el).filter === 'none' && getComputedStyle(el).opacity === '1';
    return r.top >= 0 && r.bottom <= innerHeight && sharp; })()`, "the model cards on screen and done fading in", 5000);
  await sleep(400);
  const cards = await run(`Array.from(document.querySelectorAll('#models .model-card')).map((card) => {
    const r = card.getBoundingClientRect();
    return { id: card.dataset.model, left: r.left, right: r.right,
      smallest: ${SMALLEST_CARD_FONT} };
  })`);
  assert.equal(cards.length, 4, "four model cards on the phone");
  for (const card of cards) {
    assert.ok(card.smallest >= 12, `${card.id} text is at least 12px on a phone, got ${card.smallest}`);
    assert.ok(card.left >= 0 && card.right <= 375, `${card.id} sits inside the 375px screen (${card.left}..${card.right})`);
  }
  const width = await run("document.documentElement.scrollWidth");
  assert.ok(width <= 375, `the landing does not scroll sideways at 375px (scrollWidth ${width})`);
  await shot("models-375");
});

test("studio textareas have accessible names", async () => {
  for (const path of ["/app/tools/audio-studio/", "/app/tools/canvas/", "/app/tools/supercomputer/"]) {
    const { run } = await open(path);
    const names = await run(`Array.from(document.querySelectorAll("textarea")).map((field) => field.getAttribute("aria-label")?.trim() || field.labels?.[0]?.textContent?.trim() || "")`);
    assert.ok(names.length > 0, `${path} renders a textarea`);
    assert.ok(names.every(Boolean), `${path} names every textarea`);
  }
});

test("the studio names the server without a COMFY_URL nag", async () => {
  const { run, shot } = await open("/app/");
  const chip = await until(run, "document.body.innerText.includes('Kinemi server') && document.body.innerText", "the compute chip");
  assert.doesNotMatch(chip, /COMFY_URL|Demo renders/i);
  await shot("studio");
});

test("a fresh local studio lists no mock chats", async () => {
  const { run } = await open("/app/");
  assert.deepEqual(await serverChats(), []);
  await until(run, "document.querySelector('.side-empty')", "the empty chat list", 10000);
  assert.equal(await run("document.querySelectorAll('.chat-item').length"), 0);
});

test("a chat message gets an answer with a render card", async () => {
  const { run, shot } = await open("/app/");
  await run(`(() => {
    const box = document.querySelector('.composer-row textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(box, 'A slow dolly in on a neon street at night');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  // the composer sends the draft it last rendered, so let it render the typed text first
  await until(run, "document.querySelector('.composer-row textarea').value.length > 0 && document.querySelector('.composer-preview')", "the typed draft");
  await run("new Promise((resolve) => setTimeout(resolve, 100)).then(() => document.querySelector('.composer-row textarea').closest('form').requestSubmit())");
  await until(run, "document.querySelector('.call-title')?.textContent", "the chat's render card", 15000);
  await shot("chat");
});

test("a sent chat is saved in the server's database and listed after a reload", async () => {
  const saved = await poll(async () => (await serverChats())[0], "the chat in the database", 10000);
  assert.ok(saved.messages.length >= 2, "the question and the answer are stored");
  const { run } = await open("/app/");
  await until(run, `[...document.querySelectorAll('.chat-item')].some((row) => row.dataset.chat === ${JSON.stringify(saved.id)})`, "the saved chat in the sidebar", 10000);
});

test("the pen renames a chat in place; Enter saves and Escape cancels", async () => {
  const { run, shot, hover } = await open("/app/");
  const id = await until(run, "document.querySelector('.chat-item')?.dataset.chat", "a chat row", 10000);
  const row = `.chat-item[data-chat="${id}"]`;
  const rename = async (title, key) => {
    await hover(row);
    await until(run, `getComputedStyle(document.querySelector('${row} .chat-actions')).opacity === '1'`, "hovering to show the pen", 5000);
    await run(`document.querySelector('${row} .chat-act').click()`);
    await until(run, `document.querySelector('${row}.is-editing input') === document.activeElement`, "the title input", 5000);
    if (key === "Enter") await shot("chat-rename");
    await run(`(() => {
      const box = document.querySelector('${row}.is-editing input');
      box.value = ${JSON.stringify(title)};
      box.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
    })()`);
    await until(run, `!document.querySelector('${row}.is-editing')`, "the row to leave edit mode", 5000);
  };
  await rename("Renamed in place", "Enter");
  await poll(async () => (await serverChats()).find((c) => c.id === id)?.title === "Renamed in place", "the saved title", 10000);
  await rename("Never saved", "Escape");
  assert.equal(await run(`document.querySelector('${row} .side-text').textContent`), "Renamed in place");
});

test("hold-to-delete has a custom tooltip and requires a pointer or key hold", async () => {
  const { run, shot, hover, mouse } = await open("/app/");
  const id = await until(run, "document.querySelector('.chat-item')?.dataset.chat", "a chat row", 10000);
  const row = `.chat-item[data-chat="${id}"]`;
  const button = `${row} .chat-del`;
  const fire = (type, extra = "{}") =>
    run(`(() => {
      const box = document.querySelector(${JSON.stringify(button)});
      box.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, { bubbles: true, button: 0, pointerId: 1, isPrimary: true, ...${extra} }));
      return true;
    })()`);
  const key = (type, value = "Enter") =>
    run(`(() => {
      const box = document.querySelector(${JSON.stringify(button)});
      box.focus();
      box.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)}, { key: ${JSON.stringify(value)}, bubbles: true }));
      return true;
    })()`);
  const holding = () => run(`!!document.querySelector('${row}.is-holding')`);
  const exists = () => run(`!!document.querySelector('${row}')`);
  const undo = () => run("[...document.querySelectorAll('.toast button')].find((b) => b.textContent.includes('Undo')).click()");

  assert.equal(await run(`document.querySelector('${row}').hasAttribute('title')`), false, "the row has no native browser tooltip");
  assert.equal(await run(`document.querySelector('${button}').hasAttribute('title')`), false, "the delete button has no native browser tooltip");
  assert.equal(await run(`document.querySelector('${button}').dataset.tip`), "Hold for 1 second to delete", "the delete button provides its custom tooltip");
  await hover(row);
  await hover(button);
  // the 180ms fade restarts if the list re-renders under the mouse, so poll instead of one fixed sleep
  const readTip = () => run(`(() => {
    const trigger = document.querySelector(${JSON.stringify(button)});
    const tip = getComputedStyle(trigger, "::after");
    const bounds = trigger.getBoundingClientRect();
    const width = parseFloat(tip.width);
    const height = parseFloat(tip.height);
    const top = bounds.bottom - parseFloat(tip.bottom) - height;
    const right = parseFloat(tip.right);
    const left = Number.isFinite(right) ? bounds.right - right - width : bounds.left + bounds.width / 2 - width / 2;
    const tooltipBox = { left, top, right: left + width, bottom: top + height };
    let clippingAncestor = null;
    for (let node = trigger; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const clip = node.getBoundingClientRect();
      const clipsX = style.overflowX !== "visible" && (tooltipBox.left < clip.left || tooltipBox.right > clip.right);
      const clipsY = style.overflowY !== "visible" && (tooltipBox.top < clip.top || tooltipBox.bottom > clip.bottom);
      if (clipsX || clipsY) {
        clippingAncestor = { name: node.className || node.tagName, rect: { left: clip.left, top: clip.top, right: clip.right, bottom: clip.bottom }, clipsX, clipsY };
        break;
      }
    }
    return { content: tip.content, position: tip.position, visibility: tip.visibility, opacity: Number(tip.opacity), width, height, tooltipBox, clippingAncestor };
  })()`);
  let tooltipState = await readTip();
  for (let waited = 0; tooltipState.opacity <= 0.9 && waited < 1000; waited += 100) {
    await sleep(100);
    tooltipState = await readTip();
  }
  assert.ok(tooltipState.content.includes("Hold for 1 second to delete"), "the custom tooltip has the delete hint");
  assert.equal(tooltipState.position, "absolute", `the tooltip is positioned: ${JSON.stringify(tooltipState)}`);
  assert.equal(tooltipState.visibility, "visible", `the tooltip is visible: ${JSON.stringify(tooltipState)}`);
  assert.ok(tooltipState.opacity > 0.9, `the tooltip animation has finished: ${JSON.stringify(tooltipState)}`);
  assert.ok(tooltipState.width > 0 && tooltipState.height > 0, `the tooltip has a visible box: ${JSON.stringify(tooltipState)}`);
  assert.equal(tooltipState.clippingAncestor, null, `no ancestor clips the tooltip: ${JSON.stringify(tooltipState)}`);
  await sleep(1200);
  assert.ok(await exists(), "hovering alone never deletes the chat");
  assert.ok(!(await holding()), "hovering alone never fills the button");

  await fire("pointerdown");
  await sleep(400);
  assert.ok(await holding(), "the button fills while it is held down");
  await mouse(900, 520);
  await mouse(901, 520);
  await sleep(200);
  assert.ok(!(await holding()), "moving the real mouse off the button empties the fill");
  assert.ok(await exists(), "leaving keeps the chat");

  await hover(button);
  await fire("pointerdown");
  await sleep(300);
  assert.ok(await holding(), "the button fills again");
  await fire("pointercancel");
  await sleep(200);
  assert.ok(!(await holding()), "a cancelled pointer empties the fill");

  await fire("pointerdown");
  await sleep(300);
  assert.ok(await holding(), "the button fills before a touch drag");
  await fire("pointermove", '{ clientX: 0, clientY: 0, pointerType: "touch" }');
  await sleep(200);
  assert.ok(!(await holding()), "sliding a touch off the button stops the hold");

  await fire("pointerdown");
  await sleep(400);
  await fire("pointerup");
  await sleep(300);
  assert.ok(await exists(), "releasing before a second keeps the chat");
  assert.ok(!(await holding()), "releasing empties the fill");

  await key("keydown");
  await sleep(400);
  assert.ok(await holding(), "holding Enter fills the button");
  await key("keyup");
  await sleep(300);
  assert.ok(await exists(), "releasing Enter early keeps the chat");
  assert.ok(!(await holding()), "releasing Enter empties the fill");

  await key("keydown", " ");
  await sleep(300);
  assert.ok(await holding(), "holding Space fills the button");
  await key("keyup", " ");
  await sleep(200);
  assert.ok(!(await holding()), "releasing Space early empties the fill");

  await run(`document.querySelector(${JSON.stringify(button)}).click()`);
  assert.ok(await exists(), "an assistive-technology activation prepares a safe confirmation");
  assert.match(await run(`document.querySelector(${JSON.stringify(button)}).getAttribute('aria-label')`), /activate again/i);
  await run(`document.querySelector(${JSON.stringify(button)}).click()`);
  assert.ok(!(await exists()), "a second assistive-technology activation confirms deletion");
  await undo();
  await until(run, `!!document.querySelector('${row}')`, "the restored chat after confirmation", 5000);

  await key("keydown");
  await sleep(1200);
  assert.ok(!(await exists()), "holding Enter for a second deletes the chat");
  await undo();
  await until(run, `!!document.querySelector('${row}')`, "the restored chat after keyboard hold", 5000);

  await fire("pointerdown");
  await shot("chat-hold");
  await sleep(1300);
  assert.ok(!(await exists()), "holding the pointer for a second deletes the chat");
  await poll(async () => !(await serverChats()).some((c) => c.id === id), "the delete on the server", 10000);
  await undo();
  await until(run, `!!document.querySelector('${row}')`, "the restored chat", 5000);
  await poll(async () => (await serverChats()).some((c) => c.id === id), "the restore on the server", 10000);
});

test("the Director menu opens above its card, turns the chevron, and closes when the mouse leaves", async () => {
  const { run, shot, hover, away } = await open("/app/");
  await hover(".user-card");
  await run("document.querySelector('.user-card').click()");
  await until(run, "document.querySelector('[role=menu]')", "the Director menu", 5000);
  // the chevron rotates over 0.2 s: wait for it to finish rather than catch it mid-turn
  await until(
    run,
    `(() => {
      const m = getComputedStyle(document.querySelector('.user-chevron')).transform;
      return m.startsWith('matrix(') && parseFloat(m.slice(7)) < -0.9 ? m : false;
    })()`,
    "the chevron to point up",
    3000,
  );
  const box = await run(`(() => {
    const card = document.querySelector('.user-card');
    return {
      menuBottom: document.querySelector('[role=menu]').getBoundingClientRect().bottom,
      cardTop: card.getBoundingClientRect().top,
      expanded: card.getAttribute('aria-expanded'),
      chevron: getComputedStyle(document.querySelector('.user-chevron')).transform,
    };
  })()`);
  assert.ok(box.menuBottom <= box.cardTop + 1, `the menu (bottom ${box.menuBottom}) sits above the card (top ${box.cardTop})`);
  assert.equal(box.expanded, "true");
  assert.ok(parseFloat(box.chevron.slice(7)) < -0.9, `the chevron points up while open: ${box.chevron}`);
  await shot("director-menu");
  await away();
  await sleep(600);
  assert.ok(await run("!document.querySelector('[role=menu]')"), "the menu closed after the mouse left");
  assert.equal(await run("document.querySelector('.user-card').getAttribute('aria-expanded')"), null);
  await until(run, `getComputedStyle(document.querySelector('.user-chevron')).transform === 'none'`, "the chevron to point down again", 3000);
});

test("the render queue opened with the mouse closes when the mouse leaves", async () => {
  const { run, hover, away } = await open("/app/");
  await hover(".queue-btn");
  await run("document.querySelector('.queue-btn').click()");
  await until(run, "document.querySelector('.queue-panel')", "the queue panel", 5000);
  await hover(".queue-panel");
  await sleep(400);
  assert.ok(await run("!!document.querySelector('.queue-panel')"), "the panel stays open while the mouse is on it");
  await away();
  await sleep(600);
  assert.ok(await run("!document.querySelector('.queue-panel')"), "the panel closed after the mouse left");
});

test("Cinematic renders on the server and the take shows the server's file", async () => {
  const { run, shot } = await open("/app/tools/cinematic/");
  await run(RECORD_API);
  await run("document.querySelector('.ws-render').click()");
  const src = await until(run, "document.querySelector('.ws .poster.poster-file')?.getAttribute('src')", "the take");
  const calls = await run("window.__api");
  const generate = calls.find((c) => c.method === "POST" && c.path === "/api/generate");
  assert.ok(generate, "the studio POSTs /api/generate");
  const body = JSON.parse(generate.body);
  assert.equal(body.mode, "cinematic");
  assert.ok(body.modelId, "a registry model is sent");
  assert.ok(calls.some((c) => c.path.startsWith("/api/jobs/")), "the studio polls the job");
  assert.match(src, /^data:image\//, "the demo server's still is what the take shows");
  await shot("cinematic-take");
});

test("a voiceover sends only the script as the text to speak, on Chatterbox, with no named voices", async () => {
  const { run } = await open("/app/tools/audio-studio/");
  const panel = await run("document.body.innerText");
  assert.doesNotMatch(panel, /warm narrator|deep trailer|bright UGC|calm tutor/, "no voice the model cannot render is offered");
  assert.match(panel, /Default voice/, "the voice the model renders is named");
  const script = await until(run, "document.querySelector('textarea')?.value", "the script field");
  await run(RECORD_API);
  await run("document.querySelector('.ws-render').click()");
  const generate = await until(run, "window.__api.find((c) => c.method === 'POST' && c.path === '/api/generate')", "the render request");
  const body = JSON.parse(generate.body);
  assert.equal(body.modelId, "chatterbox");
  assert.equal(body.params.feature, "voiceover");
  assert.equal(body.prompt, script.trim(), "the TTS reads the prompt aloud, so it carries the script and nothing else");
});

test("Re-shoot uploads an imported source and sends the name the server gave it", async () => {
  const assets = await open("/app/assets/");
  await assets.run(`(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
    canvas.getContext('2d').fillRect(0, 0, 64, 36);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const input = document.querySelector('input[type=file]');
    const files = new DataTransfer();
    files.items.add(new File([blob], 'source-still.png', { type: 'image/png' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await until(assets.run, "document.body.innerText.includes('source-still')", "the imported still", 10000);

  const { run, shot } = await open("/app/tools/re-shoot/");
  await run(RECORD_API);
  await until(run, "(button => !!button && !button.disabled)(document.querySelector('.ws-render'))", "a source for Re-shoot", 10000);
  await run("document.querySelector('.ws-render').click()");
  const upload = await until(run, "window.__api.find((c) => c.method === 'POST' && c.path === '/api/assets' && c.response)", "the source upload");
  const generate = await until(run, "window.__api.find((c) => c.method === 'POST' && c.path === '/api/generate')", "the render request");
  const body = JSON.parse(generate.body);
  assert.equal(body.mode, "reshoot");
  assert.equal(body.params.imageName ?? body.params.videoName, JSON.parse(upload.response).name);
  await until(run, "document.querySelector('.ws .poster.poster-file') || document.querySelector('.queue-error, [role=alert]')", "the take or the server's error");
  await shot("reshoot");
});

test("old routes land on their studio page", async () => {
  const { run } = await open("/cinematic");
  assert.equal(await run("location.pathname"), "/app/tools/cinematic/");
});

test("an unknown path shows the design's 404 page", async () => {
  const response = await fetch(`${app.base}/no-such-page`);
  assert.equal(response.status, 404);
  const { run, shot } = await open("/no-such-page");
  assert.match(await run("document.body.innerText"), /404|not found/i);
  await shot("not-found");
});

/** The test server listens on 127.0.0.1, a loopback host: no page may link to policies there. */
const POLICY_LINKS = `document.querySelectorAll('a[href*="/legal/"]').length`;
const PLACEHOLDER = "Your policies here";

test("on a loopback host the landing footer shows the policies placeholder, not links", async () => {
  const { run } = await open("/");
  const footer = await until(run, `document.querySelector('.footer-legal .policies-placeholder')?.textContent`, "the footer placeholder");
  assert.equal(footer, PLACEHOLDER);
  assert.equal(await run(`document.querySelectorAll('.footer-legal a').length`), 0);
  assert.equal(await run(POLICY_LINKS), 0);
});

test("on a loopback host the page frame shows the placeholder too", async () => {
  const { run } = await open("/no-such-page");
  const text = await until(run, `document.querySelector('.pg-foot nav .policies-placeholder')?.textContent`, "the page footer placeholder");
  assert.equal(text, PLACEHOLDER);
  assert.equal(await run(`document.querySelectorAll('.pg-foot a').length`), 0);
});

test("on a loopback host Settings → Legal & about and Data & privacy name no policy links", async () => {
  const about = await open("/app/settings/about/");
  const card = await until(about.run, `document.querySelector('#policies .policies-placeholder')?.textContent`, "the policies placeholder");
  assert.equal(card, PLACEHOLDER);
  assert.equal(await about.run(`document.querySelectorAll('#policies a').length`), 0);
  const data = await open("/app/settings/data/");
  // the page is prerendered with the links, so the placeholder only appears after hydration
  const kept = await until(data.run, `document.querySelector('#kept .policies-placeholder')?.textContent`, "the kept card placeholder");
  assert.equal(kept, PLACEHOLDER);
  assert.equal(await data.run(`document.querySelectorAll('#kept a[href*="/legal/"]').length`), 0);
});

test("no page logged a console error", () => {
  assert.deepEqual(errors, []);
});
