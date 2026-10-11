// Stored strings are always rendered as text, never HTML.
const VALID_CATEGORIES = ["video", "news", "social", "entertainment", "distraction", "neutral"];
const NUMERIC_SETTINGS = {
  minutes: ["lockMinutes", 3], mouseResetSeconds: ["mouseResetSeconds", 5],
  signalsBeforeIntentPrompt: ["signalsBeforeIntentPrompt", 2],
  rabbitHoleDepth: ["rabbitHoleDepth", 7], scrollMinutesBeforePrompt: ["scrollMinutesBeforePrompt", 2]
};
const BOOLEAN_SETTINGS = {
  strict: "strictLock", pinned: "allowPinned", mouseCoachEnabled: "mouseCoachEnabled",
  rabbitHoleCoachEnabled: "rabbitHoleCoachEnabled", scrollCoachEnabled: "scrollCoachEnabled",
  infiniteFeedCoachEnabled: "infiniteFeedCoachEnabled", screenToneEnabled: "screenToneEnabled"
};
let dashboardState;
let settingsDirty = false;
let loading;

function getElement(id) { return document.getElementById(id); }
function getDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function getCount(container, name) {
  const value = Number(container?.[name]);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
function sumCounts(data, names) { return names.reduce((sum, name) => sum + getCount(data, name), 0); }
function makeElement(tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}
function createHint(text) { return makeElement("p", text, "hint"); }
async function sendMessage(type) {
  const response = await chrome.runtime.sendMessage({ type });
  if (!response || response.ok === false) throw new Error(response?.error || "The extension did not respond.");
  return response;
}
function showError(error) {
  getElement("pageError").hidden = false;
  getElement("pageError").textContent = `Could not complete that action. ${error?.message || "Reload the extension and try again."}`;
}

function formatHistorySeconds(seconds) {
  if (!Number.isFinite(Number(seconds))) {
    return "unknown";
  }

  const roundedSeconds = Math.max(0, Math.round(Number(seconds)));

  if (roundedSeconds < 60) {
    return `${roundedSeconds}s`;
  }

  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function buildHistoryEvidenceText(entry) {
  const facts = [];
  if (getCount(entry, "detours")) facts.push(`${entry.netDetours == null ? getCount(entry, "detours") : getCount(entry, "netDetours")} short detours after accounting for returns to this site`);
  if (getCount(entry, "briefExits")) facts.push(`${entry.briefExits} visits followed by another site within 10 seconds–2 minutes`);
  if (getCount(entry, "repeatChecks")) facts.push(`${entry.repeatChecks} repeat checks within an hour`);
  if (getCount(entry, "contextReturns")) facts.push(`${entry.contextReturns} times you returned here from another site`);
  if (getCount(entry, "deepTrailAppearances")) facts.push(`${entry.deepTrailAppearances} appearances in longer link trails`);
  if (getCount(entry, "contextsInterrupted")) facts.push(`${entry.contextsInterrupted} other sites involved`);
  if (entry.medianEpisodeSeconds != null) facts.push(`${formatHistorySeconds(entry.medianEpisodeSeconds)} typical gap before another site opened`);
  return facts.length ? facts.join(" · ") + "." : "More visits are needed to describe this pattern.";
}

function createHistoryPatternRow(entry, resultKind) {
  const row = document.createElement("article");
  const heading = document.createElement("div");
  const domain = document.createElement("b");
  const label = document.createElement("span");
  const evidence = document.createElement("p");
  const actions = document.createElement("div");

  row.className = "history-pattern";
  heading.className = "history-pattern-heading";
  domain.textContent = entry.domain || "Unknown domain";
  evidence.textContent = buildHistoryEvidenceText(entry);

  if (resultKind === "learned") {
    label.className = "history-result-label learned-label";
    label.textContent = entry.confidence || "learned recurring pattern";
  } else if (entry.existingCategory) {
    label.className = "history-result-label existing-label";
    label.textContent = `already ${entry.existingCategory}`;
  } else if (entry.qualifiesForLearning) {
    label.className = "history-result-label learned-label";
    label.textContent = "strong evidence";
  } else {
    label.className = "history-result-label watching-label";
    label.textContent = "watching only";
  }

  heading.append(domain, label);
  row.append(heading, evidence);

  actions.className = "history-pattern-actions";

  if (!entry.existingCategory && resultKind !== "learned") {
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "secondary compact";
    addButton.textContent = "Treat as distraction";
    addButton.addEventListener("click", () => {
      saveHistoryClassification(entry.domain, "distraction").catch(showError);
    });
    actions.append(addButton);
  }

  const neutralButton = document.createElement("button");
  neutralButton.type = "button";
  neutralButton.className = "text-button compact";
  neutralButton.textContent = "Mark neutral";
  neutralButton.addEventListener("click", () => {
    saveHistoryClassification(entry.domain, "neutral").catch(showError);
  });
  actions.append(neutralButton);
  row.append(actions);

  return row;
}

async function saveHistoryClassification(domain, category) {
  if (!domain || !VALID_CATEGORIES.includes(category)) {
    return;
  }

  if (settingsDirty) throw new Error("Save your settings before changing a website category.");
  getElement("settingsFields").disabled = true;
  try {
    const storedState = await chrome.storage.local.get({ categoryRules: {}, learnedDistractions: [] });
    await chrome.storage.local.set({
      categoryRules: { ...storedState.categoryRules, [domain]: category },
      learnedDistractions: storedState.learnedDistractions.filter((entry) => entry.domain !== domain)
    });
    settingsDirty = false;
    getElement("rules").value = Object.entries({ ...storedState.categoryRules, [domain]: category })
      .map(([site, value]) => `${site} = ${value}`).join("\n");
    await sendMessage("analyzeHistory");
    await loadDashboard();
  } finally { getElement("settingsFields").disabled = false; }
}

function renderNavigationContinuity(currentState) {
  const card = getElement("continuityCard");
  const continuity =
    currentState.historyAnalysis?.navigationContinuity;

  if (
    !currentState.historyInsightsEnabled ||
    !currentState.historyPermissionGranted ||
    !continuity
  ) {
    card.classList.add("hidden");
    return;
  }

  card.classList.remove("hidden");

  if (continuity.recentContinuity === null) {
    getElement("continuityValue").textContent = "—";
    getElement("continuityLabel").textContent = "Building a baseline";
    getElement("continuityDetail").textContent =
      "No recent session has enough comparable navigation yet. A session " +
      "needs at least eight website episodes, six usable transitions, and " +
      "ten minutes of activity.";
    return;
  }

  getElement("continuityValue").textContent =
    continuity.recentBand || "Not enough data";
  getElement("continuityLabel").textContent = continuity.hasComparisonBaseline
    ? "Compared with your earlier browsing" : "Recent browsing; no comparison yet";

  if (continuity.hasComparisonBaseline) {
    const direction = continuity.changeFromBaseline === 0 ? "about the same"
      : continuity.changeFromBaseline > 0 ? "more fragmented" : "less fragmented";

    getElement("continuityDetail").textContent =
      `Your navigation was ${direction} compared with your earlier baseline. ` +
      `Based on ${continuity.recentSessionCount} recent sessions. This does not measure attention.`;
  } else {
    getElement("continuityDetail").textContent =
      `Based on ${continuity.recentSessionCount} eligible recent sessions ` +
      `across ${continuity.recentDayCount} days. Comparison begins after at ` +
      "least four recent sessions across three days and five earlier sessions.";
  }
}

function renderHistoricalLinkTrails(currentState) {
  const card = getElement("linkTrailCard");
  const linkTrails = currentState.historyAnalysis?.linkTrails;
  const featureIsActive = Boolean(
    currentState.historyInsightsEnabled &&
    currentState.historyPermissionGranted
  );

  if (!featureIsActive || !linkTrails) {
    card.classList.add("hidden");
    return;
  }

  card.classList.remove("hidden");
  const trailCount = getCount(linkTrails, "qualifyingTrailCount");
  const relationshipCount = getCount(
    linkTrails,
    "observedLinkRelationships"
  );
  const minimumDepth = getCount(linkTrails, "minimumLinkedDepth") || 5;
  const frequentDomains = (linkTrails.frequentDeepDomains || [])
    .map(
      (entry) =>
        `${entry.domain} (${getCount(entry, "trailAppearances")} trails)`
    )
    .join(", ");

  getElement("historyLinkTrailValue").textContent = String(trailCount);
  getElement("historyLinkTrailLabel").textContent =
    `${trailCount === 1 ? "partial chain" : "partial chains"} with ` +
    `${minimumDepth}+ successive links`;

  if (!relationshipCount) {
    getElement("historyLinkTrailDetail").textContent =
      "No usable referring-visit relationships were present in this history " +
      "sample. Missing referrers do not mean no link was clicked.";
    return;
  }

  if (!trailCount) {
    getElement("historyLinkTrailDetail").textContent =
      `${relationshipCount} referring-visit relationships were usable, but ` +
      `no reconstructed chain reached ${minimumDepth} links within ` +
      `${getCount(linkTrails, "windowMinutes") || 20} minutes.`;
    return;
  }

  const medianDepth = getCount(linkTrails, "medianLinkedDepth");
  const maximumDepth = getCount(linkTrails, "maximumLinkedDepth");
  const crossDomainCount = getCount(linkTrails, "crossDomainTrailCount");
  const domainText = frequentDomains
    ? ` Frequently appearing deeper domains: ${frequentDomains}.`
    : "";

  getElement("historyLinkTrailDetail").textContent =
    `Median reconstructed depth ${medianDepth}; longest ${maximumDepth}; ` +
    `${crossDomainCount} crossed domains.${domainText} This is reviewable ` +
    "evidence only and does not add a distraction category by itself.";
}

function renderHistoryInsights(currentState) {
  const historyButton = getElement("historyToggle");
  const refreshButton = getElement("historyRefresh");
  const learnedList = getElement("learnedList");
  const candidateList = getElement("historyCandidateList");
  const analysisSummary = getElement("historyAnalysisSummary");
  const featureIsActive = Boolean(
    currentState.historyInsightsEnabled &&
    currentState.historyPermissionGranted
  );

  historyButton.textContent = featureIsActive
    ? "Turn off"
    : currentState.historyInsightsEnabled
      ? "Restore access"
      : "Enable history insights";
  historyButton.classList.toggle(
    "danger",
    featureIsActive
  );
  refreshButton.classList.toggle("hidden", !featureIsActive);
  getElement("historyResults").hidden = !featureIsActive;

  learnedList.replaceChildren();
  candidateList.replaceChildren();

  const learnedDomains = currentState.learnedDistractions || [];
  const analysis = currentState.historyAnalysis || {};
  const learnedDomainNames = new Set(
    learnedDomains.map((entry) => entry.domain)
  );
  const candidates = [
    ...(analysis.candidates || []),
    ...(analysis.knownPatterns || [])
  ].filter((entry) => !learnedDomainNames.has(entry.domain));

  if (!currentState.historyInsightsEnabled) {
    analysisSummary.textContent =
      "Off. Behavyour does not read browser history unless you enable this.";
  } else if (!currentState.historyPermissionGranted) {
    analysisSummary.textContent =
      "The setting is on, but browser-history access is no longer granted.";
  } else if (analysis.lastRun) {
    const analyzedAt = new Date(analysis.lastRun).toLocaleString();
    const visitCount = getCount(analysis, "analyzedVisits");
    const episodeCount = getCount(analysis, "analyzedEpisodes");

    analysisSummary.textContent = analysis.modelVersion >= 2
      ? `Last analyzed ${analyzedAt}: ${visitCount} local visits grouped ` +
        `into ${episodeCount} website episodes.` +
        (analysis.coverageLimited
          ? " The 2,000-URL safety cap was reached, so coverage is partial."
          : "") +
        (getCount(analysis, "failedUrlCount")
          ? ` ${getCount(analysis, "failedUrlCount")} URLs could not be read.`
          : "")
      : `Last analyzed ${analyzedAt}. Choose Analyze now to refresh these results.`;
  } else {
    analysisSummary.textContent =
      "History access is ready. Choose Analyze now to build the first result.";
  }

  if (learnedDomains.length === 0) {
    const emptyMessage = featureIsActive
      ? "No recurring detours found yet. You do not need to change anything."
      : "This optional analysis is off.";

    learnedList.append(createHint(emptyMessage));
  } else {
    learnedDomains.forEach((entry) => {
      learnedList.append(createHistoryPatternRow(entry, "learned"));
    });
  }

  if (candidates.length === 0) {
    candidateList.append(
      createHint(
        featureIsActive
          ? "No repeated navigation pattern is strong enough to show yet."
          : "Enable the optional analysis to see evidence here."
      )
    );
  } else {
    candidates.forEach((entry) => {
      candidateList.append(createHistoryPatternRow(entry, "candidate"));
    });
  }

  renderNavigationContinuity(currentState);
  renderHistoricalLinkTrails(currentState);
}


function describeActivityEvent(event) {
  const data = event.data || {};
  switch (event.metric) {
    case "pointerLoops": return "Your pointer circled back to where it started.";
    case "pointerReversals": return "Your pointer moved back and forth repeatedly.";
    case "pointerWanders": return "Your pointer moved without a clear page action.";
    case "blankAreaClicks":
    case "lowValueClicks": return "A click did not appear to activate a page control.";
    case "repeatedClicks": return "You clicked the same control again quickly.";
    case "shortDetours": return `You left this page again${data.durationSeconds ? ` after ${data.durationSeconds} seconds` : " after a short visit"}.`;
    case "rabbitHoleCheckpoints": return `A trail of ${data.linkDepth || "several"} linked pages reached your checkpoint.`;
    case "sustainedScrolling": return `Extended scrolling reached your checkpoint${data.activeSeconds ? ` after ${formatHistorySeconds(data.activeSeconds)} of active scrolling` : ""}.`;
    case "infiniteFeedCheckpoints": return data.hardLockRequested === false ? "Ten new feed images or videos were observed; the feed pause was off." : "Ten new feed images or videos triggered a reflection pause.";
    case "blockedTabs": return "An extra tab was saved on the pause page.";
    case "returnedToTask": return "You chose to return to your earlier task.";
    case "savedForLater": return "You saved this destination for later.";
    case "intentionalOpens": return "You opened this destination after writing why you needed it.";
    case "intentPromptsCompleted": return "You wrote down your next action before continuing.";
    case "driftReflectionsCompleted": return "You reflected on what you came for and where the feed led.";
    case "mouseResetsCompleted": return `You completed a ${data.stillSeconds || "short"}${data.stillSeconds ? "-second" : ""} hands-off reset.`;
    case "tabsOpened": return "You opened a new tab.";
    case "distractionOpens":
    case "sensationalVisits": return "This page matched one of your editable website categories.";
    default: return "An activity pattern was recorded.";
  }
}

function describeEventContext(event) {
  const contextParts = [];
  const readablePageName = event.title || event.domain;

  if (readablePageName) {
    contextParts.push(readablePageName);
  }

  if (event.category) {
    contextParts.push(`category: ${event.category}`);
  }

  return contextParts.join(" · ");
}

function formatSessionRange(session) {
  const start = new Date(session.startedAt);
  const end = new Date(session.lastActivityAt || session.startedAt);

  if (Number.isNaN(start.getTime())) {
    return "Recent activity session";
  }

  const day = start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
  const startTime = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
  const endTime = Number.isNaN(end.getTime())
    ? ""
    : end.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit"
      });

  return endTime && endTime !== startTime
    ? `${day} · ${startTime}–${endTime}`
    : `${day} · ${startTime}`;
}

function countSessionPatterns(summary) {

  return (
    getCount(summary, "pointerLoops") +
    getCount(summary, "pointerReversals") +
    getCount(summary, "pointerWanders") +
    getCount(summary, "blankAreaClicks") +
    getCount(summary, "repeatedClicks") +
    getCount(summary, "lowValueClicks") +
    getCount(summary, "shortDetours") +
    getCount(summary, "blockedTabs") +
    getCount(summary, "rabbitHoleCheckpoints") +
    getCount(summary, "sustainedScrolling") +
    getCount(summary, "infiniteFeedCheckpoints")
  );
}

function createSessionEvent(event) {
  const listItem = document.createElement("li");
  const time = document.createElement("time");
  const eventCopy = document.createElement("div");
  const description = document.createElement("p");
  const context = document.createElement("small");
  const eventDate = new Date(event.at);

  listItem.className = "session-event";
  time.textContent = Number.isNaN(eventDate.getTime())
    ? "—"
    : eventDate.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit"
      });

  if (!Number.isNaN(eventDate.getTime())) {
    time.dateTime = eventDate.toISOString();
  }

  eventCopy.className = "session-event-copy";
  description.textContent = describeActivityEvent(event);
  context.textContent = describeEventContext(event);
  eventCopy.append(description);

  if (context.textContent) {
    eventCopy.append(context);
  }

  const facts = Object.entries({
    "Pointer distance (pixels)": event.data?.distancePixels,
    "Sampled moves": event.data?.moveCount,
    "Movement time (seconds)": event.data?.durationSeconds,
    "Direction changes": event.data?.reversalCount,
    "Starting region": event.data?.startRegion,
    "Ending region": event.data?.endRegion,
    "Click gap (milliseconds)": event.data?.millisecondsSincePreviousClick,
    "Page region": event.data?.pageRegion,
    "Screens scrolled downward": event.data?.downwardScreens,
    "Scroll bursts": event.data?.scrollBursts,
    "Page growth (screens)": event.data?.pageGrowthScreens,
    "New images": event.data?.imageLoads,
    "New videos": event.data?.videoLoads,
    "Optional tone estimate": event.data?.toneBand,
    "Sampled words": event.data?.sampledWords,
    "Negative-list matches": event.data?.negativeHits,
    "Positive-list matches": event.data?.positiveHits
  }).filter(([, value]) => value != null);
  if (facts.length) {
    const details = document.createElement("details");
    details.className = "event-evidence";
    details.append(makeElement("summary", "Observation details"),
      createHint(facts.map(([label, value]) => `${label}: ${value}`).join(" · ")));
    eventCopy.append(details);
  }

  if (event.intent) {
    const intentLine = document.createElement("p");
    const intentLabel = document.createElement("strong");
    const intentText = document.createElement("span");

    intentLine.className = "saved-intent";
    intentLabel.textContent = "Saved intent: ";

    intentText.textContent = String(event.intent);
    intentLine.append(intentLabel, intentText);
    eventCopy.append(intentLine);
  }

  if (event.reflection) {
    const reflectionBox = document.createElement("div");
    const initialLine = document.createElement("p");
    const currentLine = document.createElement("p");
    const wordCountLine = document.createElement("small");
    const initialLabel = document.createElement("strong");
    const currentLabel = document.createElement("strong");

    reflectionBox.className = "saved-reflection";
    initialLabel.textContent = "Initial point: ";
    currentLabel.textContent = "Where the feed drifted: ";
    initialLine.append(
      initialLabel,
      document.createTextNode(String(event.reflection.initialPoint || ""))
    );
    currentLine.append(
      currentLabel,
      document.createTextNode(String(event.reflection.currentPoint || ""))
    );
    wordCountLine.textContent =
      `${getCount(event.reflection, "wordCount")} words in the saved reflection`;
    reflectionBox.append(initialLine, currentLine, wordCountLine);
    eventCopy.append(reflectionBox);
  }

  listItem.append(time, eventCopy);
  return listItem;
}

// Daily counters already include specific mouse events in their broad totals.
function countMousePatterns(day) { return sumCounts(day, ["pointerWanders", "lowValueClicks"]); }
function countTabShifts(day) { return sumCounts(day, ["blockedTabs", "shortDetours"]); }
function countOnPageCheckpoints(day) { return sumCounts(day, ["rabbitHoleCheckpoints", "sustainedScrolling", "infiniteFeedCheckpoints"]); }
function countDeliberateSteps(day) { return sumCounts(day, ["mouseResetsCompleted", "returnedToTask", "savedForLater", "intentionalOpens"]); }
function countWrittenIntentions(day) { return sumCounts(day, ["intentPromptsCompleted", "intentionalOpens", "driftReflectionsCompleted"]); }

function getPatterns(day) {
  return [
    { label: "Pointer movement", count: getCount(day, "pointerWanders"), tip: "When the pointer starts circling, take your hand off the mouse and name your next action." },
    { label: "Clicks without a clear action", count: getCount(day, "lowValueClicks"), tip: "Before clicking again, check what changed on the page and choose the next control deliberately." },
    { label: "Extra tabs paused", count: getCount(day, "blockedTabs"), tip: "Let a saved tab wait until you finish the page you are on." },
    { label: "Brief detours", count: getCount(day, "shortDetours"), tip: "Before switching sites, write down what you are trying to finish." },
    { label: "Long link trails", count: getCount(day, "rabbitHoleCheckpoints"), tip: "At the next link, ask whether it still serves what you came to find." },
    { label: "Extended scrolling", count: getCount(day, "sustainedScrolling"), tip: "Choose a stopping point before you scroll further." },
    { label: "New feed media", count: getCount(day, "infiniteFeedCheckpoints"), tip: "Close the feed for a moment and recall what you originally came to see." }
  ].filter((pattern) => pattern.count > 0).sort((a, b) => b.count - a.count);
}

function renderOverview(state) {
  const today = state.stats?.days?.[getDateKey(new Date())];
  const patterns = getPatterns(today);
  const total = patterns.reduce((sum, pattern) => sum + pattern.count, 0);
  const strongest = patterns[0];
  getElement("todayMouse").textContent = today ? countMousePatterns(today) : "—";
  getElement("todayTabs").textContent = today ? countTabShifts(today) : "—";
  getElement("todayCheckpoints").textContent = today ? countOnPageCheckpoints(today) : "—";
  getElement("todayRecovered").textContent = today ? countDeliberateSteps(today) : "—";
  getElement("todayTabsDetail").textContent = today
    ? `${getCount(today, "blockedTabs")} extra tabs paused · ${getCount(today, "shortDetours")} brief detours`
    : "Extra tabs paused and brief detours";
  const tied = strongest && patterns.filter((pattern) => pattern.count === strongest.count).length > 1;
  getElement("dayHeadline").textContent = !today ? "Your day has room to unfold."
    : !strongest ? "No patterns flagged today."
    : tied ? "A few different patterns showed up."
    : `${strongest.label} came up most often.`;
  getElement("dayDetail").textContent = !today
    ? "No activity has been recorded today. Browse as usual, then come back to see the moments Behavyour noticed."
    : !strongest ? "Activity was recorded, but none of the observed patterns reached a threshold. This is not a measure of attention."
    : `${strongest.count} of ${total} observed signals were ${strongest.label.toLowerCase()}. You also recorded ${countDeliberateSteps(today)} deliberate next steps. One moment can produce several signals or responses.`;
  getElement("nextStep").textContent = strongest?.tip || "Before opening your next tab, name what you came to do.";
  getElement("protectionStatus").textContent = state.enabled ? "● Observing" : "○ Paused";
  if (!state.enabled) getElement("dayDetail").textContent += " Behavyour is paused; resume it from the toolbar to record new activity.";

  const breakdown = getElement("patternBreakdown");
  breakdown.replaceChildren();
  for (const pattern of patterns) {
    const row = makeElement("div", "", "pattern-row");
    const label = makeElement("span", pattern.label);
    const count = makeElement("strong", pattern.count.toLocaleString());
    const bar = document.createElement("meter");
    bar.min = 0;
    bar.max = total;
    bar.value = pattern.count;
    bar.setAttribute("aria-label", `${pattern.label}: ${pattern.count} of ${total} signals`);
    row.append(label, count, bar);
    breakdown.append(row);
  }
  if (!patterns.length) breakdown.append(createHint("Nothing to break down yet. Patterns will appear here as they are observed."));
  const actions = getElement("recoveryBreakdown");
  actions.replaceChildren();
  for (const [metric, label] of [["mouseResetsCompleted", "Hands-off resets"], ["returnedToTask", "Returns to your task"], ["savedForLater", "Tabs saved for later"], ["intentionalOpens", "Tabs opened with an intention"]]) {
    const row = makeElement("div", "", "action-row");
    row.append(makeElement("span", label), makeElement("strong", today ? getCount(today, metric) : "—"));
    actions.append(row);
  }
  getElement("intentionSummary").textContent = `${countWrittenIntentions(today)} intentions or reflections saved today. Responses are separate actions, not a success rate.`;
  getElement("lifetimeSummary").textContent = `All time: ${countDeliberateSteps(state.stats?.totals)} deliberate next steps and ${countWrittenIntentions(state.stats?.totals)} saved intentions or reflections.`;
  getElement("toneSummary").textContent = `Today: ${getCount(today, "negativeToneWordHits")} negative-list matches in ${getCount(today, "toneSampledWords")} sampled words.`;
}

function renderSevenDayPatterns(state) {
  const rows = getElement("dailyRows");
  rows.replaceChildren();
  for (let daysAgo = 0; daysAgo < 7; daysAgo++) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const day = state.stats?.days?.[getDateKey(date)];
    const row = document.createElement("tr");
    if (!daysAgo) row.className = "today-row";
    const heading = makeElement("th", daysAgo === 0 ? "Today" : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }));
    heading.scope = "row";
    row.append(heading);
    for (const count of [countMousePatterns, countTabShifts, countOnPageCheckpoints, countDeliberateSteps, countWrittenIntentions]) {
      row.append(makeElement("td", day ? count(day).toLocaleString() : "—"));
    }
    rows.append(row);
  }
}

function createSessionCard(session) {
  const card = makeElement("details", "", "session-card");
  const heading = document.createElement("summary");
  const text = makeElement("span", "", "session-heading-text");
  const summary = session.summary || {};
  const events = [...(session.events || [])].sort((a, b) => a.at - b.at);
  text.append(makeElement("strong", formatSessionRange(session)), makeElement("small", `${events.length} saved events · ${countSessionPatterns(summary)} signals · ${countDeliberateSteps(summary)} deliberate steps`));
  heading.append(text);
  const eventList = makeElement("ol", "", "session-events");
  for (const event of events) eventList.append(createSessionEvent(event));
  card.append(heading, eventList);
  if (!events.length) card.append(createHint("No event details were saved for this session."));
  return card;
}

function renderActivitySessions(state) {
  const range = getElement("sessionRange").value;
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  if (range === "week") since.setDate(since.getDate() - 6);
  const sessions = (state.activitySessions || []).filter((session) => range === "all" || (session.lastActivityAt || session.startedAt) >= since.getTime()).sort((a, b) => b.startedAt - a.startedAt);
  const log = getElement("sessionLog");
  log.replaceChildren();
  if (!sessions.length) {
    log.append(makeElement("h2", "No sessions in this period."), createHint("Browse as usual, or choose All saved sessions to look further back. Only observed activity is recorded."));
    return;
  }
  log.append(createHint("Sessions active in this period are shown in full, including any earlier activity. Open one to see its timeline."));
  for (const session of sessions) log.append(createSessionCard(session));
}

function renderSettings(state) {
  for (const [id, [key, fallback]] of Object.entries(NUMERIC_SETTINGS)) getElement(id).value = state[key] ?? fallback;
  for (const [id, key] of Object.entries(BOOLEAN_SETTINGS)) getElement(id).checked = key === "screenToneEnabled" ? state[key] === true : state[key] !== false;
  getElement("whitelist").value = (state.whitelist || []).join("\n");
  getElement("rules").value = Object.entries(state.categoryRules || {}).map(([domain, category]) => `${domain} = ${category}`).join("\n");
  getElement("settingsFields").disabled = false;
  updateCoachControlAvailability();
}

function updateCoachControlAvailability() {
  getElement("mouseResetSeconds").disabled = !["mouseCoachEnabled", "rabbitHoleCoachEnabled", "scrollCoachEnabled", "infiniteFeedCoachEnabled"].some((id) => getElement(id).checked);
  getElement("signalsBeforeIntentPrompt").disabled = !getElement("mouseCoachEnabled").checked;
}

function normalizeEnteredDomain(raw) {
  const value = raw.trim().toLowerCase();
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    return url.hostname.replace(/^www\./, "");
  } catch { throw new Error(`Check this website address: ${raw}`); }
}

function parseWhitelist(text) {
  return [...new Set(text.split(/\n/).map((line) => line.trim()).filter(Boolean).map(normalizeEnteredDomain))];
}

function parseCategoryRules(text) {
  return Object.fromEntries(text.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [domain, category, extra] = line.split("=").map((part) => part.trim().toLowerCase());
    if (extra !== undefined || !VALID_CATEGORIES.includes(category)) throw new Error(`Use domain = category on this line: ${line}`);
    return [normalizeEnteredDomain(domain), category];
  }));
}

async function saveSettings(event) {
  event.preventDefault();
  const button = getElement("saveSettings");
  button.disabled = true;
  getElement("settingsFields").disabled = true;
  try {
    const settings = { whitelist: parseWhitelist(getElement("whitelist").value), categoryRules: parseCategoryRules(getElement("rules").value) };
    for (const [id, [key]] of Object.entries(NUMERIC_SETTINGS)) {
      const input = getElement(id);
      const value = Number(input.value);
      if (!input.value.trim() || !Number.isInteger(value) || value < Number(input.min) || value > Number(input.max)) throw new Error("Enter whole numbers within the ranges shown.");
      settings[key] = value;
    }
    for (const [id, key] of Object.entries(BOOLEAN_SETTINGS)) settings[key] = getElement(id).checked;
    await chrome.storage.local.set(settings);
    settingsDirty = false;
    getElement("saved").textContent = "Settings saved.";
    getElement("pageError").hidden = true;
  } catch (error) {
    getElement("saved").textContent = `Not saved. ${error.message || "Try again."}`;
  } finally {
    button.disabled = false;
    getElement("settingsFields").disabled = false;
  }
}

async function loadDashboard() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const state = await sendMessage("getState");
      dashboardState = state;
      renderOverview(state);
      renderSevenDayPatterns(state);
      renderActivitySessions(state);
      renderHistoryInsights(state);
      if (!settingsDirty) renderSettings(state);
      getElement("currentDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
      getElement("pageError").hidden = true;
    } catch (error) { showError(error); }
  })();
  try { await loading; } finally { loading = null; }
}

function showView() {
  const name = location.hash.slice(1);
  const view = ["overview", "sessions", "history", "settings"].includes(name) ? name : "overview";
  for (const panel of document.querySelectorAll(".view")) panel.hidden = panel.id !== view;
  for (const link of document.querySelectorAll(".sidebar nav a")) {
    if (link.hash === `#${view}`) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.title = `Behavyour — ${getElement(view).querySelector("h1").textContent}`;
}

getElement("settingsForm").addEventListener("submit", saveSettings);
document.querySelector(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  getElement("main").focus();
  getElement("main").scrollIntoView();
});
getElement("settingsForm").addEventListener("input", () => {
  settingsDirty = true;
  getElement("saved").textContent = "You have unsaved changes.";
  updateCoachControlAvailability();
});
window.addEventListener("beforeunload", (event) => {
  if (settingsDirty) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("hashchange", () => {
  showView();
  const heading = document.querySelector(".view:not([hidden]) h1");
  heading.tabIndex = -1;
  heading.focus();
});
getElement("sessionRange").addEventListener("change", () => { if (dashboardState) renderActivitySessions(dashboardState); });
getElement("refresh").addEventListener("click", async () => {
  getElement("refresh").disabled = true;
  await loadDashboard();
  getElement("refresh").disabled = false;
});

getElement("reset").addEventListener("click", async () => {
  if (!confirm("Delete activity counts, session details, and saved intention notes from this device? Settings, learned history, and tabs saved for later will stay.")) return;
  try {
    await chrome.storage.local.set({ stats: { days: {}, totals: {} }, recent: [], activitySessions: [], recentTabAttempts: [], recentQuestionableSignals: [], lastIntentPromptAt: 0, activeTabByWindow: {}, navigationTrails: {}, lockUntil: 0 });
    await loadDashboard();
  } catch (error) { showError(error); }
});

getElement("historyToggle").addEventListener("click", async () => {
  const button = getElement("historyToggle");
  button.disabled = true;
  try {
    if (dashboardState?.historyInsightsEnabled && dashboardState?.historyPermissionGranted) {
      await sendMessage("disableHistoryInsights");
      await chrome.permissions.remove({ permissions: ["history"] });
    } else {
      // Request directly from the click so browser permission retains the user gesture.
      const granted = await chrome.permissions.request({ permissions: ["history"] });
      if (!granted) { getElement("historyAnalysisSummary").textContent = "History access was not granted. You can keep using the rest of Behavyour."; return; }
      await sendMessage("enableHistoryInsights");
    }
    await loadDashboard();
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
});
getElement("historyRefresh").addEventListener("click", async () => {
  const button = getElement("historyRefresh");
  button.disabled = true;
  button.textContent = "Analyzing…";
  try {
    await sendMessage("analyzeHistory");
    await loadDashboard();
  } catch (error) { showError(error); }
  finally { button.disabled = false; button.textContent = "Analyze now"; }
});
showView();
loadDashboard();
