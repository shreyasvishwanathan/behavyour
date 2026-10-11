const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

// Exercise data interpretation and settings persistence; real rendering is checked in Edge.
function dashboard() {
  const elements = new Map();
  function element() {
    return {
      textContent: "", value: "", children: [], checked: false,
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {}, addEventListener() {},
      classList: { add() {}, remove() {}, toggle() {} }
    };
  }
  const html = readFileSync(join(__dirname, "../dashboard.html"), "utf8");
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    assert.ok(!elements.has(match[1]), `Duplicate id: ${match[1]}`);
    elements.set(match[1], Object.assign(element(), {
      min: match[0].match(/\bmin="([^"]+)"/)?.[1],
      max: match[0].match(/\bmax="([^"]+)"/)?.[1]
    }));
  }
  const writes = [];
  let rejectSave = false;
  const context = vm.createContext({
    URL, Date, console,
    document: {
      getElementById(id) { assert.ok(elements.has(id), `Missing #${id}`); return elements.get(id); },
      createElement: element, createTextNode: (text) => ({ textContent: text })
    },
    window: { addEventListener() {} },
    chrome: { storage: { local: { set: async (value) => {
      if (rejectSave) throw new Error("Storage unavailable");
      writes.push(JSON.parse(JSON.stringify(value)));
    } } } }
  });
  const source = readFileSync(join(__dirname, "../dashboard.js"), "utf8");
  vm.runInContext(source.slice(0, source.indexOf('getElement("settingsForm").addEventListener')), context);
  return { context, elements, writes, failSave(value) { rejectSave = value; } };
}

test("dashboard uses local dates, avoids double counts, and distinguishes missing days", () => {
  const { context: d, elements: e } = dashboard();
  assert.equal(d.getDateKey(new Date(2026, 0, 2, 0, 15)), "2026-01-02");
  const day = { pointerWanders: 4, pointerLoops: 3, pointerReversals: 1, lowValueClicks: 2, repeatedClicks: 2, blockedTabs: 3, shortDetours: 1, infiniteFeedCheckpoints: 1, mouseResetsCompleted: 2, savedForLater: 1, intentPromptsCompleted: 2 };
  assert.equal(d.countMousePatterns(day), 6);
  assert.equal(d.countTabShifts(day), 4);
  assert.equal(d.countDeliberateSteps(day), 3);
  assert.equal(d.countDeliberateSteps({ ...day, intentionalOpens: 2 }), 5);
  assert.equal(d.getPatterns(day).reduce((n, p) => n + p.count, 0), 11);
  assert.equal(d.countSessionPatterns({ pointerLoops: 3, pointerReversals: 1, repeatedClicks: 2 }), 6);
  d.renderOverview({ enabled: true, stats: { days: {} } });
  assert.equal(e.get("todayMouse").textContent, "—");
  const state = { enabled: true, stats: { days: { [d.getDateKey(new Date())]: day } } };
  d.renderOverview(state);
  assert.match(e.get("dayHeadline").textContent, /Pointer movement/);
  assert.equal(e.get("todayMouse").textContent, 6);
  d.renderSevenDayPatterns(state);
  const rows = e.get("dailyRows").children;
  assert.equal(rows.length, 7);
  assert.equal(rows[0].children[1].textContent, "6");
  assert.equal(rows[1].children[1].textContent, "—");
  assert.match(d.buildHistoryEvidenceText({ detours: 5, netDetours: 0 }), /^0 short detours/);
});

test("settings normalize domains, reject invalid rules, and keep failed changes retryable", async () => {
  const { context: d, elements: e, writes, failSave } = dashboard();
  assert.deepEqual(Array.from(d.parseWhitelist("https://WWW.Example.com/path\nexample.com\n\nwork.test")), ["example.com", "work.test"]);
  assert.throws(() => d.parseWhitelist("javascript:alert(1)"), /address/);
  assert.throws(() => d.parseWhitelist("https://user:password@example.com"), /address/);
  assert.throws(() => d.parseCategoryRules("example.com = unknown"), /category/);
  assert.throws(() => d.parseCategoryRules("example.com = neutral = news"), /category/);
  assert.equal(d.parseCategoryRules("EXAMPLE.com = NEUTRAL")["example.com"], "neutral");
  d.renderSettings({ lockMinutes: 0, strictLock: false, screenToneEnabled: false });
  for (const field of e.values()) field.value = String(field.value);
  e.get("rules").value = "work.test = neutral";
  failSave(true);
  await d.saveSettings({ preventDefault() {} });
  assert.match(e.get("saved").textContent, /Not saved.*Storage unavailable/);
  assert.equal(e.get("settingsFields").disabled, false);
  assert.equal(e.get("rules").value, "work.test = neutral");
  failSave(false);
  await d.saveSettings({ preventDefault() {} });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].lockMinutes, 0);
  assert.equal(writes[0].strictLock, false);
  assert.equal(writes[0].categoryRules["work.test"], "neutral");
  assert.equal(e.get("saved").textContent, "Settings saved.");
  e.get("rules").value = "broken rule";
  await d.saveSettings({ preventDefault() {} });
  assert.equal(writes.length, 1, "Invalid text must never silently remove existing rules");
});
