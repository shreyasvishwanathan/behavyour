const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

async function loadPage(name, respond, search = "?id=saved-tab") {
  const elements = new Map();
  const timers = new Map();
  const windowListeners = new Map();
  const messages = [];
  let now = 10000;
  let timerId = 0;
  for (const match of readFileSync(join(__dirname, `../${name}.html`), "utf8").matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const classes = new Set((match[0].match(/\bclass="([^"]*)"/)?.[1] || "").split(/\s+/));
    elements.set(match[1], {
      textContent: "", value: "", disabled: /\bdisabled\b/.test(match[0]), focusCount: 0,
      listeners: {}, attributes: {},
      classList: {
        add: (name) => classes.add(name), remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
        toggle(name, force) {
          const show = force === undefined ? !classes.has(name) : force;
          if (show) classes.add(name); else classes.delete(name);
        }
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      focus() { this.focusCount++; }
    });
  }
  const context = vm.createContext({
    URLSearchParams,
    Date: class extends Date { static now() { return now; } },
    document: { getElementById: (id) => {
      assert.ok(elements.has(id), `Missing #${id} in ${name}.html`);
      return elements.get(id);
    } },
    window: {
      location: { search }, close() {},
      addEventListener: (type, fn) => windowListeners.set(type, fn),
      removeEventListener: (type) => windowListeners.delete(type)
    },
    setInterval: (fn) => { timers.set(++timerId, fn); return timerId; },
    clearInterval: (id) => timers.delete(id),
    chrome: {
      tabs: { query: async () => [{ url: "https://example.com" }] },
      runtime: { sendMessage: async (message) => {
        messages.push(message);
        return respond(message, now);
      }, openOptionsPage() {} },
      storage: { local: { get: async () => ({}), set: async () => {} } },
      permissions: { request: async () => true }
    }
  });
  vm.runInContext(readFileSync(join(__dirname, `../${name}.js`), "utf8"), context);
  await new Promise(setImmediate);
  return {
    context, timers, messages, windowListeners, get: (id) => elements.get(id),
    advance(milliseconds) {
      now += milliseconds;
      for (const fn of [...timers.values()]) fn();
    }
  };
}

function pauseState() {
  return {
    ok: true, lockUntil: 0,
    item: { sourceTitle: "My task", destinationHost: "example.com", destinationUrl: "https://example.com" }
  };
}

test("popup keeps protection locked until the timer ends and reviews the oldest saved tab", async () => {
  const state = {
    enabled: true, lockUntil: 15000, stats: { days: {} },
    pendingTabs: [{ id: "newer", queuedAt: 200 }, { id: "older", queuedAt: 100, destinationHost: "example.com" }]
  };
  const page = await loadPage("popup", (message) => message.type === "getState" ? state : { ok: true });
  assert.equal(page.get("toggle").disabled, true);
  assert.equal(page.get("timer").textContent, "0:05");
  page.advance(5000);
  assert.equal(page.get("toggle").disabled, false);
  assert.equal(page.get("timer").textContent, "Ready");
  await page.get("reviewPending").listeners.click();
  assert.equal(page.messages.at(-1).type, "reviewPendingTab");
  assert.equal(page.messages.at(-1).queueId, "older");
  assert.equal(Object.keys(page.messages.at(-1)).length, 2);
});

test("pause ignores small pointer jitter and completed timers release focus", async () => {
  const page = await loadPage("pause", (message, now) => message.type === "getPauseContext"
    ? pauseState() : { ok: true, decisionReadyAt: now - 1 });
  page.windowListeners.get("pointermove")({ clientX: 0, clientY: 0 });
  page.advance(4000);
  page.windowListeners.get("pointermove")({ clientX: 2, clientY: 0 });
  page.advance(999);
  assert.equal(page.get("resetStep").classList.contains("hidden"), false);
  page.advance(1);
  assert.equal(page.get("resetStep").classList.contains("hidden"), true);
  assert.equal(page.windowListeners.has("pointermove"), false);
  assert.equal(page.timers.size, 0, "Expired lock must not leave an interval running");
  page.get("tabIntent").value = "Find a source for my work";
  await page.get("commitIntentButton").listeners.click();
  assert.equal(page.get("openButton").disabled, false);
  assert.equal(page.timers.size, 0, "Expired reflection must not repeatedly focus the open button");
  page.advance(1000);
  assert.equal(page.get("openButton").focusCount, 1);
});

test("failed pause decisions remain retryable and a new lock requires a fresh purpose", async () => {
  let failure = true;
  const page = await loadPage("pause", (message, now) => {
    if (message.type === "getPauseContext") return pauseState();
    if (failure) throw new Error("worker unavailable");
    return { ok: false, waiting: true, lockUntil: now + 5000, error: "A newer tab pause is active." };
  });
  page.advance(5000);
  page.get("tabIntent").value = "Find a source for my work";
  await page.get("commitIntentButton").listeners.click();
  assert.equal(page.get("commitIntentButton").disabled, false);
  assert.match(page.get("errorMessage").textContent, /Please try again/);
  await page.get("openButton").listeners.click();
  assert.equal(page.get("openButton").disabled, false);
  failure = false;
  await page.get("openButton").listeners.click();
  assert.equal(page.get("openButton").disabled, true);
  assert.equal(page.get("intentSection").classList.contains("hidden"), true);
  page.advance(5000);
  assert.equal(page.get("intentSection").classList.contains("hidden"), false);
  assert.equal(page.get("tabIntent").disabled, false);
  assert.equal(page.get("reflectionStep").classList.contains("hidden"), true);
});

test("unavailable saved tabs show a recoverable message instead of a stalled countdown", async () => {
  const page = await loadPage("pause", () => { throw new Error("Reload this page to try again."); });
  assert.equal(page.get("resetStep").classList.contains("hidden"), true);
  assert.equal(page.get("decisionStep").classList.contains("hidden"), false);
  assert.equal(page.get("returnButton").disabled, true);
  assert.match(page.get("errorMessage").textContent, /Reload/);
  assert.equal(page.timers.size, 0);
});
