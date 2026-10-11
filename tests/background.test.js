const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { randomUUID } = require("node:crypto");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

test("background retains data and enforces shared activity and pause contracts", async () => {
  const local = {};
  const session = {};
  const storage = (data) => ({
    async get(defaults) {
      if (defaults === null) return structuredClone(data);
      if (typeof defaults === "string") return { [defaults]: structuredClone(data[defaults]) };
      return structuredClone({ ...defaults, ...data });
    },
    async set(changes) { Object.assign(data, structuredClone(changes)); }
  });
  const event = { addListener() {} };
  const tabActions = [];
  const chrome = {
    storage: { local: storage(local), session: storage(session) },
    runtime: {
      getURL: (path) => `chrome-extension://behavyour/${path}`,
      onInstalled: event,
      onMessage: event
    },
    permissions: { contains: async () => false, onRemoved: event },
    alarms: { create() {}, onAlarm: event },
    tabs: {
      onCreated: event, onUpdated: event, onActivated: event, onRemoved: event,
      update: async (id, changes) => tabActions.push({ id, ...changes }),
      remove: async (id) => tabActions.push({ removed: id })
    }
  };
  const worker = vm.createContext({ chrome, console, URL, Intl, crypto: { randomUUID } });
  vm.runInContext(readFileSync(join(__dirname, "../background.js"), "utf8"), worker);

  local.stats = { days: {}, totals: { tabsOpened: 9 } };
  local.pendingTabs = [{ id: "expired", queuedAt: 0 }, { id: "saved", queuedAt: Date.now() }];
  const state = await worker.getState();
  assert.equal(state.stats.totals.tabsOpened, 9);
  assert.equal(state.stats.totals.driftReflectionsCompleted, 0);
  assert.deepEqual(state.pendingTabs.map((item) => item.id), ["saved"]);
  assert.equal(worker.getCategoryForUrl("https://www.youtube.com/watch", state), "video");
  state.learnedDistractions = [{ domain: "youtube.com" }];
  assert.equal(worker.getCategoryForUrl("https://youtube.com", state), "learned distraction");
  state.categoryRules = { "youtube.com": "neutral" };
  assert.equal(worker.getCategoryForUrl("https://m.youtube.com", state), null);
  assert.equal(worker.domainMatches("notyoutube.com", "youtube.com"), false);
  assert.equal(worker.domainMatches("youtube.com.evil.test", "youtube.com"), false);

  const [pointerEvent] = await Promise.all([
    worker.recordActivity("pointerLoops", 1, { url: "https://example.com/private/path" }),
    worker.recordActivity("blankAreaClicks", 1)
  ]);
  assert.equal(local.stats.totals.pointerWanders, 1);
  assert.equal(local.stats.totals.lowValueClicks, 1);
  assert.equal(local.activitySessions[0].events.length, 2);
  assert.equal(pointerEvent.domain, "example.com");
  assert.equal(pointerEvent.url, undefined);
  assert.equal((await worker.attachIntentToActivity(pointerEvent.id, "short")).ok, false);
  await worker.attachIntentToActivity(pointerEvent.id, "Read the installation steps");
  await worker.attachIntentToActivity(pointerEvent.id, "Read the installation steps again");
  assert.equal(local.stats.totals.intentPromptsCompleted, 1);
  assert.equal(local.activitySessions[0].summary.intentPromptsCompleted, 1);

  const sender = { tab: { id: 7, url: "https://example.com" }, url: "https://example.com" };
  for (const amount of [-1, 0, 1.5, "2", NaN]) {
    assert.equal((await worker.handleMessage({ type: "behavior", metric: "pointerLoops", amount }, sender)).ok, false);
  }
  assert.equal((await worker.handleMessage(null, sender)).ok, false);
  assert.equal((await worker.handleMessage({ type: "behavior", metric: "madeUp" }, sender)).ok, false);

  const checkpoint = await worker.handleMessage({ type: "behavior", metric: "infiniteFeedCheckpoints" }, sender);
  assert.equal(checkpoint.shouldAskForIntent, true);
  assert.equal(session.pendingDriftReflections[7].eventId, checkpoint.eventId);
  assert.equal(worker.countReflectionWords("! ".repeat(50)), 0);
  const reflection = [checkpoint.eventId, "start ".repeat(25), "now ".repeat(25), 7];
  assert.equal((await worker.attachDriftReflection(...reflection)).stored, true);
  assert.equal((await worker.attachDriftReflection(...reflection)).stored, true);
  assert.equal(local.stats.totals.driftReflectionsCompleted, 1);
  assert.equal(session.pendingDriftReflections[7], undefined);
  assert.equal((await worker.attachDriftReflection("pruned-event", reflection[1], reflection[2], 7)).stored, false);

  for (const type of ["getPauseContext", "beginIntentionalOpen", "completeIntentionalOpen", "returnToTask", "saveForLater"]) {
    const response = await worker.handleMessage({ type, queueId: "saved", intent: "Read the documentation" }, sender);
    assert.match(response.error, /Only a Behavyour pause page/);
  }
  local.pendingTabs = [{
    id: "saved", tabId: 7, queuedAt: Date.now(), destinationUrl: "https://example.com/docs",
    requiredReflectionSeconds: 3, status: "waiting"
  }];
  const pauseSender = { ...sender, url: chrome.runtime.getURL("pause.html?id=saved") };
  local.lockUntil = Date.now() + 60_000;
  assert.equal((await worker.handleMessage({ type: "beginIntentionalOpen", queueId: "saved", intent: "Read the documentation" }, pauseSender)).waiting, true);
  local.lockUntil = 0;
  assert.equal((await worker.handleMessage({ type: "beginIntentionalOpen", queueId: "saved", intent: "Read the documentation" }, pauseSender)).ok, true);
  assert.equal((await worker.handleMessage({ type: "completeIntentionalOpen", queueId: "saved" }, pauseSender)).ok, false);
  local.pendingTabs[0].decisionReadyAt = Date.now() - 1;
  assert.equal((await worker.handleMessage({ type: "completeIntentionalOpen", queueId: "saved" }, pauseSender)).ok, true);
  assert.equal(local.pendingTabs.length, 0);
  assert.equal(local.stats.totals.intentionalOpens, 1);
  assert.equal(tabActions[0].url, "https://example.com/docs");

  const storedPattern = worker.prepareHistoryPatternForStorage({ domain: "example.com", lastSeen: Date.now(), episodes: 3 });
  assert.equal(storedPattern.lastSeen, undefined);
  assert.match(storedPattern.lastSeenDay, /^\d{4}-\d{2}-\d{2}$/);

  local.strictLock = false;
  local.lockUntil = 0;
  await worker.handleNewTabCreated({ id: 8, url: "https://example.com" });
  assert.equal(local.lockUntil, 0);
  local.strictLock = true;
  await worker.handleNewTabCreated({ id: 9, url: "https://example.com" });
  assert.ok(local.lockUntil > Date.now());
  const cooldown = local.lockUntil;
  local.whitelist = ["example.com"];
  await worker.handleNewTabCreated({ id: 10, url: "https://docs.example.com" });
  assert.equal(local.lockUntil, cooldown);
  assert.equal(local.pendingTabs.length, 0);
  await worker.handleNewTabCreated({ id: 11, url: "https://another.example" });
  assert.equal(local.stats.totals.blockedTabs, 1);
  assert.equal(local.pendingTabs[0].destinationUrl, "https://another.example");
  assert.match(tabActions.at(-1).url, /^chrome-extension:\/\/behavyour\/pause.html\?id=/);

  local.enabled = false;
  const priorTotals = structuredClone(local.stats.totals);
  assert.equal((await worker.handleMessage({ type: "behavior", metric: "pointerLoops" }, sender)).ignored, true);
  assert.deepEqual(local.stats.totals, priorTotals);
});
