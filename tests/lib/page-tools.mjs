/** Page-driving helpers the browser suites share: fields, buttons, waits and screenshots. */
import { join } from "node:path";

/** React ignores a plain value assignment, so go through the native setter and fire an input event. */
const SET_VALUE = `(element, value) => {
  const prototype =
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}`;

/**
 * Record every change of a shot's status chip in the page. The after test can then prove the run
 * order from the log instead of racing the queue with its own polls.
 */
export const RECORD_STATUSES = `(() => {
  const read = () =>
    [...document.querySelectorAll("section")]
      .map((card) => ({
        title: card.querySelector("h2")?.textContent.trim() ?? "",
        status: card.querySelector("header span")?.textContent.trim() ?? "",
      }))
      .filter((shot) => /^Shot \\d+$/.test(shot.title));
  const note = () => {
    const shots = read();
    const last = window.__shotLog.at(-1);
    if (!last || shots.some((shot, at) => shot.status !== last.shots[at]?.status)) {
      window.__shotLog.push({ at: performance.now(), shots });
    }
  };
  window.__shotObserver?.disconnect();
  window.__shotLog = [];
  window.__shotObserver = new MutationObserver(note);
  window.__shotObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  note();
  return window.__shotLog.length;
})()`;

/** Bind the helpers to one browser and screenshot folder. */
export function pageTools(browser, screenshotDir) {
  /** Keep one screenshot per route as evidence for the report. */
  function capture(sessionId, name) {
    return browser.capture(sessionId, join(screenshotDir, `${name}.png`));
  }

  /** Write into the field a label names, the way a person typing would. */
  async function setField(sessionId, labelText, value) {
    await browser.evaluate(
      sessionId,
      `(() => {
        const setValue = ${SET_VALUE};
        const label = [...document.querySelectorAll("label")].find((node) => node.textContent.trim() === ${JSON.stringify(labelText)});
        if (!label) throw new Error("no field labelled " + ${JSON.stringify(labelText)});
        const field = document.getElementById(label.htmlFor);
        if (!field) throw new Error("the label for " + ${JSON.stringify(labelText)} + " points at no field");
        setValue(field, ${JSON.stringify(value)});
        return field.value;
      })()`,
    );
  }

  /** Write into the Prompt field of the shot card headed "Shot N", the way a person typing would. */
  async function setShotPrompt(sessionId, index, value) {
    const title = `Shot ${index}`;
    await browser.evaluate(
      sessionId,
      `(() => {
        const setValue = ${SET_VALUE};
        const card = [...document.querySelectorAll("section")].find(
          (node) => node.querySelector("h2")?.textContent.trim() === ${JSON.stringify(title)},
        );
        if (!card) throw new Error("no card headed " + ${JSON.stringify(title)});
        const label = [...card.querySelectorAll("label")].find(
          (node) => node.textContent.trim() === "Prompt",
        );
        if (!label) throw new Error("the card " + ${JSON.stringify(title)} + " has no Prompt field");
        const field = document.getElementById(label.htmlFor);
        if (!field) throw new Error("the Prompt label of " + ${JSON.stringify(title)} + " points at no field");
        setValue(field, ${JSON.stringify(value)});
        return field.value;
      })()`,
    );
  }

  /** The status chip of the shot card headed "Shot N". */
  function shotStatus(index) {
    return `(() => {
      const card = [...document.querySelectorAll("section")].find(
        (node) => node.querySelector("h2")?.textContent.trim() === "Shot ${index}",
      );
      return card?.querySelector("header span")?.textContent.trim() ?? "missing";
    })()`;
  }

  /** The status the shot card really holds (ShotStatus), independent of the label it shows. */
  function shotState(index) {
    return `(() => {
      const card = [...document.querySelectorAll("section")].find(
        (node) => node.querySelector("h2")?.textContent.trim() === "Shot ${index}",
      );
      return card?.querySelector("header span")?.getAttribute("data-status") ?? "missing";
    })()`;
  }

  /** Click the one enabled button with this exact text. */
  async function clickButton(sessionId, text) {
    await browser.evaluate(
      sessionId,
      `(() => {
        const button = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === ${JSON.stringify(text)});
        if (!button) throw new Error("no button " + ${JSON.stringify(text)});
        if (button.disabled) throw new Error("button is disabled: " + ${JSON.stringify(text)});
        button.click();
        return true;
      })()`,
    );
  }

  /** Poll an expression in the page until it is true, then fail with the message it was waiting for. */
  async function waitFor(sessionId, expression, message, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await browser.evaluate(sessionId, expression)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`timed out waiting: ${message}`);
  }

  /** Record the next POST /api/generate body under a window key, then let the request through. */
  async function watchGenerate(sessionId, key) {
    await browser.evaluate(
      sessionId,
      `(() => {
        const original = window.fetch;
        window[${JSON.stringify(key)}] = undefined;
        window.fetch = async (input, init) => {
          if (String(input) === "/api/generate" && init?.method === "POST") {
            window[${JSON.stringify(key)}] = JSON.parse(init.body);
          }
          return original(input, init);
        };
        return true;
      })()`,
    );
  }

  /** The Generate button's disabled state and title, or undefined when the page has none. */
  function generateButton(sessionId) {
    return browser.evaluate(
      sessionId,
      `(() => {
        const button = [...document.querySelectorAll("button")].find((node) => node.textContent.trim() === "Generate");
        return button ? { disabled: button.disabled, title: button.title } : undefined;
      })()`,
    );
  }

  return {
    capture,
    setField,
    setShotPrompt,
    shotStatus,
    shotState,
    clickButton,
    waitFor,
    watchGenerate,
    generateButton,
  };
}
