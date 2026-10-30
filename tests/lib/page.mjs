// Helpers shared by the browser suites: open a page with mouse and screenshot helpers, and wait
// for the page or the server to reach a state.
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SHOTS = join(tmpdir(), "kinemi-web-shots");
export const RENDER_TIMEOUT_MS = 30000;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until a check is truthy, and return its value. */
export async function poll(check, what, timeoutMs = RENDER_TIMEOUT_MS) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(300);
  }
}

/** Wait until an expression in the page is truthy, and return its value. */
export const until = (run, expression, what, timeoutMs) => poll(() => run(expression), what, timeoutMs);

/**
 * `open(path, viewport?)` for one suite: `ctx()` returns the suite's { browser, app }, and every
 * page's console errors land in `errors`. `viewport` is openPage's { width, height, mobile }.
 */
export function pageOpener(ctx, errors) {
  return async function open(path, viewport) {
    const { browser, app } = ctx();
    const page = await browser.openPage(`${app.base}${path}`, viewport);
    errors.push(...page.consoleErrors.map((e) => `${path}: ${e}`));
    const run = (expression) => browser.evaluate(page.sessionId, expression);
    const shot = (name) => browser.capture(page.sessionId, join(SHOTS, `${name}.png`));
    const mouse = (x, y) => browser.mouse(page.sessionId, x, y);
    /** Rest the mouse on an element's centre; the second move hits what the first hover revealed. */
    const hover = async (selector) => {
      const at = await run(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await mouse(at.x, at.y);
      await mouse(at.x + 1, at.y);
    };
    /** Park the mouse over the empty middle of the page. */
    const away = async () => {
      await mouse(900, 520);
      await mouse(901, 520);
    };
    return { run, shot, hover, away, mouse, consoleErrors: page.consoleErrors };
  };
}

/**
 * Put values in localStorage from the landing page. The studio's store only runs under /app, and a
 * studio tab saves over its own keys a moment after it boots, so a value written from a studio tab
 * can be lost. The landing page writes nothing, so what goes in here stays.
 */
export async function seedStorage(open, entries) {
  const page = await open("/");
  for (const [key, value] of Object.entries(entries)) {
    await page.run(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
  }
  for (const [key, value] of Object.entries(entries)) {
    const stored = await page.run(`localStorage.getItem(${JSON.stringify(key)})`);
    if (stored !== value) throw new Error(`${key} did not stay in localStorage`);
  }
}

/** Type into the composer the way a person does, so the draft signal sees it. */
export const typeInComposer = (text) => `(() => {
  const box = document.querySelector('.composer-row textarea');
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(box, ${JSON.stringify(text)});
  box.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
