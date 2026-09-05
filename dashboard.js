/*
 * DASHBOARD CONTROLLER
 * --------------------
 * dashboard.html contains labeled spaces for settings and results. This file
 * loads locally stored state, draws the charts/lists, and saves user changes.
 */

const AUTOSAVE_DELAY = 400;
const SAVED_MESSAGE_DURATION = 1200;
const DAYS_IN_PATTERN_TABLE = 7;
const MAXIMUM_SESSIONS_SHOWN = 10;
const MAXIMUM_EVENTS_SHOWN_PER_SESSION = 20;
const MINIMUM_MOUSE_RESET_SECONDS = 3;
const MAXIMUM_MOUSE_RESET_SECONDS = 15;
const DEFAULT_MOUSE_RESET_SECONDS = 5;
const MINIMUM_SIGNALS_BEFORE_PROMPT = 2;
const MAXIMUM_SIGNALS_BEFORE_PROMPT = 5;
const DEFAULT_SIGNALS_BEFORE_PROMPT = 2;
const MINIMUM_RABBIT_HOLE_DEPTH = 5;
const MAXIMUM_RABBIT_HOLE_DEPTH = 12;
const DEFAULT_RABBIT_HOLE_DEPTH = 7;
const MINIMUM_SCROLL_MINUTES = 1;
const MAXIMUM_SCROLL_MINUTES = 10;
const DEFAULT_SCROLL_MINUTES = 2;

const VALID_CATEGORIES = [
  "video",
  "news",
  "social",
  "entertainment",
  "distraction",
  "neutral"
];

let autosaveTimer;

function getElement(id) {
  return document.getElementById(id);
}

function getDateKey(date) {
  /*
   * Use the person's local calendar date. `toISOString()` uses UTC, which can
   * call late-evening activity "tomorrow" (or early activity "yesterday").
   * This matches background.js, where the daily counters are written.
   */
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCount(container, name) {
  /*
   * Stored data from an older extension version may not contain a newer
   * counter. Missing counters mean zero; they should never produce "NaN" in
   * the dashboard.
   */
  return Number(container?.[name]) || 0;
}

function clampWholeNumber(value, minimum, maximum, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(minimum, Math.min(maximum, Math.round(numericValue)));
}

function clearElement(element) {
  /*
   * replaceChildren removes everything currently inside an element. It is a
   * straightforward way to redraw generated lists without string-based HTML.
   */
  element.replaceChildren();
}

function createHint(text) {
  const paragraph = document.createElement("p");
  paragraph.className = "hint";
  paragraph.textContent = text;
  return paragraph;
}

// ---------------------------------------------------------------------------
// Optional history insights
// ---------------------------------------------------------------------------

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
  const evidence = [];

  if (getCount(entry, "detours")) {
    const netDetours = entry.netDetours === undefined
      ? getCount(entry, "detours")
      : getCount(entry, "netDetours");
    evidence.push(
      `${netDetours} net ` +
      `return detours across ${getCount(entry, "detourDays") || "?"} days`
    );
  }

  if (getCount(entry, "briefExits")) {
    evidence.push(
      `${getCount(entry, "briefExits")} of ` +
      `${getCount(entry, "measurableExits") || "?"} measurable context ` +
      `episodes ended in 10s–2m across ` +
      `${getCount(entry, "briefExitDays") || "?"} days`
    );
  }

  if (getCount(entry, "repeatChecks")) {
    evidence.push(
      `${getCount(entry, "repeatChecks")} repeat checks within an hour ` +
      `across ${getCount(entry, "repeatCheckDays") || "?"} days`
    );
  }

  if (getCount(entry, "deepTrailAppearances")) {
    evidence.push(
      `${getCount(entry, "deepTrailAppearances")} appearances deeper in ` +
      "a reconstructed hyperlink trail (supporting evidence only)"
    );
  }

  if (getCount(entry, "contextReturns")) {
    evidence.push(
      `${getCount(entry, "contextReturns")} times this site was instead the ` +
      "context returned to"
    );
  }

  if (getCount(entry, "veryFastExits")) {
    evidence.push(
      `${getCount(entry, "veryFastExits")} near-instant exits treated as ` +
      "possible redirect noise"
    );
  }

  if (getCount(entry, "explicitOpens")) {
    evidence.push(
      `${getCount(entry, "explicitOpens")} episodes began from a typed, ` +
      "bookmark, or search-style navigation (intent remains unknown)"
    );
  }

  if (getCount(entry, "contextsInterrupted")) {
    evidence.push(
      `${getCount(entry, "contextsInterrupted")} different surrounding sites`
    );
  }

  if (
    entry.medianEpisodeSeconds !== null &&
    entry.medianEpisodeSeconds !== undefined &&
    Number.isFinite(Number(entry.medianEpisodeSeconds))
  ) {
    evidence.push(
      `${formatHistorySeconds(entry.medianEpisodeSeconds)} median estimated ` +
      "episode before the next site"
    );
  }

  /* Results saved by the earlier v1 model contain only a detour count. */
  if (evidence.length === 0 && getCount(entry, "detours")) {
    evidence.push(`${getCount(entry, "detours")} recurring detours`);
  }

  return evidence.length
    ? evidence.join(" · ")
    : "Not enough detailed evidence has been stored yet.";
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

  /*
   * Every history-derived string uses textContent. A domain can therefore
   * never be interpreted as markup or executable code in this page.
   */
  heading.append(domain, label);
  row.append(heading, evidence);

  actions.className = "history-pattern-actions";

  if (!entry.existingCategory && resultKind !== "learned") {
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "secondary compact";
    addButton.textContent = "Treat as distraction";
    addButton.addEventListener("click", () => {
      saveHistoryClassification(entry.domain, "distraction");
    });
    actions.append(addButton);
  }

  const neutralButton = document.createElement("button");
  neutralButton.type = "button";
  neutralButton.className = "text-button compact";
  neutralButton.textContent = "Mark neutral";
  neutralButton.addEventListener("click", () => {
    saveHistoryClassification(entry.domain, "neutral");
  });
  actions.append(neutralButton);
  row.append(actions);

  return row;
}

async function saveHistoryClassification(domain, category) {
  if (!domain || !VALID_CATEGORIES.includes(category)) {
    return;
  }

  const storedState = await chrome.storage.local.get({
    categoryRules: {},
    learnedDistractions: []
  });
  const categoryRules = { ...storedState.categoryRules };
  categoryRules[domain] = category;

  /* A direct user decision always overrides an automatic history inference. */
  const learnedDistractions = storedState.learnedDistractions.filter(
    (entry) => entry.domain !== domain
  );

  await chrome.storage.local.set({
    categoryRules,
    learnedDistractions
  });
  await chrome.runtime.sendMessage({ type: "analyzeHistory" });
  await loadDashboard();
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
    `${continuity.recentContinuity}/100`;
  getElement("continuityLabel").textContent = continuity.recentBand;

  if (continuity.hasComparisonBaseline) {
    const direction = continuity.changeFromBaseline >= 0
      ? "more fragmented"
      : "less fragmented";
    const absoluteChange = Math.abs(continuity.changeFromBaseline);
    const notableText = continuity.switchingIncreased
      ? " That is a notable increase, worth reviewing—not a reason to block."
      : "";

    getElement("continuityDetail").textContent =
      `The recent median is ${absoluteChange} points ${direction} than your ` +
      `earlier baseline.${notableText}`;
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
    ? "Disable"
    : currentState.historyInsightsEnabled
      ? "Restore access"
      : "Enable";
  historyButton.classList.toggle(
    "danger",
    featureIsActive
  );
  refreshButton.classList.toggle("hidden", !featureIsActive);

  clearElement(learnedList);
  clearElement(candidateList);

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
      : `Last analyzed ${analyzedAt}. Run it again to use the clearer v2 model.`;
  } else {
    analysisSummary.textContent =
      "History access is ready. Choose Analyze now to build the first result.";
  }

  if (learnedDomains.length === 0) {
    const emptyMessage = featureIsActive
      ? "No uncategorized domain has crossed the cautious learning rules yet."
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

// ---------------------------------------------------------------------------
// Settings and summary numbers
// ---------------------------------------------------------------------------

function renderSettings(currentState) {
  getElement("minutes").value = currentState.lockMinutes;
  getElement("strict").checked = currentState.strictLock;
  getElement("pinned").checked = currentState.allowPinned;
  getElement("mouseCoachEnabled").checked =
    currentState.mouseCoachEnabled !== false;
  getElement("mouseResetSeconds").value = clampWholeNumber(
    currentState.mouseResetSeconds,
    MINIMUM_MOUSE_RESET_SECONDS,
    MAXIMUM_MOUSE_RESET_SECONDS,
    DEFAULT_MOUSE_RESET_SECONDS
  );
  getElement("signalsBeforeIntentPrompt").value = clampWholeNumber(
    currentState.signalsBeforeIntentPrompt,
    MINIMUM_SIGNALS_BEFORE_PROMPT,
    MAXIMUM_SIGNALS_BEFORE_PROMPT,
    DEFAULT_SIGNALS_BEFORE_PROMPT
  );
  getElement("rabbitHoleCoachEnabled").checked =
    currentState.rabbitHoleCoachEnabled !== false;
  getElement("rabbitHoleDepth").value = clampWholeNumber(
    currentState.rabbitHoleDepth,
    MINIMUM_RABBIT_HOLE_DEPTH,
    MAXIMUM_RABBIT_HOLE_DEPTH,
    DEFAULT_RABBIT_HOLE_DEPTH
  );
  getElement("scrollCoachEnabled").checked =
    currentState.scrollCoachEnabled !== false;
  getElement("infiniteFeedCoachEnabled").checked =
    currentState.infiniteFeedCoachEnabled !== false;
  getElement("scrollMinutesBeforePrompt").value = clampWholeNumber(
    currentState.scrollMinutesBeforePrompt,
    MINIMUM_SCROLL_MINUTES,
    MAXIMUM_SCROLL_MINUTES,
    DEFAULT_SCROLL_MINUTES
  );
  getElement("screenToneEnabled").checked =
    currentState.screenToneEnabled === true;
  getElement("whitelist").value = (currentState.whitelist || []).join("\n");

  /*
   * Object.entries converts { "site.com": "news" } into pairs such as
   * ["site.com", "news"], which are easy to turn into editable lines.
   */
  getElement("rules").value = Object.entries(
    currentState.categoryRules || {}
  )
    .map(([domain, category]) => `${domain} = ${category}`)
    .join("\n");

  updateCoachControlAvailability();
}

function renderTotals(currentState) {
  const totals = currentState.stats?.totals || {};

  getElement("tResets").textContent = getCount(
    totals,
    "mouseResetsCompleted"
  );
  getElement("tReturned").textContent = getCount(totals, "returnedToTask");
  getElement("tSaved").textContent = getCount(totals, "savedForLater");
  getElement("tIntentions").textContent =
    getCount(totals, "intentPromptsCompleted") +
    getCount(totals, "intentionalOpens") +
    getCount(totals, "driftReflectionsCompleted");
}

function countMousePatterns(day) {
  /*
   * The background keeps these two broad counters compatible with older
   * installs. Newer loop/reversal and blank/repeat events also increment the
   * broad counters, so we intentionally do not add both and double-count.
   */
  return (
    getCount(day, "pointerWanders") +
    getCount(day, "lowValueClicks")
  );
}

function countTabShifts(day) {
  return getCount(day, "blockedTabs") + getCount(day, "shortDetours");
}

function countOnPageCheckpoints(day) {
  return (
    getCount(day, "rabbitHoleCheckpoints") +
    getCount(day, "sustainedScrolling") +
    getCount(day, "infiniteFeedCheckpoints")
  );
}

function countRecoveryActions(day) {
  return (
    getCount(day, "mouseResetsCompleted") +
    getCount(day, "returnedToTask") +
    getCount(day, "savedForLater")
  );
}

function countWrittenIntentions(day) {
  return (
    getCount(day, "intentPromptsCompleted") +
    getCount(day, "intentionalOpens") +
    getCount(day, "driftReflectionsCompleted")
  );
}

function renderTodaySummary(currentState) {
  const days = currentState.stats?.days || {};
  const today = days[getDateKey(new Date())] || {};

  /*
   * These are direct counts, not a score. "Patterns noticed" combines mouse
   * patterns and tab shifts; "recovery actions" counts observable next steps.
   */
  getElement("todayNoticed").textContent =
    countMousePatterns(today) +
    countTabShifts(today) +
    countOnPageCheckpoints(today);
  getElement("todayRecovered").textContent = countRecoveryActions(today);
  getElement("todayIntentions").textContent = countWrittenIntentions(today);
  getElement("todayLinkedVisits").textContent =
    getCount(today, "linkedPageVisits");
  getElement("todayRabbitCheckpoints").textContent =
    getCount(today, "rabbitHoleCheckpoints");
  getElement("todayScrollCheckpoints").textContent =
    getCount(today, "sustainedScrolling");
  getElement("todayInfiniteFeeds").textContent =
    getCount(today, "infiniteFeedCheckpoints");
  getElement("todayToneWords").textContent =
    `${getCount(today, "negativeToneWordHits")} / ` +
    `${getCount(today, "toneSampledWords")}`;
  const negativeSampleCount = getCount(today, "negativeToneSamples");
  getElement("todayNegativeTone").textContent =
    `${negativeSampleCount} negative-leaning ` +
    `${negativeSampleCount === 1 ? "sample" : "samples"}`;
}

// ---------------------------------------------------------------------------
// Seven-day pattern table
// ---------------------------------------------------------------------------

function createTableCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = String(text);
  cell.className = className;
  return cell;
}

function renderSevenDayPatterns(currentState) {
  const dailyRows = getElement("dailyRows");
  const storedDays = currentState.stats?.days || {};
  clearElement(dailyRows);

  // Six days ago through today gives seven rows, oldest to newest.
  for (
    let daysAgo = DAYS_IN_PATTERN_TABLE - 1;
    daysAgo >= 0;
    daysAgo -= 1
  ) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);

    const values = storedDays[getDateKey(date)] || {};
    const returnedOrSaved =
      getCount(values, "returnedToTask") +
      getCount(values, "savedForLater");
    const row = document.createElement("tr");
    const dayName = daysAgo === 0
      ? "Today"
      : date.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric"
        });

    /*
     * Every cell shows the stored integer directly. This is easier to compare
     * than bars whose visual heights need an arbitrary multiplier.
     */
    row.append(
      createTableCell(dayName, "daily-day"),
      createTableCell(countMousePatterns(values), "daily-number"),
      createTableCell(countTabShifts(values), "daily-number"),
      createTableCell(countOnPageCheckpoints(values), "daily-number"),
      createTableCell(
        getCount(values, "mouseResetsCompleted"),
        "daily-number daily-recovery"
      ),
      createTableCell(
        returnedOrSaved,
        "daily-number daily-recovery"
      ),
      createTableCell(
        getCount(values, "intentionalOpens"),
        "daily-number daily-intent"
      )
    );

    dailyRows.append(row);
  }
}

// ---------------------------------------------------------------------------
// Plain-English activity sessions
// ---------------------------------------------------------------------------

function describeActivityEvent(event) {
  const details = event.data || {};
  const roundedDistance = getCount(details, "distancePixels");
  const movementCount = getCount(details, "moveCount");
  const durationSeconds = getCount(details, "durationSeconds");
  const reversalCount = getCount(details, "reversalCount");
  const movementFacts = [];

  if (roundedDistance) {
    movementFacts.push(`about ${roundedDistance.toLocaleString()} pixels`);
  }

  if (movementCount) {
    movementFacts.push(`${movementCount} sampled moves`);
  }

  if (durationSeconds) {
    movementFacts.push(`${durationSeconds} seconds`);
  }

  if (details.startRegion && details.endRegion) {
    movementFacts.push(
      `from ${details.startRegion} to ${details.endRegion}`
    );
  }

  const movementDetail = movementFacts.length
    ? ` Details: ${movementFacts.join(", ")}.`
    : "";

  /*
   * The storage metric names are useful to programmers, but they are not
   * friendly sentences. This switch is the translation layer between the two.
   */
  switch (event.metric) {
    case "pointerLoops":
      return (
        "The pointer travelled and returned near where it began." +
        movementDetail
      );
    case "pointerReversals":
      return (
        `The pointer reversed direction ${reversalCount || "several"} times.` +
        movementDetail
      );
    case "pointerWanders":
      return (
        "The pointer moved substantially without landing on a page action." +
        movementDetail
      );
    case "blankAreaClicks":
      return details.pageRegion
        ? `A page area without a recognized control was clicked in the ` +
            `${details.pageRegion} region.`
        : "A page area without a recognized control was clicked.";
    case "repeatedClicks":
      return details.millisecondsSincePreviousClick
        ? `The same ${details.elementKind || "control"} was clicked again ` +
            `after ${details.millisecondsSincePreviousClick} milliseconds.`
        : "The same page control was clicked again very quickly.";
    case "lowValueClicks":
      // Older installations may still contain this legacy aggregate event.
      return "A click did not appear to activate a page control.";
    case "shortDetours":
      return details.durationSeconds
        ? `This page was left again after ${details.durationSeconds} seconds.`
        : "This page was left again after a short visit.";
    case "rabbitHoleCheckpoints": {
      const depth = getCount(details, "linkDepth");
      const domainCount = getCount(details, "uniqueDomainCount");
      const minutes = getCount(details, "durationMinutes");
      const facts = [];

      if (depth) {
        facts.push(`${depth} successive linked pages`);
      }

      if (domainCount) {
        facts.push(`${domainCount} distinct domains`);
      }

      if (minutes) {
        facts.push(`about ${minutes} minutes`);
      }

      return facts.length
        ? `A hyperlink trail reached its checkpoint: ${facts.join(", ")}.`
        : "A hyperlink trail reached its chosen checkpoint.";
    }
    case "sustainedScrolling": {
      const scrollingFacts = [];

      if (getCount(details, "activeSeconds")) {
        scrollingFacts.push(
          `${getCount(details, "activeSeconds")} active seconds`
        );
      }

      if (Number(details.downwardScreens)) {
        scrollingFacts.push(`${details.downwardScreens} screens downward`);
      }

      if (getCount(details, "scrollBursts")) {
        scrollingFacts.push(`${getCount(details, "scrollBursts")} bursts`);
      }

      if (Number(details.pageGrowthScreens) >= 1) {
        scrollingFacts.push(
          `the page grew ${details.pageGrowthScreens} screen lengths`
        );
      }

      const toneText = details.toneBand
        ? ` The optional visible sample was ${details.toneBand} ` +
          `(${getCount(details, "negativeHits")} negative-list and ` +
          `${getCount(details, "positiveHits")} positive-list matches among ` +
          `${getCount(details, "sampledWords")} sampled words).`
        : "";

      return (
        "Sustained scrolling reached its chosen checkpoint" +
        (scrollingFacts.length ? `: ${scrollingFacts.join(", ")}.` : ".") +
        toneText
      );
    }
    case "infiniteFeedCheckpoints": {
      const imageLoads = getCount(details, "imageLoads");
      const videoLoads = getCount(details, "videoLoads");
      const elapsedSeconds = getCount(details, "elapsedSeconds");
      const hardLockWasRequested = details.hardLockRequested !== false;
      const mediaParts = [];
      const checkpointOpening = hardLockWasRequested
        ? "The infinite-feed hard checkpoint opened after ten newly loaded " +
          "visual items"
        : "Ten newly loaded visual items completed a feed checkpoint while " +
          "its hard lock was off";

      if (imageLoads) {
        mediaParts.push(`${imageLoads} images`);
      }

      if (videoLoads) {
        mediaParts.push(`${videoLoads} videos`);
      }

      return (
        checkpointOpening +
        (mediaParts.length ? ` (${mediaParts.join(", ")})` : "") +
        (elapsedSeconds ? ` across ${elapsedSeconds} seconds.` : ".")
      );
    }
    case "blockedTabs":
      return details.attemptNumber
        ? `Extra tab attempt ${details.attemptNumber} was held safely on the ` +
            "pause page."
        : "An extra tab was held safely on the pause page.";
    case "returnedToTask":
      return "You chose to return to the earlier task.";
    case "savedForLater":
      return "You saved this destination for later.";
    case "intentionalOpens":
      return "You opened this destination after writing why it was needed.";
    case "intentPromptsCompleted":
      return "You wrote down your next action before continuing.";
    case "mouseResetsCompleted":
      return details.stillSeconds
        ? `You completed a ${details.stillSeconds}-second hands-off reset.`
        : "You completed a hands-off mouse reset.";
    case "tabsOpened":
      return "A new tab opened.";
    case "distractionOpens":
      return "A new tab matched one of your editable website categories.";
    case "sensationalVisits":
      // This older storage name is intentionally translated without judgment.
      return "A page matched one of your editable website categories.";
    default:
      return "Behavyour recorded an activity pattern.";
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
  /*
   * Session summaries store the specific newer metrics, unlike the daily
   * counters. Include legacy broad metrics as fallbacks for older sessions.
   */
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

function createSessionChip(text, extraClass = "") {
  const chip = document.createElement("span");
  chip.className = `session-chip ${extraClass}`.trim();
  chip.textContent = text;
  return chip;
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

  if (event.intent) {
    const intentLine = document.createElement("p");
    const intentLabel = document.createElement("strong");
    const intentText = document.createElement("span");

    intentLine.className = "saved-intent";
    intentLabel.textContent = "Saved intent: ";

    /*
     * Important safety detail: textContent displays the intention literally.
     * Even text containing <script> remains text and can never become code.
     */
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

function createSessionCard(session, index) {
  const card = document.createElement("details");
  const heading = document.createElement("summary");
  const headingText = document.createElement("span");
  const title = document.createElement("strong");
  const eventCount = document.createElement("small");
  const chips = document.createElement("span");
  const eventList = document.createElement("ol");
  const summary = session.summary || {};
  const events = (session.events || [])
    .slice(0, MAXIMUM_EVENTS_SHOWN_PER_SESSION)
    .reverse();
  const recoveryCount =
    getCount(summary, "mouseResetsCompleted") +
    getCount(summary, "returnedToTask") +
    getCount(summary, "savedForLater");
  const intentionCount =
    getCount(summary, "intentPromptsCompleted") +
    getCount(summary, "intentionalOpens") +
    getCount(summary, "driftReflectionsCompleted");

  card.className = "session-card";
  card.open = index === 0;
  headingText.className = "session-heading-text";
  chips.className = "session-chips";
  eventList.className = "session-events";
  title.textContent = formatSessionRange(session);
  eventCount.textContent =
    `${session.events?.length || 0} recorded ` +
    `${session.events?.length === 1 ? "event" : "events"}`;
  headingText.append(title, eventCount);

  chips.append(
    createSessionChip(`${countSessionPatterns(summary)} noticed`),
    createSessionChip(`${recoveryCount} recoveries`, "recovery-chip"),
    createSessionChip(`${intentionCount} intentions`, "intent-chip")
  );
  heading.append(headingText, chips);

  events.forEach((event) => {
    eventList.append(createSessionEvent(event));
  });

  if (events.length === 0) {
    eventList.append(createHint("No event details were stored for this session."));
  }

  card.append(heading, eventList);

  if ((session.events || []).length > events.length) {
    card.append(
      createHint(
        `Showing the newest ${MAXIMUM_EVENTS_SHOWN_PER_SESSION} events in this session.`
      )
    );
  }

  return card;
}

function renderActivitySessions(currentState) {
  const sessionLog = getElement("sessionLog");
  const sessions = [...(currentState.activitySessions || [])]
    .sort((first, second) => second.startedAt - first.startedAt)
    .slice(0, MAXIMUM_SESSIONS_SHOWN);
  clearElement(sessionLog);

  if (sessions.length === 0) {
    sessionLog.append(
      createHint(
        "No activity sessions yet. When a pattern appears, Behavyour will " +
          "explain what it noticed and what happened next."
      )
    );
    return;
  }

  sessions.forEach((session, index) => {
    sessionLog.append(createSessionCard(session, index));
  });

  if ((currentState.activitySessions || []).length > sessions.length) {
    sessionLog.append(
      createHint(`Showing the ${MAXIMUM_SESSIONS_SHOWN} most recent sessions.`)
    );
  }
}

async function loadDashboard() {
  const currentState = await chrome.runtime.sendMessage({ type: "getState" });

  renderHistoryInsights(currentState);
  renderSettings(currentState);
  renderTotals(currentState);
  renderTodaySummary(currentState);
  renderSevenDayPatterns(currentState);
  renderActivitySessions(currentState);
}

// ---------------------------------------------------------------------------
// Turning editable text fields back into stored settings
// ---------------------------------------------------------------------------

function parseWhitelist(text) {
  const enteredDomains = text
    .split(/\n/)
    .map(normalizeEnteredDomain)
    .filter(Boolean);

  // A Set removes duplicates; spreading it back out produces a normal array.
  return [...new Set(enteredDomains)];
}

function normalizeEnteredDomain(rawValue) {
  const cleanedValue = String(rawValue || "").trim().toLowerCase();

  if (!cleanedValue) {
    return "";
  }

  try {
    const address = cleanedValue.includes("://")
      ? cleanedValue
      : `https://${cleanedValue}`;
    return new URL(address).hostname.replace(/^www\./, "");
  } catch {
    // Invalid lines are ignored instead of saving a rule that can never match.
    return "";
  }
}

function parseCategoryRules(text) {
  const categoryRules = {};

  text.split(/\n/).forEach((line) => {
    /*
     * Destructuring puts the first two pieces around "=" into named values.
     * Optional chaining (`?.`) avoids an error when the right side is missing.
     */
    const [rawDomain, rawCategory] = line.split("=");
    const domain = normalizeEnteredDomain(rawDomain);
    const category = rawCategory?.trim().toLowerCase();

    if (domain && VALID_CATEGORIES.includes(category)) {
      categoryRules[domain] = category;
    }
  });

  return categoryRules;
}

function updateCoachControlAvailability() {
  const mouseCoachIsEnabled = getElement("mouseCoachEnabled").checked;
  const rabbitCoachIsEnabled = getElement(
    "rabbitHoleCoachEnabled"
  ).checked;
  const scrollCoachIsEnabled = getElement("scrollCoachEnabled").checked;
  const infiniteFeedCoachIsEnabled = getElement(
    "infiniteFeedCoachEnabled"
  ).checked;

  /*
   * Disabled dependent fields make it visually clear which switch controls
   * them. Their saved values remain ready for the next time that coach is on.
   */
  getElement("mouseResetSeconds").disabled = !(
    mouseCoachIsEnabled ||
    rabbitCoachIsEnabled ||
    scrollCoachIsEnabled ||
    infiniteFeedCoachIsEnabled
  );
  getElement("signalsBeforeIntentPrompt").disabled = !mouseCoachIsEnabled;
}

async function saveSettings() {
  const whitelist = parseWhitelist(getElement("whitelist").value);
  const categoryRules = parseCategoryRules(getElement("rules").value);
  const enteredMinutes = Number(getElement("minutes").value) || 0;
  const safeMinutes = Math.max(0, Math.min(60, enteredMinutes));
  const safeResetSeconds = clampWholeNumber(
    getElement("mouseResetSeconds").value,
    MINIMUM_MOUSE_RESET_SECONDS,
    MAXIMUM_MOUSE_RESET_SECONDS,
    DEFAULT_MOUSE_RESET_SECONDS
  );
  const safeSignalsBeforePrompt = clampWholeNumber(
    getElement("signalsBeforeIntentPrompt").value,
    MINIMUM_SIGNALS_BEFORE_PROMPT,
    MAXIMUM_SIGNALS_BEFORE_PROMPT,
    DEFAULT_SIGNALS_BEFORE_PROMPT
  );
  const safeRabbitHoleDepth = clampWholeNumber(
    getElement("rabbitHoleDepth").value,
    MINIMUM_RABBIT_HOLE_DEPTH,
    MAXIMUM_RABBIT_HOLE_DEPTH,
    DEFAULT_RABBIT_HOLE_DEPTH
  );
  const safeScrollMinutes = clampWholeNumber(
    getElement("scrollMinutesBeforePrompt").value,
    MINIMUM_SCROLL_MINUTES,
    MAXIMUM_SCROLL_MINUTES,
    DEFAULT_SCROLL_MINUTES
  );

  // Put clamped values back into the fields so the visible value matches storage.
  getElement("mouseResetSeconds").value = safeResetSeconds;
  getElement("signalsBeforeIntentPrompt").value = safeSignalsBeforePrompt;
  getElement("rabbitHoleDepth").value = safeRabbitHoleDepth;
  getElement("scrollMinutesBeforePrompt").value = safeScrollMinutes;

  await chrome.storage.local.set({
    lockMinutes: safeMinutes,
    strictLock: getElement("strict").checked,
    allowPinned: getElement("pinned").checked,
    mouseCoachEnabled: getElement("mouseCoachEnabled").checked,
    mouseResetSeconds: safeResetSeconds,
    signalsBeforeIntentPrompt: safeSignalsBeforePrompt,
    rabbitHoleCoachEnabled: getElement("rabbitHoleCoachEnabled").checked,
    rabbitHoleDepth: safeRabbitHoleDepth,
    scrollCoachEnabled: getElement("scrollCoachEnabled").checked,
    scrollMinutesBeforePrompt: safeScrollMinutes,
    infiniteFeedCoachEnabled: getElement(
      "infiniteFeedCoachEnabled"
    ).checked,
    screenToneEnabled: getElement("screenToneEnabled").checked,
    whitelist,
    categoryRules
  });

  getElement("saved").textContent = "Saved";
  setTimeout(() => {
    getElement("saved").textContent = "";
  }, SAVED_MESSAGE_DURATION);
}

/*
 * Autosave uses a debounce: every keystroke restarts this short timer. Saving
 * happens only after the user pauses, rather than once per typed character.
 */
const autosavedControlIds = [
  "minutes",
  "strict",
  "pinned",
  "mouseCoachEnabled",
  "mouseResetSeconds",
  "signalsBeforeIntentPrompt",
  "rabbitHoleCoachEnabled",
  "rabbitHoleDepth",
  "scrollCoachEnabled",
  "scrollMinutesBeforePrompt",
  "infiniteFeedCoachEnabled",
  "screenToneEnabled",
  "whitelist",
  "rules"
];

autosavedControlIds.forEach((controlId) => {
  getElement(controlId).addEventListener("input", () => {
    if (
      controlId === "mouseCoachEnabled" ||
      controlId === "rabbitHoleCoachEnabled" ||
      controlId === "scrollCoachEnabled" ||
      controlId === "infiniteFeedCoachEnabled"
    ) {
      updateCoachControlAvailability();
    }

    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveSettings, AUTOSAVE_DELAY);
  });
});

// ---------------------------------------------------------------------------
// Explicit dashboard actions
// ---------------------------------------------------------------------------

getElement("reset").addEventListener("click", async () => {
  const userConfirmed = window.confirm(
    "Delete activity counts, session details, and saved intention notes from " +
      "this device? Settings, learned history, and tabs saved for later will stay."
  );

  if (!userConfirmed) {
    return;
  }

  /*
   * This intentionally resets activity and short-lived intervention counters
   * only. User settings, learned history, the optional permission, and tabs
   * already saved for later remain unchanged.
   */
  await chrome.storage.local.set({
    stats: {
      days: {},
      totals: {}
    },
    recent: [],
    activitySessions: [],
    recentTabAttempts: [],
    recentQuestionableSignals: [],
    lastIntentPromptAt: 0,
    activeTabByWindow: {},
    navigationTrails: {},
    lockUntil: 0
  });

  await loadDashboard();
});

getElement("historyToggle").addEventListener("click", async () => {
  const savedSetting = await chrome.storage.local.get(
    "historyInsightsEnabled"
  );
  const permissionIsGranted = await chrome.permissions.contains({
    permissions: ["history"]
  });

  if (savedSetting.historyInsightsEnabled && permissionIsGranted) {
    await chrome.runtime.sendMessage({ type: "disableHistoryInsights" });
    await chrome.permissions.remove({ permissions: ["history"] });
  } else {
    /*
     * Permission requests must remain inside a real click handler so Chrome
     * knows the user initiated them.
     */
    const permissionWasGranted = await chrome.permissions.request({
      permissions: ["history"]
    });

    if (permissionWasGranted) {
      await chrome.runtime.sendMessage({ type: "enableHistoryInsights" });
    }
  }

  await loadDashboard();
});

getElement("historyRefresh").addEventListener("click", async () => {
  const refreshButton = getElement("historyRefresh");
  refreshButton.disabled = true;
  refreshButton.textContent = "Analyzing…";
  getElement("historyAnalysisSummary").textContent =
    "Reading visit timestamps locally and rebuilding the evidence…";

  try {
    await chrome.runtime.sendMessage({ type: "analyzeHistory" });
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Analyze now";
    await loadDashboard();
  }
});

// The script is at the end of dashboard.html, so its HTML elements exist now.
loadDashboard();
