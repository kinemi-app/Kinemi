/**
 * The studio's polish in a real Chrome: defaults, menus, the composer, the chat header, settings,
 * the camera pad and the asset library kept in the server's database. Needs `npm run build` first.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, test } from "node:test";

import { openBrowser } from "./lib/browser.mjs";
import { pageOpener, seedStorage, sleep, typeInComposer, until } from "./lib/page.mjs";
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

test("the studio's favicon is the design's own", async () => {
  const response = await fetch(`${app.base}/favicon.svg`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /image\/svg\+xml/);
  assert.ok(!existsSync("app/icon.png"), "the old Next icon is gone");
  const { run } = await open("/app/");
  assert.equal(await run("document.querySelector('link[rel=icon][type=\"image/svg+xml\"]')?.getAttribute('href')"), "/favicon.svg");
});

test("a fresh studio has the chime on", async () => {
  const { run } = await open("/app/settings/notifications/");
  const chime = await until(
    run,
    "[...document.querySelectorAll('[role=switch]')].find((b) => b.textContent.includes('A chime'))?.getAttribute('aria-checked')",
    "the chime switch",
    10000,
  );
  assert.equal(chime, "true");
});

test("a dismissed toast fades out before it leaves", async () => {
  const { run } = await open("/app/settings/notifications/");
  await until(run, "[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Send a test'))", "the test button", 10000);
  await run("[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Send a test')).click()");
  await until(run, "document.querySelector('.toast')", "the toast", 5000);
  await run("document.querySelector('.toast [aria-label=Dismiss]').click()");
  const leaving = await run("(() => { const t = document.querySelector('.toast'); return t && t.classList.contains('is-leaving') && getComputedStyle(t).animationName; })()");
  assert.equal(leaving, "toast-out", "the toast is still there, fading out");
  await sleep(500);
  assert.equal(await run("document.querySelectorAll('.toast').length"), 0, "then it is gone");
});

test("composer pickers toggle on a second click and close when the mouse leaves", async () => {
  const { run, hover, mouse } = await open("/app/");
  const menuOpen = "!!document.querySelector('[role=menu]')";
  // the move list is tall, so "away" is the top corner, clear of every menu
  let corner = 1380;
  const away = async () => {
    corner -= 30;
    await mouse(corner, 40);
    await mouse(corner + 1, 40);
  };
  for (const trigger of [".composer-tools [aria-label='Add a camera move']", ".composer-tools .chip-btn", ".composer-tools [aria-label='Pick an open model']"]) {
    await until(run, `document.querySelector(${JSON.stringify(trigger)})`, trigger, 10000);
    await hover(trigger);
    await run(`document.querySelector(${JSON.stringify(trigger)}).click()`);
    await until(run, menuOpen, `${trigger} menu`, 5000);
    await run(`document.querySelector(${JSON.stringify(trigger)}).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
    await run(`document.querySelector(${JSON.stringify(trigger)}).click()`);
    await sleep(100);
    assert.equal(await run(menuOpen), false, `a second click closes ${trigger}`);
    await run(`document.querySelector(${JSON.stringify(trigger)}).click()`);
    await until(run, menuOpen, `${trigger} menu again`, 5000);
    // a person rests on the button a moment; the menu sets up its leave watch after it paints
    await sleep(250);
    await away();
    await sleep(600);
    assert.equal(await run(menuOpen), false, `${trigger} closes when the mouse leaves`);
  }
});

test("the GPU card follows the server, not just this browser", async () => {
  // This suite's server runs the demo generator, and this browser has no GPU of its own.
  const demo = await open("/app/");
  await until(demo.run, "document.querySelector('.gpu-card')", "the GPU card beside the demo server", 10000);
  assert.match(
    (await demo.run("document.querySelector('.user-card small')?.textContent")) ?? "",
    /Kinemi server/,
    "the chip shows the server's own answer",
  );

  // A server pointed at a ComfyUI reports generation: cloud, so the card must go.
  const cloud = await startServer({ comfyUrl: "http://127.0.0.1:8188" });
  try {
    const status = await (await fetch(`${cloud.base}/api/status`)).json();
    assert.equal(status.generation, "cloud", "the server says it renders on ComfyUI");
    const page = await pageOpener(() => ({ browser, app: cloud }), errors)("/app/");
    await until(
      page.run,
      "document.querySelector('.user-card small')?.textContent.includes('ComfyUI')",
      "the chip naming ComfyUI",
      10000,
    );
    const own = await page.run("JSON.parse(localStorage.getItem('kinemi.device.v1') || '{}')");
    assert.ok(!(own.compute === "local" && own.endpoint), `this browser has no GPU of its own: ${JSON.stringify(own)}`);
    assert.equal(await page.run("!!document.querySelector('.gpu-card')"), false, "no GPU card when the server renders on ComfyUI");
  } finally {
    cloud.stop();
  }
});

test("the GPU card says renders follow the server's ComfyUI", async () => {
  const { run } = await open("/app/");
  await until(run, "document.querySelector('.gpu-card')", "the GPU card beside the demo server", 10000);
  const copy = (await run("document.querySelector('.gpu-card .gpu-text')?.textContent")) ?? "";
  assert.match(copy, /server's ComfyUI/, `the card says the server runs the renders: ${copy}`);
  assert.doesNotMatch(copy, /COMFY_URL/, `the card shows no env-var nag: ${copy}`);
  assert.match(copy, /restart/i, `the card says to restart the server: ${copy}`);
  assert.doesNotMatch(copy, /key/i, `the card asks for no key in the browser: ${copy}`);
});

test("the GPU card hides once a GPU is connected in this browser", async () => {
  const first = await open("/app/");
  await until(first.run, "document.querySelector('.gpu-card')", "the GPU card while nothing is connected", 10000);
  await seedStorage(open, { "kinemi.device.v1": JSON.stringify({ compute: "local", endpoint: "http://127.0.0.1:8188" }) });
  const { run } = await open("/app/");
  await until(run, "document.querySelector('.user-card')", "the sidebar", 10000);
  await sleep(300);
  assert.equal(await run("!!document.querySelector('.gpu-card')"), false);
  await run("localStorage.removeItem('kinemi.device.v1')");
});

test("a hovered card casts no green shadow under itself", async () => {
  const { run, hover } = await open("/app/tools/");
  await until(run, "document.querySelector('.tv-card')", "the tool cards", 10000);
  await hover(".tv-card");
  await sleep(450);
  const shadow = await run("getComputedStyle(document.querySelector('.tv-card')).boxShadow");
  const outer = shadow.split(/,(?![^(]*\))/).filter((s) => !s.includes("inset"));
  assert.ok(outer.length > 0, `the card still lifts: ${shadow}`);
  for (const s of outer) assert.doesNotMatch(s, /rgba?\(57, 216, 121/, `no green under the card: ${shadow}`);
});

/** Import a small still through the Assets page's file input, the way a person drops one in. */
async function importStill(name) {
  const page = await open("/app/assets/");
  await until(page.run, "document.querySelector('input[type=file]')", "the assets file input", 10000);
  await page.run(`(async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
    canvas.getContext('2d').fillRect(0, 0, 64, 36);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const input = document.querySelector('input[type=file]');
    const files = new DataTransfer();
    files.items.add(new File([blob], ${JSON.stringify(`${name}.png`)}, { type: 'image/png' }));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await until(page.run, `document.body.innerText.includes(${JSON.stringify(name)})`, `the imported ${name}`, 10000);
}

const searchPicker = (text) => `(() => {
  const box = document.querySelector('.picker-search input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, ${JSON.stringify(text)});
  box.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

const pickerNames = "[...document.querySelectorAll('.picker-item span')].map((s) => s.textContent)";

test("Attach a render has a search box that filters by name, with an empty state", async () => {
  await importStill("harbour-still");
  const { run } = await open("/app/");
  await until(run, "document.querySelector('.composer-plus')", "the attach button", 10000);
  await run("document.querySelector('.composer-plus').click()");
  await until(run, "[...document.querySelectorAll('[role=menu] button')].find((b) => b.textContent.includes('A render from Assets'))", "the attach menu", 5000);
  await run("[...document.querySelectorAll('[role=menu] button')].find((b) => b.textContent.includes('A render from Assets')).click()");
  await until(run, "document.querySelector('.picker-search input')", "the picker's search box", 5000);

  await run(searchPicker("HARBOUR"));
  const names = await until(run, `(n => n.length === 1 && n)(${pickerNames})`, "only the matching render", 5000);
  assert.match(names[0], /harbour-still/);

  await run(searchPicker("no render is called this"));
  await until(run, "document.querySelector('.picker-empty')", "the empty state", 5000);
  assert.equal(await run("document.querySelectorAll('.picker-item').length"), 0);
  assert.match(await run("document.querySelector('.picker-empty').textContent"), /No render matches/);
});

test("the attachment thumb is bigger and its hover X removes it; send is a circle", async () => {
  const { run, hover } = await open("/app/");
  await until(run, "document.querySelector('.composer-plus')", "the composer", 10000);
  await run("document.querySelector('.composer-plus').click()");
  await until(run, "[...document.querySelectorAll('[role=menu] button')].find((b) => b.textContent.includes('A render from Assets'))", "the attach menu", 5000);
  await run("[...document.querySelectorAll('[role=menu] button')].find((b) => b.textContent.includes('A render from Assets')).click()");
  await until(run, "document.querySelector('.picker-item')", "a render to attach", 5000);
  await run("document.querySelector('.picker-item').click()");
  await until(run, "document.querySelector('.attach-thumb')", "the attachment", 5000);

  const size = await run("(r => ({ w: r.width, h: r.height }))(document.querySelector('.attach-thumb').getBoundingClientRect())");
  assert.ok(size.w >= 64 && size.h >= 40, `the thumb is bigger than 44x28: ${JSON.stringify(size)}`);
  assert.equal(await run("getComputedStyle(document.querySelector('.attach-x')).opacity"), "0", "the X waits for a hover");
  await hover(".attach-thumb");
  await sleep(300);
  assert.equal(await run("getComputedStyle(document.querySelector('.attach-x')).opacity"), "1", "hovering shows the X");
  await run("document.querySelector('.attach-x').click()");
  await sleep(100);
  assert.equal(await run("!!document.querySelector('.composer-attach')"), false, "the X removed the attachment");

  const send = await run("(b => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, radius: getComputedStyle(b).borderRadius }; })(document.querySelector('.send-btn'))");
  assert.equal(send.w, send.h, "send is as wide as it is tall");
  assert.equal(send.radius, "50%");
});

test("sending from the welcome screen moves the composer down in a view transition", async () => {
  const { run } = await open("/app/");
  await until(run, "document.querySelector('.composer:not(.is-docked) textarea')", "the welcome composer", 10000);
  assert.equal(await run("getComputedStyle(document.querySelector('.composer')).viewTransitionName"), "composer");
  await run(`(() => {
    window.__transitions = 0;
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => { window.__transitions += 1; return start(update); };
  })()`);
  await run(typeInComposer("A wide shot of a harbour at dawn"));
  await until(run, "document.querySelector('.composer-row textarea').value.length > 0", "the typed draft", 5000);
  await sleep(100);
  await run("document.querySelector('.composer-row textarea').closest('form').requestSubmit()");
  await until(run, "document.querySelector('.composer.is-docked')", "the docked composer", 10000);
  assert.equal(await run("window.__transitions"), 1, "the send ran in one view transition");
});

test("settings sit centred as one block with their section list, beside the chat list", async () => {
  const { run } = await open("/app/settings/notifications/");
  await until(run, "document.querySelector('.set-shell .set-body')", "the settings page", 10000);
  const gaps = await run(`(() => {
    const page = document.querySelector('.settings');
    const area = page.getBoundingClientRect();
    const left = page.querySelector('.set-side').getBoundingClientRect();
    const right = page.querySelector('.set-main').getBoundingClientRect();
    const style = getComputedStyle(page);
    const inner = { left: area.left + parseFloat(style.paddingLeft), right: area.left + page.clientWidth - parseFloat(style.paddingRight) };
    return { left: left.left - inner.left, right: inner.right - right.right, navTop: left.top, mainTop: right.top, navRight: left.right, mainLeft: right.left };
  })()`);
  assert.ok(Math.abs(gaps.left - gaps.right) <= 2, `equal gaps either side: ${JSON.stringify(gaps)}`);
  assert.ok(gaps.left > 20, `the block is centred, not pushed to an edge: ${JSON.stringify(gaps)}`);
  assert.ok(gaps.mainLeft >= gaps.navRight, "the list and the page sit side by side");
  assert.ok(Math.abs(gaps.navTop - gaps.mainTop) < 20, "they start at the same height");
  assert.match(await run("document.querySelector('.set-side [aria-current=page]').textContent"), /Notifications/);
  assert.ok(await run("document.querySelectorAll('.sidebar .chat-item').length > 0"), "the sidebar lists the chats on a settings page");
  assert.equal(await run("document.querySelector('.sidebar .side-scroll').getAttribute('aria-label')"), "Chats");

  await run("[...document.querySelectorAll('.set-side-link')].find((link) => link.textContent.includes('Interface')).click()");
  await until(run, "document.querySelector('.set-side [aria-current=page]')?.textContent.includes('Interface')", "the selected settings section", 5000);
  assert.equal(await run("document.querySelector('#set-title').textContent"), "Interface");
});

test("phone settings use section chips and keep chats in the sidebar drawer", async () => {
  const { run } = await open("/app/");
  await startChat(run, "A handheld shot of a lighthouse");
  await run(`(() => {
    const frame = document.createElement("iframe");
    frame.title = "Phone settings check";
    frame.style.cssText = "position:fixed;left:-2000px;top:0;width:390px;height:844px;border:0";
    frame.src = "/app/settings/notifications/";
    window.__settingsFrame = document.body.appendChild(frame);
  })()`);
  await until(run, "!!window.__settingsFrame?.contentDocument?.querySelector('.set-shell .set-body')", "the narrow settings page", 10000);
  const layout = await run(`(() => {
    const doc = window.__settingsFrame.contentDocument;
    return {
      side: getComputedStyle(doc.querySelector(".set-side")).display,
      chips: getComputedStyle(doc.querySelector(".set-chips")).display,
      active: doc.querySelector(".set-chips [aria-current=page]")?.textContent.trim(),
      chatsLabel: doc.querySelector(".sidebar .side-scroll").getAttribute("aria-label"),
      sidebar: getComputedStyle(doc.querySelector(".sidebar")).visibility,
    };
  })()`);
  assert.deepEqual(layout, { side: "none", chips: "flex", active: "Notifications", chatsLabel: "Chats", sidebar: "hidden" });
  await run("window.__settingsFrame.contentDocument.querySelector('.drawer-btn').click()");
  await until(run, `(() => { const doc = window.__settingsFrame.contentDocument; return doc.querySelector(".app").classList.contains("drawer-open") && getComputedStyle(doc.querySelector(".sidebar")).visibility === "visible" && doc.querySelectorAll(".sidebar .chat-item").length > 0; })()`, "the chat list in the open drawer", 5000);
  await run("window.__settingsFrame.contentDocument.querySelector('.chat-item .side-link').click()");
  await until(run, `(() => { const doc = window.__settingsFrame.contentDocument; return !doc.querySelector(".app").classList.contains("drawer-open") && !!doc.querySelector(".thread-head h1"); })()`, "the selected chat and closed drawer", 5000);
  await run("window.__settingsFrame.remove()");
});

/** Type into the composer and send it. */
async function say(run, text) {
  await run(typeInComposer(text));
  await until(run, "document.querySelector('.composer-row textarea').value.length > 0", "the typed draft", 5000);
  await sleep(100);
  await run("document.querySelector('.composer-row textarea').closest('form').requestSubmit()");
}

/** Send a first message from the welcome screen and return the new chat's id once its header shows. */
async function startChat(run, text) {
  await until(run, "document.querySelector('.composer:not(.is-docked) textarea')", "the welcome composer", 10000);
  await say(run, text);
  await until(run, "document.querySelector('.thread-head h1')", "the chat header", 10000);
  return until(run, "document.querySelector('.chat-item.is-on')?.dataset.chat", "the new chat's row", 10000);
}

test("the chat header has custom tooltips, a pen and a trash, no three-dot menu, and no count line", async () => {
  const { run, hover } = await open("/app/");
  await startChat(run, "A slow dolly-in on a lighthouse");
  const headerDelete = ".thread-head .head-del";
  assert.equal(await run("!!document.querySelector('.thread-head [aria-label=\"Chat options\"]')"), false, "the options button is gone");
  assert.equal(await run("document.querySelectorAll('.thread-head button').length"), 2, "the header has just the pen and the trash");
  assert.ok(await run("!!document.querySelector('.thread-head [aria-label=\"Rename chat\"]')"), "the pen is there");
  assert.ok(await run(`!!document.querySelector(${JSON.stringify(headerDelete)})`), "the trash is there");
  assert.equal(await run(`document.querySelector(${JSON.stringify(headerDelete)}).hasAttribute('title')`), false, "the trash has no native browser tooltip");
  assert.equal(await run(`document.querySelector(${JSON.stringify(headerDelete)}).dataset.tip`), "Hold for 1 second to delete");
  await until(
    run,
    `(() => {
      const button = document.querySelector(${JSON.stringify(headerDelete)});
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return button === hit || button.contains(hit);
    })()`,
    "the header trash is exposed for hover",
    5000,
  );
  await hover(headerDelete);
  await until(run, `document.querySelector(${JSON.stringify(headerDelete)}).matches(':hover')`, "the header trash hover", 3000);
  await until(run, `Number(getComputedStyle(document.querySelector(${JSON.stringify(headerDelete)}), "::after").opacity) > 0.9`, "the header tooltip to finish fading in", 5000);
  const tooltipState = await run(`(() => {
    const button = document.querySelector(${JSON.stringify(headerDelete)});
    const tooltip = getComputedStyle(button, "::after");
    const bounds = button.getBoundingClientRect();
    const width = parseFloat(tooltip.width);
    const height = parseFloat(tooltip.height);
    const top = tooltip.top !== "auto" ? bounds.top + parseFloat(tooltip.top) : bounds.bottom - parseFloat(tooltip.bottom) - height;
    const right = parseFloat(tooltip.right);
    const left = Number.isFinite(right) ? bounds.right - right - width : bounds.left + bounds.width / 2 - width / 2;
    const box = { left, top, right: left + width, bottom: top + height };
    let clippingAncestor = null;
    for (let node = button; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const clipsX = style.overflowX !== "visible" && (box.left < rect.left || box.right > rect.right);
      const clipsY = style.overflowY !== "visible" && (box.top < rect.top || box.bottom > rect.bottom);
      if (clipsX || clipsY) {
        clippingAncestor = node.className || node.tagName;
        break;
      }
    }
    return { hovered: button.matches(":hover"), content: tooltip.content, position: tooltip.position, visibility: tooltip.visibility, opacity: Number(tooltip.opacity), box, clippingAncestor };
  })()`);
  assert.ok(tooltipState.hovered, `the delete button is hovered: ${JSON.stringify(tooltipState)}`);
  assert.ok(tooltipState.content.includes("Hold for 1 second to delete"), `custom tooltip state: ${JSON.stringify(tooltipState)}`);
  assert.equal(tooltipState.position, "absolute", `the tooltip is positioned: ${JSON.stringify(tooltipState)}`);
  assert.equal(tooltipState.visibility, "visible", `the tooltip is visible: ${JSON.stringify(tooltipState)}`);
  assert.ok(tooltipState.opacity > 0.9, `the tooltip animation has finished: ${JSON.stringify(tooltipState)}`);
  assert.equal(tooltipState.clippingAncestor, null, `no ancestor clips the tooltip: ${JSON.stringify(tooltipState)}`);
  assert.equal(await run("/\\d+ messages? ·/.test(document.querySelector('.chat').innerText)"), false, "the count line is gone");
  assert.equal(await run("[...document.querySelectorAll('.chat *')].some((el) => el.children.length === 0 && /\\d+ messages? ·/.test(el.textContent))"), false);
});

/** Click the header pen, type a title and press Enter (save) or Escape (cancel). */
async function headerRename(run, value, key) {
  await run("document.querySelector('.thread-head [aria-label=\"Rename chat\"]').click()");
  await until(run, "document.querySelector('.thread-head input') === document.activeElement", "the title input", 5000);
  assert.equal(await run("!!document.querySelector('[role=dialog], [role=menu]')"), false, "no popup opens");
  await run(`(() => {
    const box = document.querySelector('.thread-head input');
    box.value = ${JSON.stringify(value)};
    box.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
  })()`);
}

/** Reload the studio, open the chat and wait for the title the server kept. */
async function titleAfterReload(id, title) {
  const { run } = await open("/app/");
  const row = `.chat-item[data-chat="${id}"]`;
  await until(run, `document.querySelector('${row}')`, "the chat in the sidebar after a reload", 10000);
  await run(`document.querySelector('${row} .side-link').click()`);
  await until(run, `document.querySelector('.thread-head h1')?.textContent === ${JSON.stringify(title)}`, "the saved title", 5000);
}

test("the header pen renames the chat in place, Escape cancels, and the title survives a reload", async () => {
  const { run } = await open("/app/");
  const id = await startChat(run, "A tracking shot along a pier");
  const title = "Pier shot, renamed";
  const original = await run("document.querySelector('.chat-item.is-on .side-text').textContent");
  await headerRename(run, "Never saved", "Escape");
  await until(run, "!document.querySelector('.thread-head input')", "the input to close", 5000);
  assert.equal(await run("document.querySelector('.thread-head h1').textContent"), original, "Escape keeps the old title");

  await headerRename(run, title, "Enter");
  await until(run, `document.querySelector('.thread-head h1')?.textContent === ${JSON.stringify(title)}`, "the new title in the header", 5000);
  await sleep(1500);
  await titleAfterReload(id, title);
});

test("a chat renamed while Kinemi is still answering keeps the owner's name", async () => {
  const { run } = await open("/app/");
  // a long first message: the built-in assistant takes ~1.4s, so the rename lands before its reply
  const id = await startChat(run, "A slow tracking shot along a wooden pier at dusk, waves under the boards, gulls overhead, lamps on");
  const title = "Named before the reply";
  await headerRename(run, title, "Enter");
  assert.equal(await run("!!document.querySelector('.call')"), false, "the rename happened before the reply");
  await until(run, "!!document.querySelector('.call')", "the reply with its shot", 10000);
  await sleep(1500);
  assert.equal(await run("document.querySelector('.thread-head h1').textContent"), title, "the reply does not rename the chat");
  await titleAfterReload(id, title);
});

test("holding the header's trash fills a red bar along its top edge and deletes the chat after a second", async () => {
  const { run, hover, away, shot } = await open("/app/");
  const id = await startChat(run, "A crane shot over a market");
  const row = `.chat-item[data-chat="${id}"]`;
  await away();
  await sleep(300);

  const press = (down) =>
    run(`(() => {
      const el = document.querySelector('.thread-head .head-del');
      el.dispatchEvent(new PointerEvent('${down ? "pointerdown" : "pointerup"}', { bubbles: true, button: 0, pointerId: 1, isPrimary: true }));
      return true;
    })()`);
  await hover(".thread-head .head-del");
  await sleep(1200);
  assert.equal(await run("document.querySelector('.thread-head.is-holding')"), null, "hovering alone never fills the bar");
  assert.ok(await run(`!!document.querySelector('${row}')`), "hovering alone never deletes the chat");

  await press(true);
  await sleep(400);
  const bar = await run(`(() => {
    const head = document.querySelector('.thread-head').getBoundingClientRect();
    const fill = document.querySelector('.head-fill').getBoundingClientRect();
    return { top: fill.top - head.top, height: fill.height, span: getComputedStyle(document.querySelector('.head-fill')).transitionDuration, colour: getComputedStyle(document.querySelector('.head-fill')).backgroundColor, holding: document.querySelector('.thread-head').classList.contains('is-holding') };
  })()`);
  assert.ok(bar.holding, "the header is holding");
  assert.equal(bar.top, 0, "the bar sits on the header's top edge");
  assert.ok(bar.height >= 2, `the bar has a thickness: ${JSON.stringify(bar)}`);
  assert.equal(bar.span, "1s", "the bar fills over one second");
  assert.equal(bar.colour, "rgb(229, 72, 77)", "the bar is red");
  await press(false);
  await sleep(1100);
  assert.ok(await run(`!!document.querySelector('${row}')`), "releasing early keeps the chat");
  assert.equal(await run("document.querySelector('.thread-head.is-holding')"), null, "the bar empties");

  await press(true);
  await shot("chat-header-hold");
  await sleep(1300);
  assert.equal(await run(`!!document.querySelector('${row}')`), false, "a full second deletes the chat");
  await until(run, "[...document.querySelectorAll('.toast button')].find((b) => b.textContent.includes('Undo'))", "the Undo toast", 5000);
  await run("[...document.querySelectorAll('.toast button')].find((b) => b.textContent.includes('Undo')).click()");
  await until(run, `!!document.querySelector('${row}')`, "the restored chat", 5000);
});

test("Soul and AI Cast fields have accessible names", async () => {
  const soul = await open("/app/tools/soul/");
  await until(soul.run, "document.querySelector('.ws-controls textarea')", "the Soul sentence field", 5000);
  assert.equal(
    await soul.run("document.querySelector('.ws-controls textarea').getAttribute('aria-label')"),
    "One sentence",
  );

  const cast = await open("/app/tools/ai-cast/");
  await until(cast.run, "document.querySelector('.ws-controls input.input')", "the AI Cast name field", 5000);
  assert.equal(await cast.run("document.querySelector('.ws-controls input.input').getAttribute('aria-label')"), "Name");
  assert.equal(await cast.run("document.querySelector('.ws-controls textarea').getAttribute('aria-label')"), "Look");
});

test("no page logged a console error", () => {
  assert.deepEqual(errors, []);
});
