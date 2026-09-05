/*
 * PAUSED-TAB CHECKPOINT CONTROLLER
 * --------------------------------
 * This page never receives the attempted destination in its address bar. It
 * receives only a random queue id, asks background.js for the matching local
 * record, and sends named decisions back to background.js.
 */

const STILLNESS_SECONDS = 5;
const SIGNIFICANT_POINTER_MOVEMENT = 4;
const MINIMUM_TAB_INTENT_CHARACTERS = 12;

let queueId = "";
let pauseContext = null;
let stillnessEndsAt = 0;
let stillnessTimer;
let lockTimer;
let reflectionTimer;
let stillnessAnchorPoint = null;

function getElement(id) {
  return document.getElementById(id);
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function showError(message) {
  getElement("errorMessage").textContent = message || "";
}

function getQueueIdFromAddress() {
  /*
   * URLSearchParams is the browser's safe way to read `?id=...`. The id has no
   * browsing information in it; background.js owns the real destination.
   */
  const parameters = new URLSearchParams(window.location.search);
  return parameters.get("id") || "";
}

function describeDestination(item) {
  if (!item.destinationHost) {
    return "This was a blank new-tab attempt. No destination has been entered.";
  }

  const categoryText = item.category ? ` (${item.category})` : "";
  return (
    `You asked for ${item.destinationHost}${categoryText} while staying with ` +
    `“${item.sourceTitle}”. The destination has not been opened yet.`
  );
}

// ---------------------------------------------------------------------------
// First action: physically stop the pointer loop
// ---------------------------------------------------------------------------

function restartStillnessTimer() {
  stillnessEndsAt = Date.now() + STILLNESS_SECONDS * 1000;
}

function finishStillnessStep() {
  clearInterval(stillnessTimer);
  getElement("resetStep").classList.add("hidden");
  getElement("decisionStep").classList.remove("hidden");
  getElement("returnButton").focus();
  startLockCountdown();
}

function updateStillnessCountdown() {
  const millisecondsLeft = Math.max(0, stillnessEndsAt - Date.now());
  getElement("stillnessCountdown").textContent = String(
    Math.ceil(millisecondsLeft / 1000)
  );

  if (millisecondsLeft === 0) {
    finishStillnessStep();
  }
}

function startStillnessStep() {
  restartStillnessTimer();
  updateStillnessCountdown();
  stillnessTimer = setInterval(updateStillnessCountdown, 100);

  window.addEventListener(
    "pointermove",
    (event) => {
      const currentPoint = { x: event.clientX, y: event.clientY };

      if (stillnessAnchorPoint) {
        const movement = Math.hypot(
          currentPoint.x - stillnessAnchorPoint.x,
          currentPoint.y - stillnessAnchorPoint.y
        );

        if (
          movement >= SIGNIFICANT_POINTER_MOVEMENT &&
          !getElement("resetStep").classList.contains("hidden")
        ) {
          restartStillnessTimer();
          stillnessAnchorPoint = currentPoint;
        }
      } else {
        /* The first observed move also restarts the hands-off interval. */
        stillnessAnchorPoint = currentPoint;
        restartStillnessTimer();
      }
    },
    { passive: true }
  );
}

// ---------------------------------------------------------------------------
// Second action: choose return/later, or state a concrete purpose
// ---------------------------------------------------------------------------

function startLockCountdown() {
  clearInterval(lockTimer);

  function updateLockCountdown() {
    const millisecondsLeft = Math.max(
      0,
      pauseContext.lockUntil - Date.now()
    );

    getElement("lockCountdown").textContent = formatDuration(millisecondsLeft);

    if (millisecondsLeft === 0) {
      clearInterval(lockTimer);
      getElement("lockStatus").classList.add("hidden");
      getElement("intentSection").classList.remove("hidden");
    }
  }

  updateLockCountdown();
  lockTimer = setInterval(updateLockCountdown, 250);
}

async function sendResolution(messageType) {
  showError("");

  try {
    const response = await chrome.runtime.sendMessage({
      type: messageType,
      queueId
    });

    if (!response.ok) {
      showError(response.error);
    }
  } catch {
    showError("Behavyour could not save that choice. Please try again.");
  }
}

function beginReflectionCountdown(decisionReadyAt) {
  getElement("reflectionStep").classList.remove("hidden");
  getElement("commitIntentButton").disabled = true;
  getElement("tabIntent").disabled = true;

  clearInterval(reflectionTimer);

  function updateReflectionCountdown() {
    const millisecondsLeft = Math.max(0, decisionReadyAt - Date.now());

    if (millisecondsLeft > 0) {
      getElement("reflectionMessage").textContent =
        `Hold that purpose for ${formatDuration(millisecondsLeft)}. ` +
        "This is deliberate friction, not a loading delay.";
      return;
    }

    clearInterval(reflectionTimer);
    getElement("reflectionMessage").textContent =
      "Purpose stated. Press Enter or use the button to open only this tab.";
    getElement("openButton").disabled = false;
    getElement("openButton").focus();
  }

  updateReflectionCountdown();
  reflectionTimer = setInterval(updateReflectionCountdown, 100);
}

function resetIntentControlsAfterNewLock() {
  /*
   * A different tab can begin a fresh cooldown while this page is waiting.
   * Re-enable the form so the user deliberately commits again after that new
   * cooldown, instead of reusing an old, half-finished override.
   */
  clearInterval(reflectionTimer);
  getElement("reflectionStep").classList.add("hidden");
  getElement("openButton").disabled = true;
  getElement("tabIntent").disabled = false;

  const intentIsLongEnough =
    getElement("tabIntent").value.trim().length >=
    MINIMUM_TAB_INTENT_CHARACTERS;
  getElement("commitIntentButton").disabled = !intentIsLongEnough;
}

async function commitIntent() {
  const intent = getElement("tabIntent").value.trim();

  if (intent.length < MINIMUM_TAB_INTENT_CHARACTERS) {
    showError(
      `Please write at least ${MINIMUM_TAB_INTENT_CHARACTERS} characters.`
    );
    return;
  }

  showError("");
  const response = await chrome.runtime.sendMessage({
    type: "beginIntentionalOpen",
    queueId,
    intent
  });

  if (!response.ok) {
    showError(response.error);

    if (response.waiting) {
      pauseContext.lockUntil = response.lockUntil;
      resetIntentControlsAfterNewLock();
      getElement("intentSection").classList.add("hidden");
      getElement("lockStatus").classList.remove("hidden");
      startLockCountdown();
    }

    return;
  }

  beginReflectionCountdown(response.decisionReadyAt);
}

async function openIntentionally() {
  getElement("openButton").disabled = true;
  showError("");

  const response = await chrome.runtime.sendMessage({
    type: "completeIntentionalOpen",
    queueId
  });

  if (!response.ok) {
    showError(response.error);
    getElement("openButton").disabled = false;

    if (response.waiting) {
      pauseContext.lockUntil = response.lockUntil;
      resetIntentControlsAfterNewLock();
      getElement("intentSection").classList.add("hidden");
      getElement("lockStatus").classList.remove("hidden");
      startLockCountdown();
    }
  }
}

// ---------------------------------------------------------------------------
// Page startup and button connections
// ---------------------------------------------------------------------------

async function initializePausePage() {
  queueId = getQueueIdFromAddress();

  if (!queueId) {
    getElement("resetStep").classList.add("hidden");
    getElement("decisionStep").classList.remove("hidden");
    showError("This pause page is missing its queue id.");
    return;
  }

  pauseContext = await chrome.runtime.sendMessage({
    type: "getPauseContext",
    queueId
  });

  if (!pauseContext.ok) {
    getElement("resetStep").classList.add("hidden");
    getElement("decisionStep").classList.remove("hidden");
    showError(pauseContext.error);
    return;
  }

  getElement("destinationSummary").textContent = describeDestination(
    pauseContext.item
  );
  getElement("returnButton").textContent =
    `Return to ${pauseContext.item.sourceTitle}`;

  if (!pauseContext.item.destinationUrl) {
    getElement("saveButton").classList.add("hidden");
  }

  startStillnessStep();
}

getElement("returnButton").addEventListener("click", () => {
  sendResolution("returnToTask");
});

getElement("saveButton").addEventListener("click", () => {
  sendResolution("saveForLater");
});

getElement("tabIntent").addEventListener("input", () => {
  const intentIsLongEnough =
    getElement("tabIntent").value.trim().length >=
    MINIMUM_TAB_INTENT_CHARACTERS;

  getElement("commitIntentButton").disabled = !intentIsLongEnough;
});

getElement("commitIntentButton").addEventListener("click", commitIntent);
getElement("openButton").addEventListener("click", openIntentionally);

initializePausePage();
