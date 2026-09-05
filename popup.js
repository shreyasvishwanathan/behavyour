/*
 * TOOLBAR POPUP CONTROLLER
 * ------------------------
 * popup.html provides the visible elements. This file reads extension state,
 * fills those elements with live values, and reacts to button clicks.
 */

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

// A descriptive shortcut used instead of repeatedly typing getElementById.
function getElement(id) {
  return document.getElementById(id);
}

let countdownInterval;

/*
 * These two variables remember the latest state drawn in the popup.
 *
 * They are temporary: closing the popup erases them. The durable source of
 * truth remains chrome.storage.local, which background.js reads and writes.
 */
let lastRenderedState;
let oldestPendingTabId = null;

function getTodayKey() {
  /*
   * Build the date from local calendar parts. `toISOString()` uses UTC, which
   * would make the popup's "Today" numbers change at the wrong local hour.
   * This must stay in step with background.js, which creates the storage key.
   */
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatRemainingTime(millisecondsLeft) {
  const totalSeconds = Math.ceil(
    millisecondsLeft / MILLISECONDS_PER_SECOND
  );
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;

  // padStart turns 4 into "04", which produces timer text such as "2:04".
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function showMessage(elementId, message) {
  const messageElement = getElement(elementId);
  messageElement.textContent = message;
  messageElement.classList.remove("hidden");
}

function hideMessage(elementId) {
  const messageElement = getElement(elementId);
  messageElement.textContent = "";
  messageElement.classList.add("hidden");
}

function drawCountdown(currentState) {
  const millisecondsLeft = Math.max(
    0,
    currentState.lockUntil - Date.now()
  );
  const cooldownIsActive = millisecondsLeft > 0;

  if (!currentState.enabled) {
    getElement("timer").textContent = "Paused";
    getElement("status").textContent = "Tracking and tab pauses are off.";
  } else if (cooldownIsActive) {
    getElement("timer").textContent = formatRemainingTime(millisecondsLeft);
    getElement("status").textContent =
      "One-tab space is active. Protection stays on until this timer ends.";
  } else {
    getElement("timer").textContent = "Ready";
    getElement("status").textContent = "New tabs are available.";
  }

  /*
   * A native disabled button cannot be clicked or activated with Enter/Space.
   * We update it every second so it becomes available as soon as the timer
   * ends. The background worker performs the same check as a safety net.
   */
  const toggleButton = getElement("toggle");
  toggleButton.disabled = cooldownIsActive;

  if (cooldownIsActive) {
    toggleButton.title =
      "Protection cannot be turned off while the tab pause is active.";
  } else {
    toggleButton.removeAttribute("title");
  }
}

// Return the queue item that has waited the longest.
function findOldestPendingTab(pendingTabs) {
  let oldestItem = null;

  pendingTabs.forEach((item) => {
    if (!item || !item.id) {
      return;
    }

    const itemTime = Number(item.queuedAt) || 0;
    const oldestTime = oldestItem
      ? Number(oldestItem.queuedAt) || 0
      : 0;

    if (!oldestItem || itemTime < oldestTime) {
      oldestItem = item;
    }
  });

  return oldestItem;
}

function describePendingTab(item) {
  if (item.destinationHost) {
    return item.destinationHost;
  }

  if (item.title && item.title !== "Blank new tab") {
    return item.title;
  }

  return "a blank new tab";
}

function describeLearnedHistoryPattern(entry) {
  /*
   * Older stored results contain only `detours`. Newer results also explain
   * brief exits and repeat checks, so this function understands both shapes.
   */
  const evidence = [];

  if (entry.detours) {
    const directionalDetours = entry.netDetours === undefined
      ? entry.detours
      : entry.netDetours;
    evidence.push(
      `${directionalDetours} net return ` +
      `detour${directionalDetours === 1 ? "" : "s"}`
    );
  }

  if (entry.briefExits) {
    evidence.push(
      `${entry.briefExits} brief exit${entry.briefExits === 1 ? "" : "s"}`
    );
  }

  if (entry.repeatChecks) {
    evidence.push(
      `${entry.repeatChecks} repeat check${entry.repeatChecks === 1 ? "" : "s"}`
    );
  }

  const evidenceText = evidence.length
    ? evidence.slice(0, 2).join(" and ")
    : "a recurring mid-task pattern";

  return (
    `${entry.domain} was learned from ${evidenceText} in the last 30 days. ` +
    "You can mark it neutral in Settings if the inference is wrong."
  );
}

function renderPendingQueue(currentState) {
  const pendingTabs = Array.isArray(currentState.pendingTabs)
    ? currentState.pendingTabs
    : [];
  const oldestItem = findOldestPendingTab(pendingTabs);
  const pendingCount = pendingTabs.length;
  const countElement = getElement("pendingCount");
  const reviewButton = getElement("reviewPending");

  oldestPendingTabId = oldestItem ? oldestItem.id : null;

  countElement.textContent = String(pendingCount);
  countElement.setAttribute(
    "aria-label",
    `${pendingCount} paused tab${pendingCount === 1 ? "" : "s"} waiting`
  );

  if (!oldestItem) {
    getElement("pendingSummary").textContent =
      "No paused tabs are waiting. Future detours can be kept here instead " +
      "of being lost; saved destinations expire locally after seven days.";
    reviewButton.classList.add("hidden");
    reviewButton.disabled = true;
    return;
  }

  const tabWord = pendingCount === 1 ? "tab is" : "tabs are";
  getElement("pendingSummary").textContent =
    `${pendingCount} paused ${tabWord} waiting. ` +
    `The first saved destination is ${describePendingTab(oldestItem)}.`;
  reviewButton.classList.remove("hidden");
  reviewButton.disabled = false;
}

async function renderPopup() {
  /*
   * `chrome.tabs.query` returns an array. We only need its first item, so
   * `[activeTab]` is JavaScript array-destructuring shorthand.
   */
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const currentState = await chrome.runtime.sendMessage({
    type: "getState",
    // Optional chaining (`?.`) safely handles the unlikely case of no tab.
    url: activeTab?.url
  });

  if (!currentState || currentState.ok === false) {
    const stateError = currentState && currentState.error;
    throw new Error(stateError || "The extension state is unavailable.");
  }

  lastRenderedState = currentState;

  const introSettings = await chrome.storage.local.get(
    "historyIntroDismissed"
  );

  const shouldHideHistoryIntroduction =
    currentState.historyInsightsEnabled ||
    introSettings.historyIntroDismissed;

  getElement("historyIntro").classList.toggle(
    "hidden",
    shouldHideHistoryIntroduction
  );

  // Extension on/off switch.
  getElement("toggle").textContent = currentState.enabled ? "On" : "Off";
  getElement("toggle").classList.toggle("off", !currentState.enabled);
  getElement("toggle").setAttribute(
    "aria-pressed",
    String(currentState.enabled)
  );

  // Today's four summary numbers.
  const today = currentState.stats.days[getTodayKey()] || {};
  getElement("wanders").textContent = today.pointerWanders || 0;
  getElement("clicks").textContent = today.lowValueClicks || 0;
  getElement("opened").textContent = today.tabsOpened || 0;
  getElement("blocked").textContent = today.blockedTabs || 0;

  // Classification for the currently visible tab.
  getElement("categoryCard").classList.toggle(
    "hidden",
    !currentState.category
  );
  getElement("category").textContent = currentState.category
    ? `Possible attention shift · ${currentState.category}`
    : "";

  // Show only the strongest learned detour in the small popup.
  const strongestLearnedDetour = (
    currentState.learnedDistractions || []
  )[0];

  getElement("learnedCard").classList.toggle(
    "hidden",
    !currentState.historyInsightsEnabled || !strongestLearnedDetour
  );

  getElement("learnedText").textContent = strongestLearnedDetour
    ? describeLearnedHistoryPattern(strongestLearnedDetour)
    : "";

  renderPendingQueue(currentState);

  /*
   * Clear the old interval before creating a new one. Otherwise every render
   * would leave another timer running in parallel.
   */
  clearInterval(countdownInterval);
  drawCountdown(currentState);
  countdownInterval = setInterval(() => {
    drawCountdown(currentState);
  }, MILLISECONDS_PER_SECOND);
}

// ---------------------------------------------------------------------------
// Button click handlers
// ---------------------------------------------------------------------------

async function handleToggleClick() {
  if (!lastRenderedState) {
    return;
  }

  hideMessage("toggleMessage");

  const toggleButton = getElement("toggle");
  toggleButton.disabled = true;

  /*
   * In the existing message contract, `pause` means "turn the extension off"
   * and `resume` means "turn it on." This naming is easy to confuse with the
   * tab-pause timer, so this comment calls out the difference explicitly.
   */
  const messageType = lastRenderedState.enabled ? "pause" : "resume";

  try {
    const response = await chrome.runtime.sendMessage({ type: messageType });
    await renderPopup();

    if (!response || response.ok !== true) {
      const requestWasRefusedDuringCooldown = response && response.locked;
      const backgroundError = response && response.error;
      const refusalMessage = requestWasRefusedDuringCooldown
        ? "Protection stayed on because the current tab pause is still " +
          "active. Try again when the timer ends."
        : backgroundError || "Behavyour could not change this setting.";

      showMessage("toggleMessage", refusalMessage);
    }
  } catch (error) {
    showMessage(
      "toggleMessage",
      "Behavyour could not change this setting. Please try again."
    );

    // Redraw the correct disabled/enabled state after a failed request.
    drawCountdown(lastRenderedState);
  }
}

async function handlePendingReviewClick() {
  if (!oldestPendingTabId) {
    showMessage("pendingMessage", "There is no paused tab to review.");
    await renderPopup();
    return;
  }

  hideMessage("pendingMessage");
  const reviewButton = getElement("reviewPending");
  reviewButton.disabled = true;

  try {
    /*
     * Only the queue id crosses this message boundary. background.js owns the
     * destination URL and decides whether to focus an existing pause page or
     * create a new one. Keeping that decision in one file prevents two pieces
     * of UI from opening the destination in different ways.
     */
    const response = await chrome.runtime.sendMessage({
      type: "reviewPendingTab",
      queueId: oldestPendingTabId
    });

    if (!response || response.ok !== true) {
      await renderPopup();
      const backgroundError = response && response.error;
      showMessage(
        "pendingMessage",
        backgroundError || "That saved tab could not be opened for review."
      );
      return;
    }

    // The background worker focused the review page, so this popup can close.
    window.close();
  } catch (error) {
    showMessage(
      "pendingMessage",
      "That saved tab could not be opened for review. Please try again."
    );
    reviewButton.disabled = false;
  }
}

function handleDashboardClick() {
  // Opens dashboard.html because manifest.json declares it as options_page.
  chrome.runtime.openOptionsPage();
}

async function handleEnableHistoryClick() {
  /*
   * Chrome requires optional permission prompts to follow a real user action.
   * Keep this request directly inside the click handler.
   */
  const permissionWasGranted = await chrome.permissions.request({
    permissions: ["history"]
  });

  if (permissionWasGranted) {
    await chrome.runtime.sendMessage({ type: "enableHistoryInsights" });
    await renderPopup();
  }
}

async function handleDismissHistoryClick() {
  await chrome.storage.local.set({ historyIntroDismissed: true });
  await renderPopup();
}

/*
 * Keeping event wiring together creates a short checklist: every clickable
 * popup control should appear once in this block and have a named function
 * above that explains what it does.
 */
getElement("toggle").addEventListener("click", handleToggleClick);
getElement("reviewPending").addEventListener(
  "click",
  handlePendingReviewClick
);
getElement("dashboard").addEventListener("click", handleDashboardClick);
getElement("enableHistory").addEventListener(
  "click",
  handleEnableHistoryClick
);
getElement("dismissHistory").addEventListener(
  "click",
  handleDismissHistoryClick
);

// The script sits at the end of popup.html, so every referenced element exists.
renderPopup().catch(() => {
  showMessage(
    "toggleMessage",
    "Behavyour could not load the popup. Close it and try again."
  );
});
