const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function page() {
  const messages = [];
  let now = 100_000;
  let interval;
  let storageChanged;
  let mutations;
  let respond = () => ({ ok: true, coachEnabled: false });
  const document = { hidden: false };

  class Element {
    constructor(tag = "div") {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.style = { overflow: "auto" };
      this.attributes = {};
      this.listeners = {};
      this.value = "";
      this.rectangle = { width: 300, height: 200, top: 0, bottom: 200 };
    }
    append(child) { this.children.push(child); child.parent = this; }
    replaceChildren() { this.children = []; }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    focus() { document.activeElement = this; }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    hasAttribute(key) { return key in this.attributes; }
    matches(selector) {
      return selector.split(",").some(part => {
        const value = part.trim();
        if (value.startsWith("#")) return this.id === value.slice(1);
        if (value.startsWith(".")) return (this.className || "").split(" ").includes(value.slice(1));
        if (value === "button:not(:disabled)") return this.tagName === "BUTTON" && !this.disabled;
        return this.tagName.toLowerCase() === value;
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return this.rectangle; }
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
    removeEventListener(type, callback) {
      this.listeners[type] = (this.listeners[type] || []).filter(item => item !== callback);
    }
    async emit(type, event = {}) {
      await Promise.all((this.listeners[type] || []).map(callback => callback({ target: this, ...event })));
    }
  }
  class Image extends Element {
    constructor(src) { super("img"); this.complete = true; this.naturalWidth = 300; this.attributes.src = src; }
  }
  class Video extends Element {}
  document.body = new Element("body");
  document.documentElement = new Element("html");
  document.activeElement = document.body;
  document.createElement = tag => new Element(tag);
  document.addEventListener = () => {};
  const window = new Element();
  Object.assign(window, { innerWidth: 1000, innerHeight: 800, getSelection: () => null });
  const context = vm.createContext({
    document, window, Element, HTMLElement: Element, HTMLImageElement: Image,
    HTMLVideoElement: Video, HTMLMediaElement: { HAVE_CURRENT_DATA: 2 }, URL, Intl,
    Date: class extends Date { static now() { return now; } },
    location: { href: "https://example.com/" },
    performance: { getEntriesByType: () => [{ type: "navigate" }] },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    requestAnimationFrame: callback => callback(),
    setTimeout: () => 1, clearTimeout: () => {}, clearInterval: () => {},
    setInterval: callback => { interval = callback; return 1; },
    MutationObserver: class { constructor(callback) { mutations = callback; } observe() {} },
    chrome: {
      runtime: { sendMessage: async message => { messages.push(message); return respond(message); } },
      storage: { onChanged: { addListener: callback => { storageChanged = callback; } } }
    }
  });
  const source = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");
  vm.runInContext(source.replace(
    "  startInfiniteFeedObserver();\n  loadSettings();",
    `globalThis.api = { settings, updateSettings, shouldIgnorePointerEvent,
      countReflectionWords, showIntentPrompt, showDriftReflectionPrompt,
      startInfiniteFeedObserver, reportLinkDeparture };`
  ), context);
  context.api.updateSettings({ enabled: true });
  return {
    ...context.api, document, window, messages, Image,
    setResponse: callback => { respond = callback; },
    changeStorage: (changes, area = "local") => storageChanged(changes, area),
    mutate: records => mutations(records),
    finishReset: () => { now += 20_000; interval(); }
  };
}

test("settings stay synchronized and pointer safeguards remain active", () => {
  const p = page();
  p.changeStorage({ scrollMinutesBeforePrompt: { newValue: 30 }, mouseCoachEnabled: { newValue: false } });
  assert.equal(p.settings.scrollMinutesBeforePrompt, 10);
  assert.equal(p.settings.mouseCoachEnabled, false);
  p.changeStorage({ enabled: { newValue: false } }, "session");
  assert.equal(p.settings.enabled, true);
  assert.equal(p.shouldIgnorePointerEvent({ isTrusted: true, pointerType: "mouse" }), false);
  for (const pointerType of ["touch", "pen"]) {
    assert.equal(p.shouldIgnorePointerEvent({ isTrusted: true, pointerType }), true);
  }
  assert.equal(p.shouldIgnorePointerEvent({ isTrusted: false, pointerType: "mouse" }), true);
  p.document.activeElement = p.document.createElement("textarea");
  assert.equal(p.shouldIgnorePointerEvent({ isTrusted: true, pointerType: "mouse" }), true);
});

test("a failed intent save keeps the answer retryable, then restores focus after reset", async () => {
  const p = page();
  p.showIntentPrompt("event-1", "pointerLoops", 3);
  const overlay = p.document.body.querySelector("#behavyour-intent-overlay");
  const input = overlay.querySelector("textarea");
  const button = overlay.querySelector("button");
  input.value = "Compare the two options";
  await input.emit("input");
  assert.equal(button.disabled, false);
  p.setResponse(() => { throw new Error("Disconnected"); });
  await button.emit("click");
  assert.equal(button.disabled, false);
  assert.equal(input.value, "Compare the two options");
  assert.match(overlay.querySelector(".behavyour-prompt-guidance").textContent, /try again/);
  p.setResponse(() => ({ ok: true }));
  await button.emit("click");
  assert.equal(overlay.querySelector("h2").id, overlay.getAttribute("aria-labelledby"));
  p.finishReset();
  assert.equal(p.document.body.querySelector("#behavyour-intent-overlay"), null);
  assert.equal(p.document.body.style.overflow, "auto");
  assert.equal(p.document.activeElement, p.document.body);
  assert.equal(p.messages.at(-1).metric, "mouseResetsCompleted");
  assert.equal(p.messages.at(-1).data.triggerMetric, "pointerLoops");
});

test("feed reflections require words in both answers and retain their message contract", async () => {
  const p = page();
  assert.equal(p.countReflectionWords("... !!!"), 0);
  assert.equal(p.countReflectionWords("clear useful words"), 3);
  p.showDriftReflectionPrompt("event-2", 5);
  const overlay = p.document.body.querySelector("#behavyour-intent-overlay");
  const [initial, current] = overlay.querySelectorAll("textarea");
  const button = overlay.querySelector("button");
  initial.value = "purpose ".repeat(50);
  await initial.emit("input");
  assert.equal(button.disabled, true);
  current.value = "different";
  await current.emit("input");
  assert.equal(button.disabled, false);
  await button.emit("click");
  assert.equal(p.messages[0].type, "recordDriftReflection");
  assert.equal(p.messages[0].initialPoint, initial.value);
  assert.equal(p.messages[0].currentPoint, current.value);
});

test("feed discovery needs recent trusted scrolling, ignores tiny media and deduplicates sources", async () => {
  const p = page();
  p.startInfiniteFeedObserver();
  const add = nodes => p.mutate([{ type: "childList", addedNodes: nodes }]);
  add(Array.from({ length: 10 }, (_, i) => new p.Image(`before-scroll-${i}`)));
  assert.equal(p.messages.length, 0);
  await p.window.emit("wheel", { isTrusted: false });
  add(Array.from({ length: 10 }, (_, i) => new p.Image(`synthetic-scroll-${i}`)));
  assert.equal(p.messages.length, 0);
  await p.window.emit("wheel", { isTrusted: true });
  const tiny = new p.Image("icon");
  tiny.rectangle.width = 20;
  add([tiny, ...Array.from({ length: 10 }, () => new p.Image("same-image"))]);
  assert.equal(p.messages.length, 0);
  add(Array.from({ length: 8 }, (_, i) => new p.Image(`unique-${i}`)));
  const picture = p.document.createElement("picture");
  const source = p.document.createElement("source");
  source.setAttribute("srcset", "responsive-image 2x");
  picture.append(source);
  picture.append(new p.Image("picture-fallback"));
  p.mutate([{ type: "attributes", target: source }]);
  assert.equal(p.messages.length, 1);
  assert.equal(p.messages[0].metric, "infiniteFeedCheckpoints");
  assert.equal(p.messages[0].data.newMediaLoads, 10);
  assert.equal(p.messages[0].data.imageLoads, 10);
  assert.equal(p.messages[0].data.videoLoads, 0);
});

test("link departures exclude page anchors and send only the destination origin", () => {
  const p = page();
  const link = p.document.createElement("a");
  link.href = "https://example.com/#section";
  p.reportLinkDeparture(link);
  assert.equal(p.messages.length, 0);
  link.href = "https://other.example/article?private=query";
  p.reportLinkDeparture(link);
  assert.equal(p.messages[0].destinationUrl, "https://other.example");
});
