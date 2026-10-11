// Service worker: settings, activity, tab pauses, and optional local history analysis.

// Defaults and built-in knowledge

const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const HISTORY_LOOKBACK_DAYS = 30;
const HISTORY_RESULT_LIMIT = 2000;
const HISTORY_FETCH_BATCH_SIZE = 25;
const DETOUR_WINDOW_MINUTES = 10;
const MAXIMUM_DETOUR_EPISODE_MINUTES = 5;
const MINIMUM_MEANINGFUL_HISTORY_GAP_SECONDS = 10;
const MINIMUM_DETOURS_TO_LEARN = 3;
const MINIMUM_DETOUR_DAYS_TO_LEARN = 3;
const DOMAIN_EPISODE_GAP_MINUTES = 10;
const BRIEF_HISTORY_VISIT_SECONDS = 120;
const REPEAT_CHECK_WINDOW_MINUTES = 60;
const MINIMUM_EPISODES_TO_LEARN = 8;
const MINIMUM_MEASURABLE_EXITS_TO_LEARN = 5;
const MINIMUM_BRIEF_EXITS_TO_LEARN = 5;
const MINIMUM_REPEAT_CHECKS_TO_LEARN = 3;
const MINIMUM_ACTIVE_DAYS_TO_LEARN = 3;
const MINIMUM_CONTEXTS_TO_LEARN = 2;
const MINIMUM_SIGNAL_DAYS_TO_LEARN = 2;
const MINIMUM_DETOUR_DOMINANCE = 0.67;
const MAXIMUM_REDIRECT_LIKE_EXIT_RATE = 0.5;
const HISTORY_SESSION_GAP_MINUTES = 20;
const MINIMUM_CONTINUITY_SESSION_MINUTES = 10;
const MINIMUM_CONTINUITY_EPISODES = 8;
const MINIMUM_CONTINUITY_TRANSITIONS = 6;
const MINIMUM_CONTINUITY_TRANSITION_SECONDS = 5;
const MAXIMUM_CONTINUITY_TRANSITION_MINUTES = 5;
const RAPID_CONTINUITY_TRANSITION_SECONDS = 90;
const MAXIMUM_CONTINUITY_RETURN_LOOP_MINUTES = 5;
const RECENT_CONTINUITY_DAYS = 7;
const MAXIMUM_LEARNED_DOMAINS = 5;
const MAXIMUM_ACTIVITY_SESSIONS = 30;
const MAXIMUM_EVENTS_PER_SESSION = 60;
const SESSION_INACTIVITY_MINUTES = 20;
const RECENT_TAB_ATTEMPT_MINUTES = 15;
const SHORT_DETOUR_SECONDS = 30;
const MINIMUM_INTENT_CHARACTERS = 8;
const MINIMUM_TAB_INTENT_CHARACTERS = 12;
const MINIMUM_DRIFT_REFLECTION_WORDS = 50;
const MAXIMUM_DRIFT_REFLECTION_CHARACTERS = 2000;
const MAXIMUM_PENDING_TABS = 50;
const PENDING_TAB_LIFETIME_HOURS = 7 * 24;
const INTENT_PROMPT_SIGNAL_WINDOW_SECONDS = 90;
const INTENT_PROMPT_COOLDOWN_MINUTES = 10;
const RABBIT_TRAIL_WINDOW_MINUTES = 20;
const LINK_DEPARTURE_MATCH_SECONDS = 15;
const MINIMUM_RABBIT_HOLE_DEPTH = 5;
const MAXIMUM_RABBIT_HOLE_DEPTH = 12;
const PENDING_DRIFT_SESSION_KEY = "pendingDriftReflections";
const REFLECTION_WORD_SEGMENTER = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "word" })
  : null;

const EMPTY_TOTALS = {
  tabsOpened: 0,
  blockedTabs: 0,
  sensationalVisits: 0,
  distractionOpens: 0,
  pointerWanders: 0,
  pointerLoops: 0,
  pointerReversals: 0,
  lowValueClicks: 0,
  blankAreaClicks: 0,
  repeatedClicks: 0,
  shortDetours: 0,
  intentPromptsCompleted: 0,
  mouseResetsCompleted: 0,
  returnedToTask: 0,
  savedForLater: 0,
  intentionalOpens: 0,
  linkedPageVisits: 0,
  rabbitHoleCheckpoints: 0,
  sustainedScrolling: 0,
  infiniteFeedCheckpoints: 0,
  driftReflectionsCompleted: 0,
  negativeToneSamples: 0,
  toneSampledWords: 0,
  negativeToneWordHits: 0,
  positiveToneWordHits: 0
};

const DEFAULTS = {
  enabled: true,
  lockMinutes: 3,
  strictLock: true,
  allowPinned: true,
  mouseCoachEnabled: true,
  mouseResetSeconds: 5,
  signalsBeforeIntentPrompt: 2,
  rabbitHoleCoachEnabled: true,
  rabbitHoleDepth: 7,
  scrollCoachEnabled: true,
  scrollMinutesBeforePrompt: 2,
  infiniteFeedCoachEnabled: true,
  screenToneEnabled: false,
  whitelist: [],
  categoryRules: {},
  historyInsightsEnabled: false,
  learnedDistractions: [],
  historyAnalysis: {
    lastRun: 0,
    modelVersion: 3,
    lookbackDays: HISTORY_LOOKBACK_DAYS,
    analyzedVisits: 0,
    analyzedEpisodes: 0,
    coverageLimited: false,
    failedUrlCount: 0,
    navigationContinuity: null,
    linkTrails: null,
    candidates: [],
    knownPatterns: []
  },
  lockUntil: 0,
  pendingTabs: [],
  recentTabAttempts: [],
  activitySessions: [],
  activeTabByWindow: {},
  navigationTrails: {},
  recentQuestionableSignals: [],
  lastIntentPromptAt: 0,
  stats: {
    days: {},
    totals: { ...EMPTY_TOTALS }
  },
  recent: []
};

// User rules override these initial category guesses.
const CATEGORIES = {
  video: [
    "youtube.com",
    "youtu.be",
    "tiktok.com",
    "vimeo.com",
    "dailymotion.com",
    "twitch.tv"
  ],
  news: [
    "cnn.com",
    "bbc.com",
    "nytimes.com",
    "foxnews.com",
    "news.google.com",
    "reuters.com",
    "theguardian.com",
    "indiatimes.com",
    "ndtv.com"
  ],
  social: [
    "facebook.com",
    "instagram.com",
    "x.com",
    "twitter.com",
    "reddit.com",
    "snapchat.com",
    "pinterest.com"
  ],
  entertainment: [
    "netflix.com",
    "hotstar.com",
    "primevideo.com",
    "hulu.com",
    "buzzfeed.com",
    "tmz.com"
  ]
};

// Only approved content-script metrics can create statistics keys.
const CONTENT_BEHAVIOR_METRICS = new Set([
  "pointerWanders",
  "pointerLoops",
  "pointerReversals",
  "blankAreaClicks",
  "repeatedClicks",
  "sustainedScrolling",
  "infiniteFeedCheckpoints",
  "mouseResetsCompleted"
]);

const IMMEDIATE_INTENT_METRICS = new Set([
  "rabbitHoleCheckpoints",
  "sustainedScrolling",
  "infiniteFeedCheckpoints"
]);

// Small reusable helpers

function getLocalDateKey(date) {
  // Use local calendar days; ISO dates would roll over at UTC midnight.
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayKey() {
  return getLocalDateKey(new Date());
}

function getHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isWebUrl(url) {
  return /^https?:\/\//.test(url || "");
}

function domainMatches(host, domain) {
  const normalizedDomain = String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/^www\./, "");

  // Also matches subdomains: "mail.example.com" matches "example.com".
  return Boolean(
    normalizedDomain &&
    (host === normalizedDomain || host.endsWith(`.${normalizedDomain}`))
  );
}

async function getState() {
  // Merge nested defaults so existing installations retain their data after an update.
  const storedState = await chrome.storage.local.get(DEFAULTS);

  storedState.stats = storedState.stats || { days: {}, totals: {} };
  storedState.stats.days = storedState.stats.days || {};
  storedState.stats.totals = {
    ...EMPTY_TOTALS,
    ...(storedState.stats.totals || {})
  };
  storedState.historyAnalysis = {
    ...DEFAULTS.historyAnalysis,
    ...(storedState.historyAnalysis || {})
  };
  const oldRecentDetailsWerePresent = (storedState.recent || []).length > 0;
  storedState.recent = [];
  storedState.pendingTabs = storedState.pendingTabs || [];
  storedState.recentTabAttempts = storedState.recentTabAttempts || [];
  storedState.activitySessions = storedState.activitySessions || [];
  storedState.activeTabByWindow = storedState.activeTabByWindow || {};
  storedState.navigationTrails = storedState.navigationTrails || {};
  storedState.recentQuestionableSignals =
    storedState.recentQuestionableSignals || [];

  const pendingCountBeforePruning = storedState.pendingTabs.length;
  pruneExpiredPendingTabs(storedState);

  if (
    storedState.pendingTabs.length !== pendingCountBeforePruning ||
    oldRecentDetailsWerePresent
  ) {
    await chrome.storage.local.set({
      pendingTabs: storedState.pendingTabs,
      recent: []
    });
  }

  return storedState;
}

function isWhitelisted(url, currentState) {
  const host = getHost(url);

  return (currentState.whitelist || []).some((allowedDomain) =>
    domainMatches(host, allowedDomain)
  );
}

// Website categorization

function getCategoryForUrl(url, currentState) {
  const host = getHost(url);
  if (!host) return null;

  const userCategory = getUserCategoryRule(host, currentState);
  if (userCategory) return userCategory === "neutral" ? null : userCategory;

  // Domains inferred by the optional history feature come next.
  const isLearnedDistraction = (
    currentState.learnedDistractions || []
  ).some((entry) => domainMatches(host, entry.domain));

  if (isLearnedDistraction) {
    return "learned distraction";
  }

  return getBuiltInCategory(host) || null;
}

// Optional browser-history analysis

let historyDataRevision = 0;
let historyAnalysisInFlight = null;

function findMiddleNumber(numbers) {
  if (numbers.length === 0) {
    return null;
  }

  const sortedNumbers = [...numbers].sort((first, second) => first - second);
  const middleIndex = Math.floor(sortedNumbers.length / 2);

  if (sortedNumbers.length % 2 === 1) {
    return sortedNumbers[middleIndex];
  }

  return Math.round(
    (sortedNumbers[middleIndex - 1] + sortedNumbers[middleIndex]) / 2
  );
}

function groupHistoryIntoDomainEpisodes(visits, domainByVisitId) {
  const episodes = [];
  const groupingWindow =
    DOMAIN_EPISODE_GAP_MINUTES * MILLISECONDS_PER_MINUTE;

  visits.forEach((visit) => {
    const domain = getHost(visit.url);

    if (!domain) {
      return;
    }

    const previousEpisode = episodes[episodes.length - 1];
    const referringDomain = domainByVisitId.get(visit.referringVisitId) || "";
    const hasCrossDomainReferrer = Boolean(
      referringDomain && referringDomain !== domain
    );
    const belongsToPreviousEpisode = Boolean(
      previousEpisode &&
      previousEpisode.domain === domain &&
      visit.visitTime - previousEpisode.lastActivityAt <= groupingWindow
    );

    // Nearby pages on one site form a single episode, not repeated interruptions.
    if (belongsToPreviousEpisode) {
      previousEpisode.lastActivityAt = visit.visitTime;
      previousEpisode.transitions.push(visit.transition);
      previousEpisode.hasCrossDomainReferrer =
        previousEpisode.hasCrossDomainReferrer || hasCrossDomainReferrer;
      return;
    }

    episodes.push({
      domain,
      startedAt: visit.visitTime,
      lastActivityAt: visit.visitTime,
      transitions: [visit.transition],
      hasCrossDomainReferrer
    });
  });

  return episodes;
}

function getBuiltInCategory(domain) {
  for (const [category, domains] of Object.entries(CATEGORIES)) {
    if (domains.some((knownDomain) => domainMatches(domain, knownDomain))) {
      return category;
    }
  }

  return "";
}

function getUserCategoryRule(domain, currentState) {
  for (const [ruleDomain, category] of Object.entries(
    currentState.categoryRules || {}
  )) {
    if (domainMatches(domain, ruleDomain)) {
      return category;
    }
  }

  return "";
}

function createEmptyHistoryPattern(domain) {
  return {
    domain,
    episodes: 0,
    detours: 0,
    briefExits: 0,
    veryFastExits: 0,
    repeatChecks: 0,
    deepTrailAppearances: 0,
    contextReturns: 0,
    returnSequences: 0,
    referrerLinkedEntries: 0,
    explicitOpens: 0,
    lastSeen: 0,
    measurableEpisodeDurations: [],
    activeDays: new Set(),
    detourDays: new Set(),
    briefExitDays: new Set(),
    repeatCheckDays: new Set(),
    interruptedDomains: new Set()
  };
}

function explainHistoryPattern(pattern) {
  const measurableExits = pattern.measurableEpisodeDurations.length;
  const briefVisitRate = measurableExits
    ? Math.round((pattern.briefExits / measurableExits) * 100)
    : 0;
  const medianEpisodeSeconds = findMiddleNumber(
    pattern.measurableEpisodeDurations
  );
  const activeDays = pattern.activeDays.size;
  const detourDays = pattern.detourDays.size;
  const contextsInterrupted = pattern.interruptedDomains.size;
  const coEvidenceDays = [...pattern.briefExitDays].filter((day) =>
    pattern.repeatCheckDays.has(day)
  ).length;
  const veryFastExitRate = measurableExits
    ? pattern.veryFastExits / measurableExits
    : 0;
  const totalDirectionalEvidence =
    pattern.detours + pattern.contextReturns;
  const detourDominance = totalDirectionalEvidence
    ? pattern.detours / totalDirectionalEvidence
    : 1;
  const netDetours = Math.max(
    0,
    pattern.detours - pattern.contextReturns
  );
  const briefDetourRate = pattern.returnSequences
    ? pattern.detours / pattern.returnSequences
    : 0;
  const doesNotLookLikeRedirect =
    veryFastExitRate < MAXIMUM_REDIRECT_LIKE_EXIT_RATE;

  const repeatedReturnEvidence =
    netDetours >= MINIMUM_DETOURS_TO_LEARN &&
    detourDays >= MINIMUM_DETOUR_DAYS_TO_LEARN &&
    contextsInterrupted >= MINIMUM_CONTEXTS_TO_LEARN &&
    briefDetourRate >= 0.6 &&
    detourDominance >= MINIMUM_DETOUR_DOMINANCE &&
    doesNotLookLikeRedirect;
  const fragmentedCheckingEvidence =
    pattern.episodes >= MINIMUM_EPISODES_TO_LEARN &&
    measurableExits >= MINIMUM_MEASURABLE_EXITS_TO_LEARN &&
    pattern.briefExits >= MINIMUM_BRIEF_EXITS_TO_LEARN &&
    pattern.repeatChecks >= MINIMUM_REPEAT_CHECKS_TO_LEARN &&
    pattern.briefExitDays.size >= MINIMUM_SIGNAL_DAYS_TO_LEARN &&
    pattern.repeatCheckDays.size >= MINIMUM_SIGNAL_DAYS_TO_LEARN &&
    coEvidenceDays >= MINIMUM_SIGNAL_DAYS_TO_LEARN &&
    activeDays >= MINIMUM_ACTIVE_DAYS_TO_LEARN &&
    contextsInterrupted >= MINIMUM_CONTEXTS_TO_LEARN &&
    briefVisitRate >= 60 &&
    detourDominance >= MINIMUM_DETOUR_DOMINANCE &&
    doesNotLookLikeRedirect;
  const qualifiesForLearning =
    repeatedReturnEvidence || fragmentedCheckingEvidence;

  // This weight sorts candidates; it is not an attention score.
  const sortWeight = Math.max(
    0,
    netDetours * 5 +
      pattern.repeatChecks * 2 +
      pattern.deepTrailAppearances * 2 +
      pattern.briefExits +
      Math.min(activeDays, 5) +
      Math.min(contextsInterrupted, 5)
  );

  let confidence = "early signal";

  if (qualifiesForLearning) {
    confidence = "recurring pattern";

    if (repeatedReturnEvidence && fragmentedCheckingEvidence) {
      confidence = "strong recurring pattern";
    }
  }

  return {
    domain: pattern.domain,
    episodes: pattern.episodes,
    activeDays,
    detours: pattern.detours,
    detourDays,
    briefExits: pattern.briefExits,
    briefVisitRate,
    measurableExits,
    veryFastExits: pattern.veryFastExits,
    veryFastExitRate: Math.round(veryFastExitRate * 100),
    repeatChecks: pattern.repeatChecks,
    deepTrailAppearances: pattern.deepTrailAppearances,
    contextReturns: pattern.contextReturns,
    returnSequences: pattern.returnSequences,
    netDetours,
    detourDominance: Math.round(detourDominance * 100),
    briefDetourRate: Math.round(briefDetourRate * 100),
    contextsInterrupted,
    briefExitDays: pattern.briefExitDays.size,
    repeatCheckDays: pattern.repeatCheckDays.size,
    coEvidenceDays,
    explicitOpens: pattern.explicitOpens,
    referrerLinkedEntries: pattern.referrerLinkedEntries,
    medianEpisodeSeconds,
    lastSeen: pattern.lastSeen,
    sortWeight,
    confidence,
    qualifiesForLearning
  };
}

function prepareHistoryPatternForStorage(summary) {
  // Persist calendar days and aggregates, never exact history timestamps.
  const { lastSeen, ...storedSummary } = summary;
  return {
    ...storedSummary,
    lastSeenDay: lastSeen ? getLocalDateKey(new Date(lastSeen)) : ""
  };
}

function groupEpisodesIntoHistorySessions(episodes) {
  const sessions = [];
  const sessionGap =
    HISTORY_SESSION_GAP_MINUTES * MILLISECONDS_PER_MINUTE;

  episodes.forEach((episode) => {
    let session = sessions[sessions.length - 1];
    const priorEpisode = session?.episodes[session.episodes.length - 1];
    const startsAfterQuietGap = Boolean(
      priorEpisode &&
      episode.startedAt - priorEpisode.lastActivityAt > sessionGap
    );

    if (!session || startsAfterQuietGap) {
      session = {
        startedAt: episode.startedAt,
        lastActivityAt: episode.lastActivityAt,
        episodes: []
      };
      sessions.push(session);
    }

    session.episodes.push(episode);
    session.lastActivityAt = Math.max(
      session.lastActivityAt,
      episode.lastActivityAt
    );
  });

  return sessions;
}

function calculateNavigationContinuity(episodes) {
  const historySessions = groupEpisodesIntoHistorySessions(episodes);
  const eligibleSessions = [];

  historySessions.forEach((session) => {
    const sessionMinutes =
      (session.lastActivityAt - session.startedAt) /
      MILLISECONDS_PER_MINUTE;

    if (
      session.episodes.length < MINIMUM_CONTINUITY_EPISODES ||
      sessionMinutes < MINIMUM_CONTINUITY_SESSION_MINUTES
    ) {
      return;
    }

    let observableTransitions = 0;
    let rapidCrossDomainTransitions = 0;
    let returnLoops = 0;

    for (let index = 0; index < session.episodes.length - 1; index += 1) {
      const currentEpisode = session.episodes[index];
      const nextEpisode = session.episodes[index + 1];
      const transitionSeconds =
        (nextEpisode.startedAt - currentEpisode.lastActivityAt) / 1000;
      const transitionCanBeCompared =
        transitionSeconds >= MINIMUM_CONTINUITY_TRANSITION_SECONDS &&
        transitionSeconds <= MAXIMUM_CONTINUITY_TRANSITION_MINUTES * 60;

      if (!transitionCanBeCompared) {
        continue;
      }

      observableTransitions += 1;

      if (
        currentEpisode.domain !== nextEpisode.domain &&
        transitionSeconds <= RAPID_CONTINUITY_TRANSITION_SECONDS
      ) {
        rapidCrossDomainTransitions += 1;
      }
    }

    for (let index = 1; index < session.episodes.length - 1; index += 1) {
      const before = session.episodes[index - 1];
      const middle = session.episodes[index];
      const after = session.episodes[index + 1];
      const loopSeconds = (after.startedAt - before.lastActivityAt) / 1000;
      const middleEpisodeSeconds =
        (after.startedAt - middle.startedAt) / 1000;

      if (
        before.domain === after.domain &&
        middle.domain !== before.domain &&
        loopSeconds <= MAXIMUM_CONTINUITY_RETURN_LOOP_MINUTES * 60 &&
        middleEpisodeSeconds >= MINIMUM_MEANINGFUL_HISTORY_GAP_SECONDS
      ) {
        returnLoops += 1;
      }
    }

    if (observableTransitions < MINIMUM_CONTINUITY_TRANSITIONS) {
      return;
    }

    const rapidTransitionRatio =
      rapidCrossDomainTransitions / observableTransitions;
    const returnLoopRatio = Math.min(
      1,
      returnLoops / observableTransitions
    );
    const uniqueDomainCount = new Set(
      session.episodes.map((episode) => episode.domain)
    ).size;
    const breadth = Math.max(
      0,
      Math.min(1, (uniqueDomainCount - 2) / 6)
    );

    // Descriptive navigation proxy, never a clinical/productivity score or blocking
    // input.
    const fragmentation = Math.round(
      100 *
        (0.55 * rapidTransitionRatio +
          0.3 * returnLoopRatio +
          0.15 * breadth)
    );

    eligibleSessions.push({
      startedAt: session.startedAt,
      day: getLocalDateKey(new Date(session.startedAt)),
      fragmentation
    });
  });

  const recentBoundary =
    Date.now() - RECENT_CONTINUITY_DAYS * MILLISECONDS_PER_DAY;
  const recentSessions = eligibleSessions.filter(
    (session) => session.startedAt >= recentBoundary
  );
  const baselineSessions = eligibleSessions.filter(
    (session) => session.startedAt < recentBoundary
  );
  const recentFragmentation = findMiddleNumber(
    recentSessions.map((session) => session.fragmentation)
  );
  const baselineFragmentation = findMiddleNumber(
    baselineSessions.map((session) => session.fragmentation)
  );
  const recentDayCount = new Set(
    recentSessions.map((session) => session.day)
  ).size;
  const hasComparisonBaseline = Boolean(
    recentSessions.length >= 4 &&
    recentDayCount >= 3 &&
    baselineSessions.length >= 5 &&
    baselineFragmentation !== null
  );
  const changeFromBaseline = hasComparisonBaseline
    ? recentFragmentation - baselineFragmentation
    : null;

  let recentBand = "not enough data";

  if (recentFragmentation !== null) {
    if (recentFragmentation <= 30) {
      recentBand = "steadier navigation";
    } else if (recentFragmentation <= 59) {
      recentBand = "mixed navigation";
    } else {
      recentBand = "rapidly switching navigation";
    }
  }

  return {
    modelVersion: 1,
    eligibleSessionCount: eligibleSessions.length,
    recentSessionCount: recentSessions.length,
    recentDayCount,
    baselineSessionCount: baselineSessions.length,
    recentFragmentation,
    recentContinuity:
      recentFragmentation === null ? null : 100 - recentFragmentation,
    baselineFragmentation,
    changeFromBaseline,
    recentBand,
    hasComparisonBaseline,
    switchingIncreased: Boolean(
      hasComparisonBaseline && changeFromBaseline >= 15
    )
  };
}

function calculateHistoricalLinkTrails(visits) {
  // Referrer ancestry is incomplete and cannot establish tab focus. Keep chains in
  // memory; persist only domain aggregates.
  const visitById = new Map();
  const parentByVisitId = new Map();
  const childCountByVisitId = new Map();
  const maximumTrailDuration =
    RABBIT_TRAIL_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE;

  visits.forEach((visit) => {
    if (visit.visitId) {
      visitById.set(visit.visitId, visit);
    }
  });

  visits.forEach((visit) => {
    if (
      visit.transition !== "link" ||
      !visit.visitId ||
      !visit.referringVisitId
    ) {
      return;
    }

    const parentVisit = visitById.get(visit.referringVisitId);
    const elapsed = parentVisit
      ? visit.visitTime - parentVisit.visitTime
      : Number.POSITIVE_INFINITY;

    if (elapsed < 0 || elapsed > maximumTrailDuration) {
      return;
    }

    parentByVisitId.set(visit.visitId, parentVisit.visitId);
    childCountByVisitId.set(
      parentVisit.visitId,
      (childCountByVisitId.get(parentVisit.visitId) || 0) + 1
    );
  });

  const linkedDepths = [];
  const frequentDomains = new Map();
  let crossDomainTrailCount = 0;

  // Start at leaves to count each chain once, allowing separate trails for branches.
  visits.forEach((leafVisit) => {
    if (
      !parentByVisitId.has(leafVisit.visitId) ||
      childCountByVisitId.has(leafVisit.visitId)
    ) {
      return;
    }

    const chain = [leafVisit];
    const seenVisitIds = new Set([leafVisit.visitId]);
    let currentVisit = leafVisit;

    while (chain.length <= 30) {
      const parentId = parentByVisitId.get(currentVisit.visitId);
      const parentVisit = parentId ? visitById.get(parentId) : null;

      if (
        !parentVisit ||
        seenVisitIds.has(parentId) ||
        leafVisit.visitTime - parentVisit.visitTime > maximumTrailDuration
      ) {
        break;
      }

      chain.push(parentVisit);
      seenVisitIds.add(parentId);
      currentVisit = parentVisit;
    }

    const linkedDepth = chain.length - 1;

    if (linkedDepth < MINIMUM_RABBIT_HOLE_DEPTH) {
      return;
    }

    linkedDepths.push(linkedDepth);
    const domains = new Set(chain.map((visit) => getHost(visit.url)));

    if (domains.size > 1) {
      crossDomainTrailCount += 1;
    }

    // Do not treat the starting page as a deep destination.
    chain.slice(0, -1).forEach((visit) => {
      const domain = getHost(visit.url);

      if (domain) {
        frequentDomains.set(domain, (frequentDomains.get(domain) || 0) + 1);
      }
    });
  });

  const frequentDeepDomains = [...frequentDomains.entries()]
    .sort(
      (first, second) => second[1] - first[1] || first[0].localeCompare(second[0])
    )
    .slice(0, 5)
    .map(([domain, trailAppearances]) => ({ domain, trailAppearances }));

  return {
    modelVersion: 1,
    windowMinutes: RABBIT_TRAIL_WINDOW_MINUTES,
    minimumLinkedDepth: MINIMUM_RABBIT_HOLE_DEPTH,
    observedLinkRelationships: parentByVisitId.size,
    qualifyingTrailCount: linkedDepths.length,
    maximumLinkedDepth: linkedDepths.length
      ? Math.max(...linkedDepths)
      : 0,
    medianLinkedDepth: findMiddleNumber(linkedDepths),
    crossDomainTrailCount,
    frequentDeepDomains
  };
}

async function readHistoryVisitsInBatches(historyItems) {
  const visits = [];
  let failedUrlCount = 0;

  // Bound API concurrency; one inaccessible URL must not discard the whole analysis.
  for (
    let startIndex = 0;
    startIndex < historyItems.length;
    startIndex += HISTORY_FETCH_BATCH_SIZE
  ) {
    const batch = historyItems.slice(
      startIndex,
      startIndex + HISTORY_FETCH_BATCH_SIZE
    );
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          const visitsForUrl = await chrome.history.getVisits({
            url: item.url
          });

          return visitsForUrl.map((visit) => ({
            url: item.url,
            visitTime: visit.visitTime,
            transition: visit.transition || "unknown",
            visitId: visit.visitId || "",
            referringVisitId: visit.referringVisitId || "",
            isLocal: visit.isLocal
          }));
        } catch {
          failedUrlCount += 1;
          return [];
        }
      })
    );

    visits.push(...batchResults.flat());
  }

  return { visits, failedUrlCount };
}

async function performHistoryAnalysis() {
  const analysisRevision = historyDataRevision;
  const currentState = await getState();
  const historyPermissionGranted = await chrome.permissions.contains({
    permissions: ["history"]
  });

  // Never touch browser history unless both the setting and permission are on.
  if (
    !currentState.enabled ||
    !currentState.historyInsightsEnabled ||
    !historyPermissionGranted
  ) {
    return;
  }

  const historyStartTime =
    Date.now() - HISTORY_LOOKBACK_DAYS * MILLISECONDS_PER_DAY;

  // Chrome search returns URL summaries; getVisits supplies individual visits.
  const historyItems = await chrome.history.search({
    text: "",
    startTime: historyStartTime,
    maxResults: HISTORY_RESULT_LIMIT
  });

  const webHistoryItems = historyItems.filter((item) => isWebUrl(item.url));

  const historyRead = await readHistoryVisitsInBatches(webHistoryItems);
  const visits = historyRead.visits
    .filter(
      (visit) =>
        Number.isFinite(visit.visitTime) &&
        visit.visitTime >= historyStartTime &&
        visit.isLocal !== false &&
        visit.transition !== "reload" &&
        visit.transition !== "auto_toplevel" &&
        visit.transition !== "auto_subframe" &&
        visit.transition !== "manual_subframe"
    )
    .sort((first, second) => first.visitTime - second.visitTime);

  // Visit/referrer IDs stay in memory only.
  const domainByVisitId = new Map(
    visits.map((visit) => [visit.visitId, getHost(visit.url)])
  );
  const episodes = groupHistoryIntoDomainEpisodes(
    visits,
    domainByVisitId
  );
  const navigationContinuity = calculateNavigationContinuity(episodes);
  const linkTrails = calculateHistoricalLinkTrails(visits);
  const patternsByDomain = new Map();
  const lastEpisodeByDomain = new Map();
  const maximumDetourSpan =
    DETOUR_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE;
  const repeatCheckWindow =
    REPEAT_CHECK_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE;

  function getPattern(domain) {
    if (!patternsByDomain.has(domain)) {
      patternsByDomain.set(domain, createEmptyHistoryPattern(domain));
    }

    return patternsByDomain.get(domain);
  }

  episodes.forEach((episode, index) => {
    const pattern = getPattern(episode.domain);
    const previousEpisode = episodes[index - 1];
    const nextEpisode = episodes[index + 1];

    pattern.episodes += 1;
    pattern.lastSeen = Math.max(pattern.lastSeen, episode.lastActivityAt);
    pattern.activeDays.add(getLocalDateKey(new Date(episode.startedAt)));
    pattern.referrerLinkedEntries += episode.hasCrossDomainReferrer ? 1 : 0;

    if (
      episode.transitions.includes("typed") ||
      episode.transitions.includes("auto_bookmark") ||
      episode.transitions.includes("generated") ||
      episode.transitions.includes("keyword") ||
      episode.transitions.includes("keyword_generated")
    ) {
      pattern.explicitOpens += 1;
    }

    // Visit-to-next-domain duration is a proxy, not measured focus or reading time.
    const arrivedFromAnotherRecentContext = Boolean(
      previousEpisode &&
      previousEpisode.domain !== episode.domain &&
      episode.startedAt - previousEpisode.lastActivityAt <= maximumDetourSpan
    );

    if (
      arrivedFromAnotherRecentContext &&
      nextEpisode &&
      nextEpisode.domain !== episode.domain
    ) {
      const episodeDurationSeconds = Math.round(
        (nextEpisode.startedAt - episode.startedAt) / 1000
      );

      if (
        episodeDurationSeconds >= 0 &&
        episodeDurationSeconds <= DETOUR_WINDOW_MINUTES * 60
      ) {
        pattern.measurableEpisodeDurations.push(episodeDurationSeconds);

        if (
          episodeDurationSeconds <
          MINIMUM_MEANINGFUL_HISTORY_GAP_SECONDS
        ) {
          pattern.veryFastExits += 1;
        } else if (
          episodeDurationSeconds <= BRIEF_HISTORY_VISIT_SECONDS
        ) {
          pattern.briefExits += 1;
          pattern.briefExitDays.add(
            getLocalDateKey(new Date(episode.startedAt))
          );
        }
      }
    }

    // Count short A → B → A detours; ignore sub-ten-second redirect-like transitions.
    if (
      previousEpisode &&
      nextEpisode &&
      episode.domain !== previousEpisode.domain &&
      previousEpisode.domain === nextEpisode.domain &&
      nextEpisode.startedAt - previousEpisode.lastActivityAt <=
        maximumDetourSpan
    ) {
      const candidateDurationSeconds = Math.round(
        (nextEpisode.startedAt - episode.startedAt) / 1000
      );
      const candidateLooksMeaningful =
        candidateDurationSeconds >=
          MINIMUM_MEANINGFUL_HISTORY_GAP_SECONDS &&
        candidateDurationSeconds <=
          MAXIMUM_DETOUR_EPISODE_MINUTES * 60;

      pattern.returnSequences += 1;

      if (candidateLooksMeaningful) {
        pattern.detours += 1;
        pattern.detourDays.add(
          getLocalDateKey(new Date(episode.startedAt))
        );
        pattern.interruptedDomains.add(previousEpisode.domain);
      }

      // Credit A as a resumed context so it is not mislabeled as the detour.
      getPattern(previousEpisode.domain).contextReturns += 1;
    }

    const priorSameDomain = lastEpisodeByDomain.get(episode.domain);

    if (
      priorSameDomain &&
      index - priorSameDomain.index > 1 &&
      episode.startedAt - priorSameDomain.lastActivityAt <= repeatCheckWindow
    ) {
      pattern.repeatChecks += 1;
      pattern.repeatCheckDays.add(
        getLocalDateKey(new Date(episode.startedAt))
      );

      if (previousEpisode && previousEpisode.domain !== episode.domain) {
        pattern.interruptedDomains.add(previousEpisode.domain);
      }
    }

    lastEpisodeByDomain.set(episode.domain, {
      index,
      lastActivityAt: episode.lastActivityAt
    });
  });

  // Deep-link evidence may rank candidates but cannot qualify a domain for learning
  // alone.
  (linkTrails.frequentDeepDomains || []).forEach((entry) => {
    getPattern(entry.domain).deepTrailAppearances = entry.trailAppearances;
  });

  // Re-read user choices after analysis so recent corrections and permission changes win.
  const latestState = await getState();
  const permissionStillGranted = await chrome.permissions.contains({
    permissions: ["history"]
  });

  if (
    analysisRevision !== historyDataRevision ||
    !latestState.enabled ||
    !latestState.historyInsightsEnabled ||
    !permissionStillGranted
  ) {
    return;
  }

  const summarizedPatterns = [...patternsByDomain.values()]
    .map((pattern) => explainHistoryPattern(pattern))
    .map((summary) => {
      const userCategory = getUserCategoryRule(summary.domain, latestState);
      const builtInCategory = getBuiltInCategory(summary.domain);

      return {
        ...summary,
        existingCategory: userCategory || builtInCategory || ""
      };
    })
    .filter((summary) => {
      const userCategory = getUserCategoryRule(summary.domain, latestState);
      const isAllowed = isWhitelisted(
        `https://${summary.domain}/`,
        latestState
      );

      // "neutral" and the allow-list are explicit user corrections.
      return userCategory !== "neutral" && !isAllowed;
    })
    .sort(
      (first, second) =>
        second.sortWeight - first.sortWeight ||
        second.lastSeen - first.lastSeen
    );

  function hasVisibleHistorySignal(pattern) {
    return Boolean(
      pattern.detours > 0 ||
      pattern.repeatChecks >= 2 ||
      pattern.briefExits >= 3 ||
      pattern.deepTrailAppearances > 0
    );
  }

  const uncategorizedPatterns = summarizedPatterns.filter(
    (pattern) => !pattern.existingCategory
  );
  const candidates = uncategorizedPatterns
    .filter(hasVisibleHistorySignal)
    .slice(0, 10)
    .map(prepareHistoryPatternForStorage);
  const knownPatterns = summarizedPatterns
    .filter(
      (pattern) => pattern.existingCategory && hasVisibleHistorySignal(pattern)
    )
    .slice(0, 5)
    .map(prepareHistoryPatternForStorage);

  // Only uncategorized domains become learned distractions.
  const learnedDistractions = summarizedPatterns
    .filter(
      (pattern) =>
        pattern.qualifiesForLearning && !pattern.existingCategory
    )
    .slice(0, MAXIMUM_LEARNED_DOMAINS)
    .map(prepareHistoryPatternForStorage);

  await chrome.storage.local.set({
    learnedDistractions,
    historyAnalysis: {
      lastRun: Date.now(),
      modelVersion: 3,
      lookbackDays: HISTORY_LOOKBACK_DAYS,
      analyzedVisits: visits.length,
      analyzedEpisodes: episodes.length,
      coverageLimited: historyItems.length >= HISTORY_RESULT_LIMIT,
      failedUrlCount: historyRead.failedUrlCount,
      navigationContinuity,
      linkTrails,
      candidates,
      knownPatterns
    }
  });
}

function analyzeHistory() {
  // Share work when the daily alarm and a manual analysis overlap.
  if (!historyAnalysisInFlight) {
    historyAnalysisInFlight = performHistoryAnalysis().finally(() => {
      historyAnalysisInFlight = null;
    });
  }

  return historyAnalysisInFlight;
}

// Statistics and human-readable activity sessions

// Serialize read/change/write operations to avoid lost updates.
let storageWorkQueue = Promise.resolve();

function runStorageTask(task) {
  const scheduledTask = storageWorkQueue.then(task);

  // Keep the queue usable even if one task fails; return the real task to caller.
  storageWorkQueue = scheduledTask.catch(() => {});
  return scheduledTask;
}

// Unanswered feed prompts survive worker restarts in session storage, keyed by tab ID.
async function getPendingDriftReflections() {
  if (!chrome.storage?.session) {
    return {};
  }

  try {
    const storedSession = await chrome.storage.session.get(
      PENDING_DRIFT_SESSION_KEY
    );
    const pending = storedSession[PENDING_DRIFT_SESSION_KEY];

    return pending && typeof pending === "object" ? { ...pending } : {};
  } catch {
    // The page can still enforce its prompt without reload recovery.
    return {};
  }
}

async function rememberPendingDriftReflection(tabId, eventId, resetSeconds) {
  if (!chrome.storage?.session || !Number.isInteger(tabId) || !eventId) {
    return false;
  }

  const pending = await getPendingDriftReflections();
  pending[String(tabId)] = {
    eventId,
    resetSeconds: Math.max(3, Math.min(15, Number(resetSeconds) || 5)),
    createdAt: Date.now()
  };

  try {
    await chrome.storage.session.set({
      [PENDING_DRIFT_SESSION_KEY]: pending
    });
    return true;
  } catch {
    return false;
  }
}

async function clearPendingDriftReflection(tabId, eventId = "") {
  if (!chrome.storage?.session) {
    return false;
  }

  const pending = await getPendingDriftReflections();
  const tabKey = Number.isInteger(tabId) ? String(tabId) : "";
  let keyToRemove = "";

  if (
    tabKey &&
    pending[tabKey] &&
    (!eventId || pending[tabKey].eventId === eventId)
  ) {
    keyToRemove = tabKey;
  } else if (eventId) {
    // Random event IDs let a restored prompt clear its original tab.
    keyToRemove = Object.keys(pending).find(
      (key) => pending[key]?.eventId === eventId
    ) || "";
  }

  if (!keyToRemove) {
    return false;
  }

  delete pending[keyToRemove];
  try {
    await chrome.storage.session.set({
      [PENDING_DRIFT_SESSION_KEY]: pending
    });
    return true;
  } catch {
    return false;
  }
}

async function getPendingDriftReflectionForTab(tabId) {
  if (!Number.isInteger(tabId)) {
    return null;
  }

  const pending = await getPendingDriftReflections();
  return pending[String(tabId)] || null;
}

function createIdentifier(prefix) {
  if (typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  // Fallback for an older Chromium build that lacks crypto.randomUUID.
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function incrementStoredMetric(currentState, metric, amount) {
  const today = getTodayKey();

  if (!currentState.stats.days[today]) {
    currentState.stats.days[today] = {};
  }

  const oldDailyValue = currentState.stats.days[today][metric] || 0;
  const oldTotalValue = currentState.stats.totals[metric] || 0;

  currentState.stats.days[today][metric] = oldDailyValue + amount;
  currentState.stats.totals[metric] = oldTotalValue + amount;
}

function addEventToCurrentSession(currentState, metric, amount, detail) {
  const now = Date.now();
  const sessionGap = SESSION_INACTIVITY_MINUTES * MILLISECONDS_PER_MINUTE;
  let currentSession = currentState.activitySessions[0];

  // Sessions group noteworthy actions; they do not measure focused time.
  if (!currentSession || now - currentSession.lastActivityAt > sessionGap) {
    currentSession = {
      id: createIdentifier("session"),
      startedAt: now,
      lastActivityAt: now,
      summary: {},
      events: []
    };

    currentState.activitySessions.unshift(currentSession);
    currentState.activitySessions = currentState.activitySessions.slice(
      0,
      MAXIMUM_ACTIVITY_SESSIONS
    );
  }

  currentSession.lastActivityAt = now;
  currentSession.summary[metric] =
    (currentSession.summary[metric] || 0) + amount;

  const event = {
    id: createIdentifier("event"),
    at: now,
    metric,
    domain: getHost(detail?.url || ""),
    title: detail?.title || "",
    category: detail?.category || "",
    data: detail?.data || {},
    intent: detail?.intent || ""
  };

  currentSession.events.unshift(event);
  currentSession.events = currentSession.events.slice(
    0,
    MAXIMUM_EVENTS_PER_SESSION
  );

  return event;
}

function addActivityToState(currentState, metric, amount, detail = {}) {
  incrementStoredMetric(currentState, metric, amount);

  // Keep legacy aggregate totals alongside the specific signals that explain them.
  if (metric === "pointerLoops" || metric === "pointerReversals") {
    incrementStoredMetric(currentState, "pointerWanders", amount);
  }

  if (metric === "blankAreaClicks" || metric === "repeatedClicks") {
    incrementStoredMetric(currentState, "lowValueClicks", amount);
  }

  return addEventToCurrentSession(currentState, metric, amount, detail);
}

async function recordActivity(metric, amount = 1, detail = {}) {
  return runStorageTask(async () => {
    const currentState = await getState();
    const event = addActivityToState(currentState, metric, amount, detail);

    await chrome.storage.local.set({
      stats: currentState.stats,
      activitySessions: currentState.activitySessions
    });

    return event;
  });
}

function coachIsEnabledForMetric(currentState, metric) {
  const setting = {
    rabbitHoleCheckpoints: "rabbitHoleCoachEnabled",
    sustainedScrolling: "scrollCoachEnabled",
    infiniteFeedCheckpoints: "infiniteFeedCoachEnabled"
  }[metric] || "mouseCoachEnabled";
  return currentState[setting] !== false;
}

function addBehaviorAndChooseInterventionInState(
  currentState,
  metric,
  amount,
  detail
) {
  const event = addActivityToState(currentState, metric, amount, detail);
  const coachEnabled = coachIsEnabledForMetric(currentState, metric);
  let shouldAskForIntent = false;

  // Tone supplies aggregate context only; sampled words are never retained.
  if (metric === "sustainedScrolling" && currentState.screenToneEnabled) {
    const sampledWords = Math.max(
      0,
      Math.min(500, Math.round(Number(detail?.data?.sampledWords) || 0))
    );
    const negativeHits = Math.max(
      0,
      Math.min(sampledWords, Math.round(Number(detail?.data?.negativeHits) || 0))
    );
    const positiveHits = Math.max(
      0,
      Math.min(sampledWords, Math.round(Number(detail?.data?.positiveHits) || 0))
    );

    if (sampledWords) {
      incrementStoredMetric(currentState, "toneSampledWords", sampledWords);
      incrementStoredMetric(
        currentState,
        "negativeToneWordHits",
        negativeHits
      );
      incrementStoredMetric(
        currentState,
        "positiveToneWordHits",
        positiveHits
      );
    }

    if (detail?.data?.toneBand === "negative-leaning") {
      incrementStoredMetric(currentState, "negativeToneSamples", amount);

      const currentSession = currentState.activitySessions[0];
      currentSession.summary.negativeToneSamples =
        (currentSession.summary.negativeToneSamples || 0) + amount;
    }
  }

  if (metric === "mouseResetsCompleted") {
    return { event, shouldAskForIntent, coachEnabled };
  }

  const now = Date.now();
  const signalWindow = INTENT_PROMPT_SIGNAL_WINDOW_SECONDS * 1000;
  const promptCooldown =
    INTENT_PROMPT_COOLDOWN_MINUTES * MILLISECONDS_PER_MINUTE;
  const promptIsRested =
    now - currentState.lastIntentPromptAt >= promptCooldown;

  if (metric === "infiniteFeedCheckpoints") {
    // Every ten visuals is a checkpoint; the setting decides whether it locks.
    shouldAskForIntent = coachEnabled;
  } else if (IMMEDIATE_INTENT_METRICS.has(metric)) {
    // Link/scroll thresholds already combine many actions; only the shared cooldown
    // applies.
    shouldAskForIntent = coachEnabled && promptIsRested;
  } else if (coachEnabled) {
    currentState.recentQuestionableSignals =
      currentState.recentQuestionableSignals.filter(
        (signal) => now - signal.at <= signalWindow
      );
    currentState.recentQuestionableSignals.push({ at: now, metric });

    const requiredSignals = Math.max(
      2,
      Math.min(5, Number(currentState.signalsBeforeIntentPrompt) || 2)
    );
    shouldAskForIntent = Boolean(
      currentState.recentQuestionableSignals.length >= requiredSignals &&
      promptIsRested
    );
  }

  if (shouldAskForIntent) {
    currentState.lastIntentPromptAt = now;
    currentState.recentQuestionableSignals = [];
  }

  if (metric === "infiniteFeedCheckpoints") {
    // Distinguish observation-only checkpoints from blocking prompts.
    event.data.hardLockRequested = shouldAskForIntent;
  }

  return { event, shouldAskForIntent, coachEnabled };
}

async function recordBehaviorAndChooseIntervention(
  metric,
  amount,
  detail,
  tabId
) {
  return runStorageTask(async () => {
    const currentState = await getState();

    if (!currentState.enabled) {
      return { ok: true, ignored: true };
    }

    const categorizedDetail = {
      ...detail,
      category:
        detail?.category ||
        getCategoryForUrl(detail?.url || "", currentState) ||
        ""
    };
    const intervention = addBehaviorAndChooseInterventionInState(
      currentState,
      metric,
      amount,
      categorizedDetail
    );

    await chrome.storage.local.set({
      stats: currentState.stats,
      activitySessions: currentState.activitySessions,
      recentQuestionableSignals: currentState.recentQuestionableSignals,
      lastIntentPromptAt: currentState.lastIntentPromptAt
    });

    if (
      metric === "infiniteFeedCheckpoints" &&
      intervention.shouldAskForIntent
    ) {
      await rememberPendingDriftReflection(
        tabId,
        intervention.event.id,
        currentState.mouseResetSeconds
      );
    }

    return {
      ok: true,
      eventId: intervention.event.id,
      shouldAskForIntent: intervention.shouldAskForIntent,
      coachEnabled: intervention.coachEnabled,
      resetSeconds: currentState.mouseResetSeconds
    };
  });
}

function findActivityEvent(currentState, eventId) {
  for (const session of currentState.activitySessions) {
    const event = session.events.find((candidate) => candidate.id === eventId);
    if (event) return { session, event };
  }
  return {};
}

async function attachIntentToActivity(eventId, rawIntent) {
  const intent = String(rawIntent || "").trim().slice(0, 240);

  if (intent.length < MINIMUM_INTENT_CHARACTERS) {
    return {
      ok: false,
      error: `Please write at least ${MINIMUM_INTENT_CHARACTERS} characters.`
    };
  }

  return runStorageTask(async () => {
    const currentState = await getState();
    const { session, event } = findActivityEvent(currentState, eventId);

    if (!event) {
      return { ok: false, error: "The triggering activity was not found." };
    }

    // Retried messages may update the answer but must not count it twice.
    if (!event.intent) {
      session.summary.intentPromptsCompleted =
        (session.summary.intentPromptsCompleted || 0) + 1;
      incrementStoredMetric(currentState, "intentPromptsCompleted", 1);
    }
    event.intent = intent;

    await chrome.storage.local.set({
      stats: currentState.stats,
      activitySessions: currentState.activitySessions
    });

    return { ok: true };
  });
}

function countReflectionWords(text) {
  const normalizedText = String(text || "").trim();

  if (!normalizedText) {
    return 0;
  }

  if (REFLECTION_WORD_SEGMENTER) {
    // Use language-aware word boundaries; punctuation alone does not count.
    return [...REFLECTION_WORD_SEGMENTER.segment(normalizedText)].filter(
      (piece) => piece.isWordLike
    ).length;
  }

  // Older Chromium: count letter/number groups in any alphabet.
  return (
    normalizedText.match(
      /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu
    ) || []
  ).length;
}

async function attachDriftReflection(
  eventId,
  rawInitialPoint,
  rawCurrentPoint,
  tabId
) {
  const initialPoint = String(rawInitialPoint || "")
    .trim()
    .slice(0, MAXIMUM_DRIFT_REFLECTION_CHARACTERS);
  const currentPoint = String(rawCurrentPoint || "")
    .trim()
    .slice(0, MAXIMUM_DRIFT_REFLECTION_CHARACTERS);
  const initialWordCount = countReflectionWords(initialPoint);
  const currentWordCount = countReflectionWords(currentPoint);
  const wordCount = initialWordCount + currentWordCount;

  if (
    initialWordCount === 0 ||
    currentWordCount === 0 ||
    wordCount < MINIMUM_DRIFT_REFLECTION_WORDS
  ) {
    return {
      ok: false,
      error:
        "Answer both questions with at least 50 words combined. " +
        `Current total: ${wordCount}.`
    };
  }

  return runStorageTask(async () => {
    const currentState = await getState();
    const { session: matchingSession, event: matchingEvent } =
      findActivityEvent(currentState, eventId);

    if (!matchingEvent) {
      // A reset or pruned log must not prevent a valid reflection from releasing the
      // page.
      await clearPendingDriftReflection(tabId, eventId);
      return { ok: true, wordCount, stored: false };
    }

    if (matchingEvent.metric !== "infiniteFeedCheckpoints") {
      return { ok: false, error: "This was not a feed checkpoint." };
    }

    // A retried message must not count completion twice.
    if (!matchingEvent.reflection) {
      matchingEvent.reflection = {
        initialPoint,
        currentPoint,
        wordCount
      };
      matchingSession.summary.driftReflectionsCompleted =
        (matchingSession.summary.driftReflectionsCompleted || 0) + 1;
      incrementStoredMetric(currentState, "driftReflectionsCompleted", 1);

      await chrome.storage.local.set({
        stats: currentState.stats,
        activitySessions: currentState.activitySessions
      });
    }

    await clearPendingDriftReflection(tabId, eventId);

    return { ok: true, wordCount, stored: true };
  });
}

// Paused-tab queue and deliberate opening flow

function pruneExpiredPendingTabs(currentState) {
  const oldestAllowedTime =
    Date.now() - PENDING_TAB_LIFETIME_HOURS * 60 * MILLISECONDS_PER_MINUTE;

  currentState.pendingTabs = currentState.pendingTabs.filter(
    (item) => item.queuedAt >= oldestAllowedTime
  );
}

function findPendingTab(currentState, queueId) {
  return currentState.pendingTabs.find((item) => item.id === queueId);
}

function getRequiredReflectionSeconds(attemptNumber) {
  // Repeated attempts add modest friction: 3s, 5s, 7s, then a 9s cap.
  return Math.min(9, 3 + (attemptNumber - 1) * 2);
}

async function sendTabToPausePage(tab, attemptedUrl) {
  const queueItem = await runStorageTask(async () => {
    const currentState = await getState();
    const now = Date.now();
    const attemptWindow =
      RECENT_TAB_ATTEMPT_MINUTES * MILLISECONDS_PER_MINUTE;

    pruneExpiredPendingTabs(currentState);
    currentState.recentTabAttempts = currentState.recentTabAttempts.filter(
      (attemptTime) => now - attemptTime <= attemptWindow
    );
    currentState.recentTabAttempts.push(now);

    const attemptNumber = currentState.recentTabAttempts.length;
    const destinationUrl = isWebUrl(attemptedUrl) ? attemptedUrl : "";
    const destinationHost = getHost(destinationUrl);
    const category = getCategoryForUrl(destinationUrl, currentState);
    const activeBeforeAttempt =
      currentState.activeTabByWindow[String(tab.windowId)];
    const sourceSnapshot =
      activeBeforeAttempt?.tabId === tab.id
        ? activeBeforeAttempt.previousTab
        : activeBeforeAttempt;
    const sourceTabId =
      tab.openerTabId ||
      sourceSnapshot?.tabId ||
      null;
    const sourceTitle =
      sourceSnapshot?.title || "your previous task";

    const item = {
      id: createIdentifier("paused-tab"),
      tabId: tab.id,
      openerTabId: sourceTabId,
      sourceTitle,
      destinationUrl,
      destinationHost,
      title: tab.title || destinationHost || "Blank new tab",
      category: category || "",
      queuedAt: now,
      availableAt: currentState.lockUntil,
      attemptNumber,
      requiredReflectionSeconds: getRequiredReflectionSeconds(attemptNumber),
      intent: "",
      decisionReadyAt: 0,
      status: "waiting"
    };

    currentState.pendingTabs.unshift(item);
    currentState.pendingTabs = currentState.pendingTabs.slice(
      0,
      MAXIMUM_PENDING_TABS
    );

    addActivityToState(currentState, "blockedTabs", 1, {
      title: item.title,
      url: destinationUrl,
      category,
      data: {
        action: "saved-in-pause-page",
        attemptNumber,
        availableAt: item.availableAt
      }
    });

    await chrome.storage.local.set({
      pendingTabs: currentState.pendingTabs,
      recentTabAttempts: currentState.recentTabAttempts,
      stats: currentState.stats,
      activitySessions: currentState.activitySessions
    });

    return item;
  });

  const pausePageUrl = chrome.runtime.getURL(
    `pause.html?id=${encodeURIComponent(queueItem.id)}`
  );

  try {
    await chrome.tabs.update(tab.id, { url: pausePageUrl });
  } catch (error) {
    console.warn("Behavyour could not show the pause page:", error);
  }
}

async function getPauseContext(queueId, senderTabId) {
  return runStorageTask(async () => {
    const currentState = await getState();
    const item = findPendingTab(currentState, queueId);

    if (!item) {
      return { ok: false, error: "This paused-tab item is no longer available." };
    }

    // The review page may load before its new tab ID is saved; bind it using the random
    // queue ID.
    if (!item.tabId && item.status === "saved" && senderTabId) {
      item.tabId = senderTabId;
      item.status = "waiting";
      await chrome.storage.local.set({ pendingTabs: currentState.pendingTabs });
    }

    if (item.tabId !== senderTabId) {
      return { ok: false, error: "This paused-tab item is no longer available." };
    }

    return {
      ok: true,
      item,
      lockUntil: currentState.lockUntil,
      now: Date.now()
    };
  });
}

function messageCameFromPausePage(sender) {
  // Only our own pause page may reveal or open a queued address.
  return Boolean(
    sender.tab?.id &&
    String(sender.url || "").startsWith(chrome.runtime.getURL("pause.html"))
  );
}

async function beginIntentionalOpen(queueId, senderTabId, rawIntent) {
  const intent = String(rawIntent || "").trim().slice(0, 240);

  if (intent.length < MINIMUM_TAB_INTENT_CHARACTERS) {
    return {
      ok: false,
      error: `Please write at least ${MINIMUM_TAB_INTENT_CHARACTERS} characters.`
    };
  }

  return runStorageTask(async () => {
    const currentState = await getState();
    const item = findPendingTab(currentState, queueId);
    const now = Date.now();

    if (!item || item.tabId !== senderTabId) {
      return { ok: false, error: "This paused-tab item is no longer available." };
    }

    if (now < currentState.lockUntil) {
      return {
        ok: false,
        waiting: true,
        lockUntil: currentState.lockUntil,
        error: "The original tab pause is still active."
      };
    }

    item.intent = intent;
    item.decisionReadyAt =
      now + item.requiredReflectionSeconds * 1000;

    await chrome.storage.local.set({
      pendingTabs: currentState.pendingTabs
    });

    return {
      ok: true,
      decisionReadyAt: item.decisionReadyAt
    };
  });
}

async function completeIntentionalOpen(queueId, senderTabId) {
  const result = await runStorageTask(async () => {
    const currentState = await getState();
    const item = findPendingTab(currentState, queueId);
    const now = Date.now();

    if (!item || item.tabId !== senderTabId) {
      return { ok: false, error: "This paused-tab item is no longer available." };
    }

    if (now < currentState.lockUntil) {
      return {
        ok: false,
        waiting: true,
        lockUntil: currentState.lockUntil,
        error: "A newer tab pause is active."
      };
    }

    if (!item.decisionReadyAt || now < item.decisionReadyAt) {
      return {
        ok: false,
        error: "The reflection countdown has not finished yet."
      };
    }

    currentState.pendingTabs = currentState.pendingTabs.filter(
      (candidate) => candidate.id !== queueId
    );

    const cooldownLength =
      Math.max(0, Number(currentState.lockMinutes) || 0) *
      MILLISECONDS_PER_MINUTE;
    currentState.lockUntil = now + cooldownLength;

    addActivityToState(currentState, "intentionalOpens", 1, {
      title: item.title,
      url: item.destinationUrl,
      category: item.category,
      intent: item.intent,
      data: {
        attemptNumber: item.attemptNumber
      }
    });

    await chrome.storage.local.set({
      pendingTabs: currentState.pendingTabs,
      lockUntil: currentState.lockUntil,
      stats: currentState.stats,
      activitySessions: currentState.activitySessions
    });

    return {
      ok: true,
      destinationUrl: item.destinationUrl || "about:blank"
    };
  });

  if (result.ok) {
    await chrome.tabs.update(senderTabId, {
      url: result.destinationUrl
    });
  }

  return result;
}

async function resolvePausedTab(queueId, senderTabId, outcome) {
  const result = await runStorageTask(async () => {
    const currentState = await getState();
    const item = findPendingTab(currentState, queueId);

    if (!item || item.tabId !== senderTabId) {
      return { ok: false, error: "This paused-tab item is no longer available." };
    }

    if (outcome === "saved") {
      item.status = "saved";
      item.tabId = null;
      item.decisionReadyAt = 0;
      item.intent = "";
    } else {
      currentState.pendingTabs = currentState.pendingTabs.filter(
        (candidate) => candidate.id !== queueId
      );
    }

    addActivityToState(
      currentState,
      outcome === "saved" ? "savedForLater" : "returnedToTask",
      1,
      { title: item.title, url: item.destinationUrl, category: item.category }
    );

    await chrome.storage.local.set({
      pendingTabs: currentState.pendingTabs,
      stats: currentState.stats,
      activitySessions: currentState.activitySessions
    });

    return {
      ok: true,
      openerTabId: item.openerTabId
    };
  });

  if (result.ok) {
    if (result.openerTabId) {
      try {
        await chrome.tabs.update(result.openerTabId, { active: true });
      } catch {
        // The original tab may have been closed; closing this pause tab is enough.
      }
    }

    await chrome.tabs.remove(senderTabId);
  }

  return result;
}

async function reviewPendingTab(queueId) {
  const currentState = await getState();
  const item = findPendingTab(currentState, queueId);

  if (!item) {
    return { ok: false, error: "That saved tab is no longer available." };
  }

  if (item.tabId) {
    await chrome.tabs.update(item.tabId, { active: true });
    return { ok: true };
  }

  const pausePageUrl = chrome.runtime.getURL(
    `pause.html?id=${encodeURIComponent(item.id)}`
  );
  const pauseTab = await chrome.tabs.create({ url: pausePageUrl });

  await runStorageTask(async () => {
    const latestState = await getState();
    const latestItem = findPendingTab(latestState, queueId);

    if (latestItem) {
      latestItem.tabId = pauseTab.id;
      latestItem.status = "waiting";
      await chrome.storage.local.set({ pendingTabs: latestState.pendingTabs });
    }
  });

  return { ok: true };
}

async function captureNavigationInsidePausedTab(tabId, newUrl, title) {
  if (!isWebUrl(newUrl)) {
    return null;
  }

  const queueId = await runStorageTask(async () => {
    const currentState = await getState();

    if (!currentState.enabled) {
      return null;
    }

    const item = currentState.pendingTabs.find(
      (candidate) => candidate.tabId === tabId
    );

    if (!item) {
      return null;
    }

    // Capture destinations typed after Ctrl+T and keep the same pause in force.
    item.destinationUrl = newUrl;
    item.destinationHost = getHost(newUrl);
    item.title = title || item.destinationHost || item.title;
    item.category = getCategoryForUrl(newUrl, currentState) || "";
    item.decisionReadyAt = 0;
    item.intent = "";

    await chrome.storage.local.set({
      pendingTabs: currentState.pendingTabs
    });

    return item.id;
  });

  if (queueId) {
    await chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL(
        `pause.html?id=${encodeURIComponent(queueId)}`
      )
    });
  }

  return queueId;
}

// Live hyperlink-trail checkpoints

function createNavigationTrail(domain, now) {
  return {
    startedAt: now,
    lastActivityAt: now,
    linkedVisits: 0,
    domains: domain ? [domain] : [],
    lastPromptDepth: 0,
    pendingLink: null
  };
}

function copyNavigationTrail(trail) {
  return {
    startedAt: Number(trail.startedAt) || Date.now(),
    lastActivityAt: Number(trail.lastActivityAt) || Date.now(),
    linkedVisits: Number(trail.linkedVisits) || 0,
    domains: Array.isArray(trail.domains)
      ? trail.domains.slice(-30)
      : [],
    lastPromptDepth: Number(trail.lastPromptDepth) || 0,
    pendingLink: trail.pendingLink || null
  };
}

function pruneOldNavigationTrails(currentState, now) {
  const maximumAge =
    RABBIT_TRAIL_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE;

  Object.entries(currentState.navigationTrails || {}).forEach(
    ([tabKey, trail]) => {
      if (!trail || now - Number(trail.lastActivityAt || 0) > maximumAge) {
        delete currentState.navigationTrails[tabKey];
      }
    }
  );
}

async function recordLinkDeparture(message, sender) {
  return runStorageTask(async () => {
    const currentState = await getState();
    const tabId = sender.tab?.id;
    const sourceDomain = getHost(sender.tab?.url || "");
    const destinationDomain = getHost(message.destinationUrl || "");

    if (
      !currentState.enabled ||
      !Number.isInteger(tabId) ||
      !sourceDomain ||
      !destinationDomain
    ) {
      return { ok: true, ignored: true };
    }

    const now = Date.now();
    const tabKey = String(tabId);
    pruneOldNavigationTrails(currentState, now);

    const trail = currentState.navigationTrails[tabKey]
      ? copyNavigationTrail(currentState.navigationTrails[tabKey])
      : createNavigationTrail(sourceDomain, now);

    trail.lastActivityAt = now;
    trail.pendingLink = {
      at: now,
      destinationDomain
    };
    currentState.navigationTrails[tabKey] = trail;

    // Keep only domains and short-lived timestamps, never link paths.
    await chrome.storage.local.set({
      navigationTrails: currentState.navigationTrails
    });

    return { ok: true };
  });
}

function pendingLinkMatches(trail, destinationDomain, now) {
  const pendingLink = trail?.pendingLink;

  return Boolean(
    pendingLink &&
    now - Number(pendingLink.at || 0) <=
      LINK_DEPARTURE_MATCH_SECONDS * 1000 &&
    pendingLink.destinationDomain === destinationDomain
  );
}

async function recordPageArrival(message, sender) {
  return runStorageTask(async () => {
    const currentState = await getState();
    const tabId = sender.tab?.id;
    const destinationUrl = sender.tab?.url || "";
    const destinationDomain = getHost(destinationUrl);

    if (
      !currentState.enabled ||
      !Number.isInteger(tabId) ||
      !destinationDomain ||
      !isWebUrl(destinationUrl)
    ) {
      return { ok: true, ignored: true };
    }

    const now = Date.now();
    const tabKey = String(tabId);
    const openerKey = Number.isInteger(sender.tab?.openerTabId)
      ? String(sender.tab.openerTabId)
      : "";
    const navigationType = ["navigate", "reload", "back_forward", "spa"]
      .includes(message.navigationType)
      ? message.navigationType
      : "navigate";
    const referrerDomain = getHost(
      message.referrerDomain
        ? `https://${message.referrerDomain}/`
        : ""
    );

    pruneOldNavigationTrails(currentState, now);

    const existingTrail = currentState.navigationTrails[tabKey];
    const openerTrail = openerKey
      ? currentState.navigationTrails[openerKey]
      : null;
    let trail = existingTrail
      ? copyNavigationTrail(existingTrail)
      : openerTrail
        ? copyNavigationTrail(openerTrail)
        : null;
    const matchedDeparture = Boolean(
      pendingLinkMatches(existingTrail, destinationDomain, now) ||
      pendingLinkMatches(openerTrail, destinationDomain, now)
    );
    const hasUsableReferrer = Boolean(referrerDomain);
    const arrivedThroughLink = Boolean(
      navigationType === "spa" ||
      (navigationType === "navigate" &&
        (matchedDeparture || hasUsableReferrer))
    );

    if (!arrivedThroughLink) {
      // Typed/direct navigation resets the trail; reload/back keeps depth.
      if (!trail || navigationType === "navigate") {
        trail = createNavigationTrail(destinationDomain, now);
      } else {
        trail.lastActivityAt = now;
        trail.pendingLink = null;
      }
    } else {
      if (!trail) {
        trail = createNavigationTrail(referrerDomain || destinationDomain, now);
      }

      trail.linkedVisits += 1;
      trail.lastActivityAt = now;
      trail.domains.push(destinationDomain);
      trail.domains = trail.domains.slice(-30);
      trail.pendingLink = null;
      incrementStoredMetric(currentState, "linkedPageVisits", 1);
    }

    currentState.navigationTrails[tabKey] = trail;

    const configuredDepth = Math.max(
      MINIMUM_RABBIT_HOLE_DEPTH,
      Math.min(
        MAXIMUM_RABBIT_HOLE_DEPTH,
        Number(currentState.rabbitHoleDepth) || 7
      )
    );
    const reachedNewCheckpoint = Boolean(
      arrivedThroughLink &&
      trail.linkedVisits >= configuredDepth &&
      trail.linkedVisits - trail.lastPromptDepth >= configuredDepth
    );
    let intervention = null;

    if (reachedNewCheckpoint) {
      trail.lastPromptDepth = trail.linkedVisits;
      const uniqueDomainCount = new Set(trail.domains).size;
      const durationMinutes = Math.max(
        1,
        Math.round((now - trail.startedAt) / MILLISECONDS_PER_MINUTE)
      );

      intervention = addBehaviorAndChooseInterventionInState(
        currentState,
        "rabbitHoleCheckpoints",
        1,
        {
          title: sender.tab?.title,
          url: destinationUrl,
          category: getCategoryForUrl(destinationUrl, currentState) || "",
          data: {
            linkDepth: trail.linkedVisits,
            uniqueDomainCount,
            durationMinutes,
            referrerDomain
          }
        }
      );
    }

    await chrome.storage.local.set({
      navigationTrails: currentState.navigationTrails,
      stats: currentState.stats,
      activitySessions: currentState.activitySessions,
      recentQuestionableSignals: currentState.recentQuestionableSignals,
      lastIntentPromptAt: currentState.lastIntentPromptAt
    });

    return {
      ok: true,
      linkedDepth: trail.linkedVisits,
      eventId: intervention?.event.id,
      shouldAskForIntent: intervention?.shouldAskForIntent || false,
      coachEnabled: intervention?.coachEnabled ??
        currentState.rabbitHoleCoachEnabled !== false,
      resetSeconds: currentState.mouseResetSeconds
    };
  });
}

// Browser event listeners

chrome.runtime.onInstalled.addListener(async () => {
  const existingState = await chrome.storage.local.get(null);

  // Existing user choices overwrite defaults so an update does not reset them.
  await chrome.storage.local.set({
    ...DEFAULTS,
    ...existingState,
    stats: existingState.stats || DEFAULTS.stats
  });

  // Chrome alarms survive service-worker shutdowns, unlike setInterval.
  chrome.alarms.create("history-analysis", {
    periodInMinutes: 24 * 60
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "history-analysis") {
    return;
  }

  analyzeHistory().catch((error) => {
    console.error("Behavyour could not analyze browser history:", error);
  });
});

async function clearDerivedHistoryResults(turnFeatureOff) {
  historyDataRevision += 1;

  const changes = {
    learnedDistractions: [],
    historyAnalysis: { ...DEFAULTS.historyAnalysis }
  };

  if (turnFeatureOff) {
    changes.historyInsightsEnabled = false;
  }

  await chrome.storage.local.set(changes);
}

// History deletion also clears conclusions based on those visits.
if (chrome.history?.onVisitRemoved) {
  chrome.history.onVisitRemoved.addListener(() => {
    clearDerivedHistoryResults(false).catch((error) => {
      console.error("Behavyour could not clear old history results:", error);
    });
  });
}

// Revoking history permission turns the feature off.
chrome.permissions.onRemoved.addListener((removedPermissions) => {
  if (!(removedPermissions.permissions || []).includes("history")) {
    return;
  }

  clearDerivedHistoryResults(true).catch((error) => {
    console.error("Behavyour could not clear revoked history results:", error);
  });
});

// Serialize tab creation decisions so simultaneous tabs cannot bypass the cooldown.
let newTabDecisionQueue = Promise.resolve();

async function handleNewTabCreated(tab) {
  const currentState = await getState();

  if (!currentState.enabled || (currentState.allowPinned && tab.pinned)) {
    return;
  }

  const url = tab.pendingUrl || tab.url || "";

  // The dashboard is itself a tab and must never lock itself out.
  if (url.startsWith(chrome.runtime.getURL(""))) {
    return;
  }

  await recordActivity("tabsOpened", 1, {
    title: tab.title || "New tab",
    url
  });

  const now = Date.now();
  const cooldownIsActive = now < currentState.lockUntil;

  // Observation-only mode records tabs but does not display a fake cooldown.
  if (!currentState.strictLock) {
    return;
  }

  // Allowed sites bypass the active pause without restarting its timer.
  if (cooldownIsActive) {
    if (!isWhitelisted(url, currentState)) {
      await sendTabToPausePage(tab, url);
    }
    return;
  }

  const cooldownLength =
    Math.max(0, Number(currentState.lockMinutes) || 0) *
    MILLISECONDS_PER_MINUTE;

  await chrome.storage.local.set({
    lockUntil: now + cooldownLength
  });

  const category = getCategoryForUrl(url, currentState);

  if (category) {
    await recordActivity("distractionOpens", 1, {
      title: tab.title || getHost(url),
      url,
      category
    });
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  const scheduledDecision = newTabDecisionQueue.then(() =>
    handleNewTabCreated(tab)
  );

  newTabDecisionQueue = scheduledDecision.catch((error) => {
    console.error("Behavyour could not handle a new tab:", error);
  });
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const navigationWasCaptured = await captureNavigationInsidePausedTab(
      tab.id,
      changeInfo.url,
      tab.title
    );

    if (navigationWasCaptured) {
      return;
    }
  }

  if (changeInfo.status !== "complete" || !isWebUrl(tab.url)) {
    return;
  }

  const currentState = await getState();

  // The master switch now genuinely stops both tracking and enforcement.
  if (!currentState.enabled) {
    return;
  }

  const category = getCategoryForUrl(tab.url, currentState);
  const windowKey = String(tab.windowId);
  const activeSnapshot = currentState.activeTabByWindow[windowKey];

  if (activeSnapshot && activeSnapshot.tabId === tab.id) {
    activeSnapshot.title = tab.title || "";
    activeSnapshot.url = tab.url;
    activeSnapshot.category = category || "";
    await chrome.storage.local.set({
      activeTabByWindow: currentState.activeTabByWindow
    });
  }

  if (category) {
    await recordActivity("sensationalVisits", 1, {
      title: tab.title,
      url: tab.url,
      category
    });
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  let activeTab;

  try {
    activeTab = await chrome.tabs.get(activeInfo.tabId);
  } catch {
    return;
  }

  await runStorageTask(async () => {
    const currentState = await getState();

    if (!currentState.enabled) {
      return;
    }

    const windowKey = String(activeInfo.windowId);
    const previousTab = currentState.activeTabByWindow[windowKey];
    const now = Date.now();

    // A categorized tab left within 30 seconds is recorded as a short detour.
    if (previousTab && previousTab.tabId !== activeTab.id) {
      const durationSeconds = Math.round(
        (now - previousTab.activatedAt) / 1000
      );

      if (
        previousTab.category &&
        durationSeconds <= SHORT_DETOUR_SECONDS
      ) {
        addActivityToState(currentState, "shortDetours", 1, {
          title: previousTab.title,
          url: previousTab.url,
          category: previousTab.category,
          data: { durationSeconds }
        });
      }
    }

    // Activation may precede creation handling; preserve the prior tab for the return
    // action.
    const previousSnapshot =
      previousTab && previousTab.tabId !== activeTab.id
        ? {
            tabId: previousTab.tabId,
            title: previousTab.title,
            url: previousTab.url,
            category: previousTab.category
          }
        : previousTab?.previousTab || null;

    currentState.activeTabByWindow[windowKey] = {
      tabId: activeTab.id,
      activatedAt: now,
      title: activeTab.title || "",
      url: activeTab.url || "",
      category: getCategoryForUrl(activeTab.url, currentState) || "",
      previousTab: previousSnapshot
    };

    await chrome.storage.local.set({
      activeTabByWindow: currentState.activeTabByWindow,
      stats: currentState.stats,
      activitySessions: currentState.activitySessions
    });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  runStorageTask(async () => {
    const currentState = await getState();
    const item = currentState.pendingTabs.find(
      (candidate) => candidate.tabId === tabId
    );

    // Closing a pause page saves its destination for seven days; explicit Return removes
    // it.
    if (item) {
      item.tabId = null;
      item.status = "saved";
      item.decisionReadyAt = 0;
      item.intent = "";

      addActivityToState(currentState, "savedForLater", 1, {
        title: item.title,
        url: item.destinationUrl,
        category: item.category
      });
    }

    for (const [windowKey, activeTab] of Object.entries(
      currentState.activeTabByWindow
    )) {
      if (activeTab.tabId === tabId) {
        delete currentState.activeTabByWindow[windowKey];
      }
    }

    delete currentState.navigationTrails[String(tabId)];
    await clearPendingDriftReflection(tabId);

    await chrome.storage.local.set({
      pendingTabs: currentState.pendingTabs,
      activeTabByWindow: currentState.activeTabByWindow,
      navigationTrails: currentState.navigationTrails,
      stats: currentState.stats,
      activitySessions: currentState.activitySessions
    });
  }).catch((error) => {
    console.error("Behavyour could not clean up a closed tab:", error);
  });
});

// Messages from the popup, dashboard, and content script

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") {
    return { ok: false, error: "A message type is required." };
  }

  if (
    ["getPauseContext", "beginIntentionalOpen", "completeIntentionalOpen",
      "returnToTask", "saveForLater"].includes(message.type) &&
    !messageCameFromPausePage(sender)
  ) {
    return { ok: false, error: "Only a Behavyour pause page can do that." };
  }

  switch (message.type) {
    case "getContentSettings": {
      // Pages receive observer settings without dashboard history/session data.
      const currentState = await getState();
      const relevantUrl = sender.tab?.url || "";
      const infiniteFeedCoachEnabled =
        currentState.infiniteFeedCoachEnabled !== false;
      let pendingDriftReflection =
        await getPendingDriftReflectionForTab(sender.tab?.id);

      // Disabling protection clears the challenge so it cannot return after a later
      // re-enable.
      if (
        pendingDriftReflection &&
        (!currentState.enabled || !infiniteFeedCoachEnabled)
      ) {
        await clearPendingDriftReflection(sender.tab?.id);
        pendingDriftReflection = null;
      }

      return {
        ok: true,
        enabled: currentState.enabled,
        mouseCoachEnabled: currentState.mouseCoachEnabled !== false,
        mouseResetSeconds: currentState.mouseResetSeconds,
        rabbitHoleCoachEnabled:
          currentState.rabbitHoleCoachEnabled !== false,
        scrollCoachEnabled: currentState.scrollCoachEnabled !== false,
        scrollMinutesBeforePrompt: currentState.scrollMinutesBeforePrompt,
        infiniteFeedCoachEnabled,
        screenToneEnabled: currentState.screenToneEnabled === true,
        category: getCategoryForUrl(relevantUrl, currentState) || "",
        pendingDriftReflection
      };
    }

    case "linkDeparture":
      return recordLinkDeparture(message, sender);

    case "pageArrival":
      return recordPageArrival(message, sender);

    case "behavior": {
      if (!CONTENT_BEHAVIOR_METRICS.has(message.metric)) {
        return { ok: false, error: "Unknown behavior metric." };
      }

      const amount = message.amount ?? 1;
      if (!Number.isSafeInteger(amount) || amount < 1) {
        return { ok: false, error: "Behavior counts must be positive integers." };
      }

      return recordBehaviorAndChooseIntervention(
        message.metric,
        amount,
        {
          title: sender.tab?.title,
          url: sender.tab?.url,
          data: message.data || {}
        },
        sender.tab?.id
      );
    }

    case "recordIntent":
      return attachIntentToActivity(message.eventId, message.intent);

    case "recordDriftReflection":
      return attachDriftReflection(
        message.eventId,
        message.initialPoint,
        message.currentPoint,
        sender.tab?.id
      );

    case "getState": {
      const currentState = await getState();
      const relevantUrl = message.url || sender.tab?.url;
      const historyPermissionGranted = await chrome.permissions.contains({
        permissions: ["history"]
      });

      return {
        ...currentState,
        category: getCategoryForUrl(relevantUrl, currentState),
        historyPermissionGranted,
        now: Date.now()
      };
    }

    case "pause": {
      const currentState = await getState();

      // The toolbar cannot disable protection during an active cooldown.
      if (Date.now() < currentState.lockUntil) {
        return {
          ok: false,
          locked: true,
          lockUntil: currentState.lockUntil
        };
      }

      await chrome.storage.local.set({
        enabled: false,
        lockUntil: 0
      });
      return { ok: true };
    }

    case "resume":
      await chrome.storage.local.set({ enabled: true });
      return { ok: true };

    case "enableHistoryInsights":
      await chrome.storage.local.set({ historyInsightsEnabled: true });
      await analyzeHistory();
      return { ok: true };

    case "disableHistoryInsights":
      await clearDerivedHistoryResults(true);
      return { ok: true };

    case "analyzeHistory":
      await analyzeHistory();
      return { ok: true };

    case "getPauseContext":
      return getPauseContext(message.queueId, sender.tab?.id);

    case "beginIntentionalOpen":
      return beginIntentionalOpen(
        message.queueId,
        sender.tab?.id,
        message.intent
      );

    case "completeIntentionalOpen":
      return completeIntentionalOpen(message.queueId, sender.tab?.id);

    case "returnToTask":
      return resolvePausedTab(
        message.queueId,
        sender.tab?.id,
        "returned"
      );

    case "saveForLater":
      return resolvePausedTab(
        message.queueId,
        sender.tab?.id,
        "saved"
      );

    case "reviewPendingTab":
      return reviewPendingTab(message.queueId);

    default:
      return {
        ok: false,
        error: `Unknown message type: ${message.type}`
      };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("Behavyour message failed:", error);
      sendResponse({
        ok: false,
        error: error.message
      });
    });

  // Keep the message channel open until the asynchronous response arrives.
  return true;
});
