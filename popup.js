const getElement = (id) => document.getElementById(id);
let countdownInterval;
let lastRenderedState;
let oldestPendingTabId = null;

function getTodayKey() {
  // Storage buckets use the local date, not UTC.
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function formatRemainingTime(milliseconds) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function showMessage(id, message = "") {
  getElement(id).textContent = message;
  getElement(id).classList.toggle("hidden", !message);
}

function drawCountdown(state) {
  const remaining = Math.max(0, state.lockUntil - Date.now());
  getElement("timer").textContent = !state.enabled
    ? "Off"
    : remaining > 0 ? formatRemainingTime(remaining) : "Ready";
  getElement("status").textContent = !state.enabled
    ? "Tracking and tab pauses are off."
    : remaining > 0
      ? "Stay with this tab. New tabs can be reviewed when the timer ends."
      : "You can open a new tab.";
  getElement("toggle").disabled = remaining > 0;
  getElement("toggle").title = remaining > 0
    ? "Protection stays on until the tab pause ends."
    : "Turn Behavyour on or off";
}

function findOldestPendingTab(items) {
  return items.reduce((oldest, item) => {
    if (!item?.id) return oldest;
    return !oldest || (Number(item.queuedAt) || 0) < (Number(oldest.queuedAt) || 0)
      ? item : oldest;
  }, null);
}

function describeLearnedHistoryPattern(entry) {
  const evidence = [];
  const detours = entry.netDetours ?? entry.detours;
  if (detours) evidence.push(`${detours} return detour${detours === 1 ? "" : "s"}`);
  if (entry.briefExits) evidence.push(`${entry.briefExits} brief visit${entry.briefExits === 1 ? "" : "s"}`);
  if (entry.repeatChecks) evidence.push(`${entry.repeatChecks} repeat check${entry.repeatChecks === 1 ? "" : "s"}`);
  return `${entry.domain}: ${evidence.slice(0, 2).join(" and ") || "a recurring pattern"} in the last 30 days. Review the evidence or mark this site neutral in the dashboard.`;
}

function renderPendingQueue(state) {
  const items = Array.isArray(state.pendingTabs) ? state.pendingTabs : [];
  const oldest = findOldestPendingTab(items);
  oldestPendingTabId = oldest?.id || null;
  getElement("pendingCount").textContent = String(items.length);
  getElement("pendingCount").setAttribute(
    "aria-label", `${items.length} paused tab${items.length === 1 ? "" : "s"} waiting`
  );
  const destination = oldest?.destinationHost || oldest?.title || "a blank new tab";
  getElement("pendingSummary").textContent = oldest
    ? `First waiting: ${destination}. Saved destinations stay on this device for seven days.`
    : "No tabs are waiting. Saved destinations stay on this device for seven days.";
  getElement("reviewPending").classList.toggle("hidden", !oldest);
  getElement("reviewPending").disabled = !oldest;
}

async function renderPopup() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const state = await chrome.runtime.sendMessage({ type: "getState", url: activeTab?.url });
  if (!state || state.ok === false) {
    throw new Error(state?.error || "The extension state is unavailable.");
  }
  lastRenderedState = state;
  const { historyIntroDismissed } = await chrome.storage.local.get("historyIntroDismissed");
  getElement("historyIntro").classList.toggle(
    "hidden", Boolean(state.historyInsightsEnabled || historyIntroDismissed)
  );
  getElement("toggle").textContent = state.enabled ? "On" : "Off";
  getElement("toggle").classList.toggle("off", !state.enabled);
  getElement("toggle").setAttribute("aria-pressed", String(state.enabled));

  const today = state.stats.days[getTodayKey()] || {};
  getElement("wanders").textContent = today.pointerWanders || 0;
  getElement("clicks").textContent = today.lowValueClicks || 0;
  getElement("opened").textContent = today.tabsOpened || 0;
  getElement("blocked").textContent = today.blockedTabs || 0;
  getElement("categoryCard").classList.toggle("hidden", !state.category);
  getElement("category").textContent = state.category ? `Site category: ${state.category}` : "";

  const learned = state.learnedDistractions?.[0];
  getElement("learnedCard").classList.toggle("hidden", !state.historyInsightsEnabled || !learned);
  getElement("learnedText").textContent = learned ? describeLearnedHistoryPattern(learned) : "";
  renderPendingQueue(state);
  clearInterval(countdownInterval);
  drawCountdown(state);
  countdownInterval = setInterval(() => drawCountdown(state), 1000);
}

async function handleToggleClick() {
  if (!lastRenderedState) return;
  showMessage("toggleMessage");
  getElement("toggle").disabled = true;
  try {
    // These messages switch protection off/on; they do not control the tab timer.
    const response = await chrome.runtime.sendMessage({
      type: lastRenderedState.enabled ? "pause" : "resume"
    });
    await renderPopup();
    if (!response?.ok) {
      showMessage("toggleMessage", response?.locked
        ? "Protection stays on until the current tab pause ends."
        : response?.error || "Could not change this setting. Please try again.");
    }
  } catch {
    showMessage("toggleMessage", "Could not change this setting. Please try again.");
    drawCountdown(lastRenderedState);
  }
}

async function handlePendingReviewClick() {
  showMessage("pendingMessage");
  getElement("reviewPending").disabled = true;
  try {
    // The background worker owns the URL; the popup sends only a queue id.
    if (!oldestPendingTabId) throw new Error("There is no paused tab to review.");
    const response = await chrome.runtime.sendMessage({
      type: "reviewPendingTab", queueId: oldestPendingTabId
    });
    if (!response?.ok) {
      await renderPopup();
      throw new Error(response?.error || "Could not open this saved tab for review.");
    }
    window.close();
  } catch (error) {
    showMessage("pendingMessage", error.message || "Could not open this saved tab. Please try again.");
    getElement("reviewPending").disabled = !oldestPendingTabId;
  }
}

async function handleEnableHistoryClick() {
  showMessage("toggleMessage");
  getElement("enableHistory").disabled = true;
  try {
    // Permission requests must stay inside the user click handler.
    if (await chrome.permissions.request({ permissions: ["history"] })) {
      const response = await chrome.runtime.sendMessage({ type: "enableHistoryInsights" });
      if (!response?.ok) throw new Error(response?.error || "Could not enable history insights.");
      await renderPopup();
    }
  } catch (error) {
    showMessage("toggleMessage", error.message || "Could not enable history insights. Please try again.");
  } finally {
    getElement("enableHistory").disabled = false;
  }
}

async function handleDismissHistoryClick() {
  try {
    await chrome.storage.local.set({ historyIntroDismissed: true });
    getElement("historyIntro").classList.add("hidden");
  } catch {
    showMessage("toggleMessage", "Could not save this choice. Please try again.");
  }
}

getElement("toggle").addEventListener("click", handleToggleClick);
getElement("reviewPending").addEventListener("click", handlePendingReviewClick);
getElement("dashboard").addEventListener("click", () => chrome.runtime.openOptionsPage());
getElement("enableHistory").addEventListener("click", handleEnableHistoryClick);
getElement("dismissHistory").addEventListener("click", handleDismissHistoryClick);
renderPopup().catch(() => {
  showMessage("toggleMessage", "Could not load Behavyour. Close this popup and try again.");
});
