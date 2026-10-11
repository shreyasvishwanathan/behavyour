const STILLNESS_SECONDS = 5;
const SIGNIFICANT_POINTER_MOVEMENT = 4;
const MINIMUM_TAB_INTENT_CHARACTERS = 12;
const getElement = (id) => document.getElementById(id);
const queueId = new URLSearchParams(window.location.search).get("id") || "";

let pauseContext;
let stillnessEndsAt = 0;
let stillnessTimer;
let lockTimer;
let reflectionTimer;
let stillnessAnchorPoint;

function formatDuration(milliseconds) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function showError(message = "") {
  getElement("errorMessage").textContent = message;
}

function describeDestination(item) {
  if (!item.destinationHost) return "You tried to open a blank new tab.";
  const category = item.category ? ` (${item.category})` : "";
  return `You asked for ${item.destinationHost}${category} while working on “${item.sourceTitle}”. This destination has not opened yet.`;
}

function restartStillnessTimer() {
  stillnessEndsAt = Date.now() + STILLNESS_SECONDS * 1000;
}

function handlePointerMove(event) {
  const point = { x: event.clientX, y: event.clientY };
  if (!stillnessAnchorPoint || Math.hypot(
    point.x - stillnessAnchorPoint.x, point.y - stillnessAnchorPoint.y
  ) >= SIGNIFICANT_POINTER_MOVEMENT) {
    stillnessAnchorPoint = point;
    restartStillnessTimer();
  }
}

function updateStillnessCountdown() {
  const remaining = Math.max(0, stillnessEndsAt - Date.now());
  getElement("stillnessCountdown").textContent = String(Math.ceil(remaining / 1000));
  if (remaining > 0) return;
  clearInterval(stillnessTimer);
  window.removeEventListener("pointermove", handlePointerMove);
  getElement("resetStep").classList.add("hidden");
  getElement("decisionStep").classList.remove("hidden");
  getElement("returnButton").focus();
  startLockCountdown();
}

function startStillnessStep() {
  restartStillnessTimer();
  stillnessTimer = setInterval(updateStillnessCountdown, 100);
  updateStillnessCountdown();
  window.addEventListener("pointermove", handlePointerMove, { passive: true });
}

function startLockCountdown() {
  clearInterval(lockTimer);
  function update() {
    const remaining = Math.max(0, pauseContext.lockUntil - Date.now());
    getElement("lockCountdown").textContent = formatDuration(remaining);
    if (remaining === 0) {
      clearInterval(lockTimer);
      getElement("lockStatus").classList.add("hidden");
      getElement("intentSection").classList.remove("hidden");
    }
  }
  lockTimer = setInterval(update, 250);
  update();
}

function updateIntentButton() {
  getElement("commitIntentButton").disabled =
    getElement("tabIntent").value.trim().length < MINIMUM_TAB_INTENT_CHARACTERS;
}

async function sendDecision(type, data = {}) {
  showError();
  try {
    const response = await chrome.runtime.sendMessage({ type, queueId, ...data });
    if (!response?.ok) {
      showError(response?.error || "Could not save this choice. Please try again.");
      if (response?.waiting) {
        // A newer tab pause requires a fresh commitment after its timer ends.
        pauseContext.lockUntil = response.lockUntil;
        clearInterval(reflectionTimer);
        getElement("reflectionStep").classList.add("hidden");
        getElement("openButton").disabled = true;
        getElement("tabIntent").disabled = false;
        updateIntentButton();
        getElement("intentSection").classList.add("hidden");
        getElement("lockStatus").classList.remove("hidden");
        startLockCountdown();
      }
    }
    return response;
  } catch {
    showError("Could not save this choice. Please try again.");
    return null;
  }
}

async function sendResolution(type) {
  getElement("returnButton").disabled = true;
  getElement("saveButton").disabled = true;
  const response = await sendDecision(type);
  if (!response?.ok) {
    getElement("returnButton").disabled = false;
    getElement("saveButton").disabled = false;
  }
}

function beginReflectionCountdown(readyAt) {
  getElement("reflectionStep").classList.remove("hidden");
  getElement("commitIntentButton").disabled = true;
  getElement("tabIntent").disabled = true;
  getElement("openButton").disabled = true;
  clearInterval(reflectionTimer);
  function update() {
    const remaining = Math.max(0, readyAt - Date.now());
    if (remaining > 0) {
      getElement("reflectionMessage").textContent =
        `Take ${formatDuration(remaining)} to consider whether this tab helps your task.`;
      return;
    }
    clearInterval(reflectionTimer);
    getElement("reflectionMessage").textContent = "Ready when you are. Open this one tab, or return to your task.";
    getElement("openButton").disabled = false;
    getElement("openButton").focus();
  }
  reflectionTimer = setInterval(update, 100);
  update();
}

async function commitIntent() {
  const intent = getElement("tabIntent").value.trim();
  if (intent.length < MINIMUM_TAB_INTENT_CHARACTERS) {
    showError(`Please write at least ${MINIMUM_TAB_INTENT_CHARACTERS} characters.`);
    return;
  }
  getElement("commitIntentButton").disabled = true;
  const response = await sendDecision("beginIntentionalOpen", { intent });
  if (response?.ok) beginReflectionCountdown(response.decisionReadyAt);
  else updateIntentButton();
}

async function openIntentionally() {
  getElement("openButton").disabled = true;
  const response = await sendDecision("completeIntentionalOpen");
  if (!response?.ok && !response?.waiting) getElement("openButton").disabled = false;
}

async function initializePausePage() {
  try {
    if (!queueId) throw new Error("This saved tab could not be found. You can close this page.");
    pauseContext = await chrome.runtime.sendMessage({ type: "getPauseContext", queueId });
    if (!pauseContext?.ok) throw new Error(pauseContext?.error || "This saved tab is no longer available.");
    getElement("destinationSummary").textContent = describeDestination(pauseContext.item);
    getElement("returnButton").textContent = `Return to ${pauseContext.item.sourceTitle}`;
    getElement("saveButton").classList.toggle("hidden", !pauseContext.item.destinationUrl);
    startStillnessStep();
  } catch (error) {
    getElement("resetStep").classList.add("hidden");
    getElement("decisionStep").classList.remove("hidden");
    getElement("decisionHeading").textContent = "This tab could not be loaded";
    getElement("lockStatus").classList.add("hidden");
    getElement("returnButton").disabled = true;
    getElement("saveButton").disabled = true;
    showError(error.message || "Could not load this saved tab. Reload this page to try again.");
  }
}

getElement("returnButton").addEventListener("click", () => sendResolution("returnToTask"));
getElement("saveButton").addEventListener("click", () => sendResolution("saveForLater"));
getElement("tabIntent").addEventListener("input", updateIntentButton);
getElement("commitIntentButton").addEventListener("click", commitIntent);
getElement("openButton").addEventListener("click", openIntentionally);
initializePausePage();
