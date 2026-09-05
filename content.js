/*
 * WEBPAGE BEHAVIOR OBSERVER AND ATTENTION COACH
 * ---------------------------------------------
 * Chrome places this file inside ordinary webpages. It recognizes a few
 * observable patterns, sends small summaries to background.js, and occasionally
 * presents an intent prompt followed by a hands-off reset.
 *
 * Important privacy boundary:
 *   - Coordinates exist only long enough to calculate movement shape.
 *   - We store rounded distance/count/duration, never raw coordinates.
 *   - We never read typed text, passwords, or form values.
 *   - If the optional screen-tone switch is on, a small visible-text sample is
 *     counted only when sustained scrolling reaches its checkpoint. The words
 *     themselves are immediately discarded; only a small aggregate summary
 *     leaves this file.
 *   - The only text saved is what the user deliberately writes in our prompt.
 */

/*
 * JavaScript note: this is an IIFE (Immediately Invoked Function Expression).
 * It runs now and keeps its variables private from the webpage's own scripts.
 */
(() => {
  // -------------------------------------------------------------------------
  // Observable thresholds
  // -------------------------------------------------------------------------

  const MINIMUM_MOVES_FOR_WANDER = 25;
  const MINIMUM_DISTANCE_FOR_WANDER = 700;
  const MINIMUM_IDLE_TIME_FOR_WANDER = 2500;
  const MOVEMENT_SETTLE_TIME = 1200;
  const MINIMUM_REVERSALS = 8;
  const MINIMUM_REVERSAL_DISTANCE = 400;
  const LOOP_END_DISTANCE = 140;
  const RAPID_REPEAT_WINDOW = 350;
  const AWARENESS_CUE_COOLDOWN = 30 * 1000;
  const MINIMUM_INTENT_CHARACTERS = 8;
  const SIGNIFICANT_RECOVERY_MOVEMENT = 4;
  const SCROLL_SESSION_IDLE_TIME = 45 * 1000;
  const SCROLL_BURST_GAP = 500;
  const USER_SCROLL_INPUT_WINDOW = 1200;
  const MINIMUM_SCROLL_BURSTS = 12;
  const MINIMUM_DOWNWARD_SCREENS = 8;
  const STRONG_DOWNWARD_SCREENS = 15;
  const MINIMUM_GROWTH_SCREENS = 2;
  const SCROLL_REPORT_COOLDOWN = 10 * 60 * 1000;
  const MAXIMUM_TONE_SAMPLE_CHARACTERS = 6000;
  const MAXIMUM_TONE_SAMPLE_WORDS = 500;
  const INFINITE_FEED_MEDIA_LIMIT = 10;
  const MEDIA_DISCOVERY_AFTER_SCROLL_WINDOW = 5 * 1000;
  const MEDIA_SEQUENCE_IDLE_TIME = 45 * 1000;
  const MAXIMUM_MEDIA_PER_MUTATION_BATCH = 50;
  const MINIMUM_MEDIA_WIDTH = 160;
  const MINIMUM_MEDIA_HEIGHT = 100;
  const MINIMUM_DRIFT_REFLECTION_WORDS = 50;
  const REFLECTION_WORD_SEGMENTER = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;
  const SCROLL_KEYS = new Set([
    "ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "
  ]);

  /*
   * A deliberately small English word list keeps tone estimation transparent
   * and cheap. It is not a machine-learning model and cannot understand
   * sarcasm, negation, quoted speech, or other languages.
   */
  const NEGATIVE_TONE_WORDS = new Set([
    "abuse", "afraid", "anger", "angry", "anxious", "attack", "awful",
    "crisis", "cruel", "danger", "dead", "death", "disaster",
    "disgusting", "doom", "fear", "fraud", "hate", "horrible", "idiot",
    "kill", "killed", "lies", "outrage", "panic", "scared", "shame",
    "stupid", "threat", "toxic", "violence", "war", "worst"
  ]);
  const POSITIVE_TONE_WORDS = new Set([
    "calm", "care", "celebrate", "encouraging", "fair", "glad", "good",
    "great", "happy", "help", "helpful", "hope", "improve", "joy",
    "kind", "love", "peace", "positive", "relief", "safe", "support",
    "thanks", "thoughtful", "welcome", "wonderful"
  ]);

  /*
   * These are common elements where a click normally has a clear outcome.
   * Custom website controls are imperfect, so click signals never hard-block.
   */
  const INTERACTIVE_ELEMENT_SELECTOR = [
    "a",
    "button",
    "input",
    "select",
    "textarea",
    "label",
    "summary",
    "canvas",
    "iframe",
    "[role='button']",
    "[role='link']",
    "[contenteditable='true']",
    "[onclick]",
    "video",
    "audio"
  ].join(",");

  const FORM_CONTROL_SELECTOR = [
    "input",
    "select",
    "textarea",
    "[contenteditable='true']"
  ].join(",");

  // -------------------------------------------------------------------------
  // Settings cached from extension storage
  // -------------------------------------------------------------------------

  let extensionEnabled = false;
  let mouseCoachEnabled = true;
  let rabbitHoleCoachEnabled = true;
  let scrollCoachEnabled = true;
  let scrollMinutesBeforePrompt = 2;
  let infiniteFeedCoachEnabled = true;
  let screenToneEnabled = false;
  let currentPageCategory = "";

  async function loadSettings(reportThisPage = true) {
    try {
      const currentState = await chrome.runtime.sendMessage({
        type: "getContentSettings"
      });

      extensionEnabled = Boolean(currentState.enabled);
      mouseCoachEnabled = Boolean(currentState.mouseCoachEnabled);
      rabbitHoleCoachEnabled = Boolean(currentState.rabbitHoleCoachEnabled);
      scrollCoachEnabled = Boolean(currentState.scrollCoachEnabled);
      scrollMinutesBeforePrompt = Math.max(
        1,
        Math.min(10, Number(currentState.scrollMinutesBeforePrompt) || 2)
      );
      infiniteFeedCoachEnabled = Boolean(
        currentState.infiniteFeedCoachEnabled
      );
      screenToneEnabled = Boolean(currentState.screenToneEnabled);
      currentPageCategory = currentState.category || "";

      /*
       * A normal reload must not become a one-keystroke escape from the hard
       * checkpoint. background.js remembers an unanswered challenge for this
       * tab for the rest of the browser session and returns it here.
       */
      if (
        extensionEnabled &&
        infiniteFeedCoachEnabled &&
        !intentPromptIsVisible &&
        currentState.pendingDriftReflection?.eventId
      ) {
        showDriftReflectionPrompt(
          currentState.pendingDriftReflection.eventId,
          currentState.pendingDriftReflection.resetSeconds
        );
      }

      if (extensionEnabled && reportThisPage) {
        reportPageArrival();
      }
    } catch {
      // An extension reload can temporarily disconnect an older content script.
      extensionEnabled = false;
    }
  }

  /*
   * This listener keeps a page that has been open for hours in sync with the
   * toolbar switch. It receives changes only from this extension's storage.
   */
  chrome.storage.onChanged.addListener((changes, storageArea) => {
    if (storageArea !== "local") {
      return;
    }

    if (changes.enabled) {
      extensionEnabled = Boolean(changes.enabled.newValue);

      if (!extensionEnabled) {
        scrollSession = null;
        resetMovementBurst();
        resetInfiniteFeedSequence();
      }
    }

    if (changes.mouseCoachEnabled) {
      mouseCoachEnabled = Boolean(changes.mouseCoachEnabled.newValue);
    }

    if (changes.rabbitHoleCoachEnabled) {
      rabbitHoleCoachEnabled = Boolean(
        changes.rabbitHoleCoachEnabled.newValue
      );
    }

    if (changes.scrollCoachEnabled) {
      scrollCoachEnabled = Boolean(changes.scrollCoachEnabled.newValue);
    }

    if (changes.scrollMinutesBeforePrompt) {
      scrollMinutesBeforePrompt = Math.max(
        1,
        Math.min(
          10,
          Number(changes.scrollMinutesBeforePrompt.newValue) || 2
        )
      );
    }

    if (changes.infiniteFeedCoachEnabled) {
      infiniteFeedCoachEnabled = Boolean(
        changes.infiniteFeedCoachEnabled.newValue
      );
    }

    if (changes.screenToneEnabled) {
      screenToneEnabled = Boolean(changes.screenToneEnabled.newValue);
    }

    /* Classification can change while a long-lived page remains open. */
    if (changes.categoryRules || changes.learnedDistractions) {
      loadSettings(false);
    }
  });

  // -------------------------------------------------------------------------
  // Live hyperlink-trail messages
  // -------------------------------------------------------------------------

  function getDomainFromUrl(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function getNavigationType() {
    /*
     * The Performance API distinguishes a normal arrival from Reload and
     * Back/Forward. Only a normal link-like arrival should deepen a trail.
     */
    const [navigationEntry] = performance.getEntriesByType("navigation");
    return navigationEntry?.type || "navigate";
  }

  async function reportPageArrival(
    navigationType = getNavigationType(),
    referrerDomain = getDomainFromUrl(document.referrer)
  ) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "pageArrival",
        navigationType,
        referrerDomain
      });

      if (!response?.ok || response.ignored || !response.eventId) {
        return;
      }

      if (response.shouldAskForIntent) {
        showIntentPrompt(
          response.eventId,
          "rabbitHoleCheckpoints",
          response.resetSeconds
        );
      } else if (response.coachEnabled ?? rabbitHoleCoachEnabled) {
        showAwarenessCue(descriptionForMetric("rabbitHoleCheckpoints"));
      }
    } catch {
      // Harmless if this page belongs to an older, reloaded extension version.
    }
  }

  function reportLinkDeparture(linkElement) {
    let destination;
    let sourceAddress;

    try {
      destination = new URL(linkElement.href, location.href);
      sourceAddress = new URL(location.href);
    } catch {
      return;
    }

    const isOnlyAJumpWithinThisDocument = Boolean(
      destination.origin === sourceAddress.origin &&
      destination.pathname === sourceAddress.pathname &&
      destination.search === sourceAddress.search &&
      destination.hash !== sourceAddress.hash
    );

    if (
      !/^https?:$/.test(destination.protocol) ||
      linkElement.hasAttribute("download") ||
      isOnlyAJumpWithinThisDocument
    ) {
      return;
    }

    const addressBeforeClick = location.href;
    const sourceDomain = getDomainFromUrl(addressBeforeClick);

    /*
     * Send only the destination origin (for example https://example.com), not
     * its path or query. background.js needs the domain to match the arrival;
     * it does not need the specific article title or search terms.
     */
    chrome.runtime.sendMessage({
      type: "linkDeparture",
      destinationUrl: destination.origin
    }).catch(() => {});

    /*
     * Single-page apps can change their URL without loading content.js again.
     * If this script is still alive and the address changed, report that as a
     * confirmed in-page link arrival. A full page load destroys this timer and
     * the new page reports itself normally, so the visit is not counted twice.
     */
    setTimeout(() => {
      if (location.href !== addressBeforeClick) {
        reportPageArrival("spa", sourceDomain);
      }
    }, 900);
  }

  // -------------------------------------------------------------------------
  // Temporary movement state — none of this is persisted
  // -------------------------------------------------------------------------

  let moveCount = 0;
  let distanceTravelled = 0;
  let reversalCount = 0;
  let firstPoint = null;
  let previousPoint = null;
  let previousMovementVector = null;
  let movementStartedAt = 0;
  let lastUsefulActionAt = Date.now();
  let movementTimer;

  let lastClickAt = 0;
  let lastClickedElement = null;

  let awarenessCue = null;
  let lastAwarenessCueAt = 0;
  let intentPromptIsVisible = false;
  let recoveryIsRunning = false;
  let recoveryEndsAt = 0;
  let recoveryDuration = 0;
  let recoveryAnchorPoint = null;
  let recoveryStatusElement = null;
  let recoveryTimer;
  let recoveryTriggerMetric = "";

  /* One scroll session follows the page area the user is actively scrolling. */
  let scrollSession = null;
  let lastUserScrollInputAt = 0;
  let lastScrollReportAt = 0;
  let newMediaLoads = 0;
  let newImageLoads = 0;
  let newVideoLoads = 0;
  let mediaSequenceStartedAt = 0;
  let lastFeedMediaAt = 0;
  let infiniteFeedPromptPending = false;
  let queuedDriftPrompt = null;

  /* WeakMaps disappear with the page and do not keep removed media alive. */
  const lastCountedSourceByMedia = new WeakMap();
  const pendingSourceByMedia = new WeakMap();
  /* This short-lived Set stops ten copies of one placeholder counting as ten. */
  const mediaSourcesInCurrentSequence = new Set();

  function resetMovementBurst() {
    moveCount = 0;
    distanceTravelled = 0;
    reversalCount = 0;
    firstPoint = null;
    previousPoint = null;
    previousMovementVector = null;
    movementStartedAt = 0;
    clearTimeout(movementTimer);
  }

  function recordUsefulAction() {
    if (intentPromptIsVisible) {
      return;
    }

    lastUsefulActionAt = Date.now();
    resetMovementBurst();
  }

  // -------------------------------------------------------------------------
  // False-positive safeguards
  // -------------------------------------------------------------------------

  function pageIsInSensitiveInteraction() {
    const activeElement = document.activeElement;
    const formControlHasFocus =
      activeElement instanceof Element &&
      Boolean(activeElement.closest(FORM_CONTROL_SELECTOR));
    const selection = window.getSelection();
    const textIsSelected = selection && !selection.isCollapsed;

    return Boolean(
      document.hidden ||
      document.fullscreenElement ||
      document.pointerLockElement ||
      formControlHasFocus ||
      textIsSelected
    );
  }

  function shouldIgnorePointerEvent(event) {
    return Boolean(
      !extensionEnabled ||
      intentPromptIsVisible ||
      !event.isTrusted ||
      event.pointerType === "touch" ||
      event.pointerType === "pen" ||
      pageIsInSensitiveInteraction()
    );
  }

  // -------------------------------------------------------------------------
  // Human-readable, privacy-limited descriptions
  // -------------------------------------------------------------------------

  function describePageRegion(clientX, clientY) {
    let horizontal = "center";
    let vertical = "middle";

    if (clientX < window.innerWidth / 3) {
      horizontal = "left";
    } else if (clientX > (window.innerWidth * 2) / 3) {
      horizontal = "right";
    }

    if (clientY < window.innerHeight / 3) {
      vertical = "top";
    } else if (clientY > (window.innerHeight * 2) / 3) {
      vertical = "bottom";
    }

    return `${vertical} ${horizontal}`;
  }

  function describeElement(element) {
    if (!element) {
      return "page background";
    }

    const role = element.getAttribute("role");

    if (role) {
      return `${role} control`;
    }

    const friendlyNames = {
      A: "link",
      BUTTON: "button",
      INPUT: "input",
      TEXTAREA: "text area",
      SELECT: "menu",
      VIDEO: "video",
      AUDIO: "audio",
      CANVAS: "canvas"
    };

    return friendlyNames[element.tagName] || "page area";
  }

  function descriptionForMetric(metric) {
    const descriptions = {
      pointerLoops: "The pointer travelled and returned near where it began.",
      pointerReversals: "The pointer repeatedly moved back and forth.",
      pointerWanders: "The pointer moved substantially without an outcome.",
      blankAreaClicks: "A non-interactive page area was clicked.",
      repeatedClicks: "The same control was clicked again very quickly.",
      rabbitHoleCheckpoints:
        "Several linked pages were followed in one short trail.",
      sustainedScrolling:
        "Scrolling continued long enough to make a deliberate checkpoint useful.",
      infiniteFeedCheckpoints:
        "Ten new, substantial images or videos loaded during this feed sequence."
    };

    return descriptions[metric] || "An uncertain interaction pattern appeared.";
  }

  // -------------------------------------------------------------------------
  // Sending one summarized event to background.js
  // -------------------------------------------------------------------------

  function localCoachIsEnabled(metric) {
    if (metric === "sustainedScrolling") {
      return scrollCoachEnabled;
    }

    if (metric === "infiniteFeedCheckpoints") {
      return infiniteFeedCoachEnabled;
    }

    return mouseCoachEnabled;
  }

  async function reportQuestionableAction(metric, data) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "behavior",
        metric,
        amount: 1,
        data
      });

      if (!response?.ok || response.ignored) {
        /* Do not leave counting frozen if the master switch changed mid-send. */
        if (metric === "infiniteFeedCheckpoints") {
          infiniteFeedPromptPending = false;
        }

        return;
      }

      if (response.shouldAskForIntent) {
        if (metric === "infiniteFeedCheckpoints") {
          const promptRequest = {
            eventId: response.eventId,
            resetSeconds: response.resetSeconds
          };

          if (intentPromptIsVisible) {
            queuedDriftPrompt = promptRequest;
          } else {
            showDriftReflectionPrompt(
              promptRequest.eventId,
              promptRequest.resetSeconds
            );
          }
        } else {
          showIntentPrompt(
            response.eventId,
            metric,
            response.resetSeconds
          );
        }
      } else if (
        response.coachEnabled ?? localCoachIsEnabled(metric)
      ) {
        showAwarenessCue(descriptionForMetric(metric));
      }

      if (
        metric === "infiniteFeedCheckpoints" &&
        !response.shouldAskForIntent
      ) {
        infiniteFeedPromptPending = false;
      }
    } catch {
      // Harmless when an extension reload disconnects this older page script.
      if (metric === "infiniteFeedCheckpoints") {
        infiniteFeedPromptPending = false;
      }
    }
  }

  async function reportCompletedReset(
    completedTriggerMetric = recoveryTriggerMetric
  ) {
    try {
      await chrome.runtime.sendMessage({
        type: "behavior",
        metric: "mouseResetsCompleted",
        amount: 1,
        data: {
          triggerMetric: completedTriggerMetric,
          stillSeconds: recoveryDuration
        }
      });
    } catch {
      // The completed physical reset still happened even if reporting failed.
    }
  }

  // -------------------------------------------------------------------------
  // Sustained-scroll observation and optional visible-tone sampling
  // -------------------------------------------------------------------------

  function getScrollSnapshot(eventTarget) {
    const pageScroller = document.scrollingElement || document.documentElement;
    const targetIsWholePage = Boolean(
      eventTarget === document ||
      eventTarget === window ||
      eventTarget === document.documentElement ||
      eventTarget === document.body
    );
    const scroller = targetIsWholePage ? pageScroller : eventTarget;

    if (!(scroller instanceof Element)) {
      return null;
    }

    return {
      target: scroller,
      position: targetIsWholePage ? window.scrollY : scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      viewportHeight: Math.max(
        1,
        targetIsWholePage ? window.innerHeight : scroller.clientHeight
      )
    };
  }

  function beginScrollSession(snapshot, now) {
    scrollSession = {
      target: snapshot.target,
      startedAt: now,
      lastActivityAt: now,
      lastMovementAt: 0,
      lastPosition: snapshot.position,
      initialScrollHeight: snapshot.scrollHeight,
      maximumScrollHeight: snapshot.scrollHeight,
      viewportHeight: snapshot.viewportHeight,
      activeMilliseconds: 0,
      downwardPixels: 0,
      upwardPixels: 0,
      bursts: 0,
      directionChanges: 0,
      previousDirection: 0
    };
  }

  function sampleVisibleTone() {
    /*
     * Sampling fifteen viewport points avoids walking the full page DOM. From
     * each point we take the nearest normal text block, never an input. Text is
     * capped twice (characters and words), counted here, then discarded.
     */
    const textBlockSelector = [
      "p", "li", "blockquote", "h1", "h2", "h3", "figcaption",
      "[role='article']"
    ].join(",");
    const horizontalPoints = [0.18, 0.5, 0.82];
    const verticalPoints = [0.12, 0.31, 0.5, 0.69, 0.88];
    const sampledElements = new Set();
    let sampledText = "";

    verticalPoints.forEach((verticalPoint) => {
      horizontalPoints.forEach((horizontalPoint) => {
        if (sampledText.length >= MAXIMUM_TONE_SAMPLE_CHARACTERS) {
          return;
        }

        const elements = document.elementsFromPoint(
          Math.round(window.innerWidth * horizontalPoint),
          Math.round(window.innerHeight * verticalPoint)
        );
        let textBlock = null;

        for (const element of elements) {
          const candidate = element.closest?.(textBlockSelector);

          if (
            candidate &&
            !candidate.closest(FORM_CONTROL_SELECTOR) &&
            !candidate.closest("#behavyour-intent-overlay") &&
            candidate.getClientRects().length > 0
          ) {
            textBlock = candidate;
            break;
          }
        }

        if (!textBlock || sampledElements.has(textBlock)) {
          return;
        }

        sampledElements.add(textBlock);
        const remainingCharacters =
          MAXIMUM_TONE_SAMPLE_CHARACTERS - sampledText.length;
        const visibleText = String(textBlock.innerText || "")
          .replace(/\s+/g, " ")
          .slice(0, remainingCharacters);
        sampledText += ` ${visibleText}`;
      });
    });

    const words = (sampledText.toLowerCase().match(/[a-z][a-z'-]{1,}/g) || [])
      .slice(0, MAXIMUM_TONE_SAMPLE_WORDS);
    let negativeHits = 0;
    let positiveHits = 0;

    words.forEach((word) => {
      if (NEGATIVE_TONE_WORDS.has(word)) {
        negativeHits += 1;
      }

      if (POSITIVE_TONE_WORDS.has(word)) {
        positiveHits += 1;
      }
    });

    const emotionalHits = negativeHits + positiveHits;
    const negativeShare = emotionalHits
      ? Math.round((negativeHits / emotionalHits) * 100)
      : null;
    let toneBand = "insufficient evidence";

    if (words.length >= 60 && emotionalHits >= 4) {
      if (negativeHits >= 5 && negativeShare >= 65) {
        toneBand = "negative-leaning";
      } else if (positiveHits >= 5 && negativeShare <= 35) {
        toneBand = "positive-leaning";
      } else {
        toneBand = "mixed/unclear";
      }
    }

    return {
      sampledWords: words.length,
      negativeHits,
      positiveHits,
      negativeShare,
      toneBand
    };
  }

  function handleScrollActivity(event) {
    const now = Date.now();

    if (
      !extensionEnabled ||
      intentPromptIsVisible ||
      document.hidden ||
      now - lastUserScrollInputAt > USER_SCROLL_INPUT_WINDOW
    ) {
      return;
    }

    const snapshot = getScrollSnapshot(event.target);

    if (!snapshot) {
      return;
    }

    const sessionExpired = Boolean(
      scrollSession &&
      now - scrollSession.lastActivityAt > SCROLL_SESSION_IDLE_TIME
    );
    const changedScrollArea = Boolean(
      scrollSession && scrollSession.target !== snapshot.target
    );

    if (!scrollSession || sessionExpired || changedScrollArea) {
      beginScrollSession(snapshot, now);
      return;
    }

    const movement = snapshot.position - scrollSession.lastPosition;
    const timeSincePriorEvent = now - scrollSession.lastActivityAt;
    scrollSession.lastActivityAt = now;
    scrollSession.lastPosition = snapshot.position;
    scrollSession.maximumScrollHeight = Math.max(
      scrollSession.maximumScrollHeight,
      snapshot.scrollHeight
    );

    if (Math.abs(movement) < 2) {
      return;
    }

    /* Cap pauses so forty idle seconds do not masquerade as active scrolling. */
    scrollSession.activeMilliseconds += Math.min(timeSincePriorEvent, 1500);

    if (movement > 0) {
      scrollSession.downwardPixels += movement;
    } else {
      scrollSession.upwardPixels += Math.abs(movement);
    }

    const direction = movement > 0 ? 1 : -1;

    if (
      scrollSession.previousDirection &&
      direction !== scrollSession.previousDirection
    ) {
      scrollSession.directionChanges += 1;
    }

    scrollSession.previousDirection = direction;

    if (
      !scrollSession.lastMovementAt ||
      now - scrollSession.lastMovementAt > SCROLL_BURST_GAP
    ) {
      scrollSession.bursts += 1;
    }

    scrollSession.lastMovementAt = now;

    const downwardScreens =
      scrollSession.downwardPixels / scrollSession.viewportHeight;
    const pageGrowthScreens = Math.max(
      0,
      (scrollSession.maximumScrollHeight - scrollSession.initialScrollHeight) /
        scrollSession.viewportHeight
    );
    const hasEnoughActiveTime =
      scrollSession.activeMilliseconds >=
      scrollMinutesBeforePrompt * 60 * 1000;
    const hasEnoughScrolling = Boolean(
      downwardScreens >= MINIMUM_DOWNWARD_SCREENS &&
      scrollSession.bursts >= MINIMUM_SCROLL_BURSTS
    );
    const hasSupportingContext = Boolean(
      pageGrowthScreens >= MINIMUM_GROWTH_SCREENS ||
      currentPageCategory ||
      downwardScreens >= STRONG_DOWNWARD_SCREENS
    );
    const reportIsRested =
      now - lastScrollReportAt >= SCROLL_REPORT_COOLDOWN;

    if (
      !hasEnoughActiveTime ||
      !hasEnoughScrolling ||
      !hasSupportingContext ||
      !reportIsRested
    ) {
      return;
    }

    const toneSummary = screenToneEnabled
      ? sampleVisibleTone()
      : null;
    const data = {
      activeSeconds: Math.round(scrollSession.activeMilliseconds / 1000),
      elapsedSeconds: Math.round((now - scrollSession.startedAt) / 1000),
      downwardScreens: Math.round(downwardScreens * 10) / 10,
      upwardScreens:
        Math.round(
          (scrollSession.upwardPixels / scrollSession.viewportHeight) * 10
        ) / 10,
      scrollBursts: scrollSession.bursts,
      directionChanges: scrollSession.directionChanges,
      pageGrowthScreens: Math.round(pageGrowthScreens * 10) / 10,
      ...(toneSummary || {})
    };

    lastScrollReportAt = now;
    scrollSession = null;
    reportQuestionableAction("sustainedScrolling", data);
  }

  // -------------------------------------------------------------------------
  // Newly loaded media in an infinite feed
  // -------------------------------------------------------------------------

  function resetInfiniteFeedSequence() {
    newMediaLoads = 0;
    newImageLoads = 0;
    newVideoLoads = 0;
    mediaSequenceStartedAt = 0;
    lastFeedMediaAt = 0;
    mediaSourcesInCurrentSequence.clear();
  }

  function getMediaSourceSignature(mediaElement) {
    let rawSource = "";

    if (mediaElement instanceof HTMLImageElement) {
      const parentPicture = mediaElement.closest("picture");
      const pictureSources = parentPicture
        ? [...parentPicture.querySelectorAll("source")]
            .map(
              (sourceElement) =>
                sourceElement.getAttribute("srcset") ||
                sourceElement.getAttribute("src") ||
                ""
            )
            .filter(Boolean)
        : [];

      /*
       * Prefer the declared source. During virtualized-feed reuse, `src` can
       * already contain the new item while `currentSrc` briefly reports the
       * old loaded item. Looking at `currentSrc` first would miss that change.
       * Responsive `<picture>` URLs live on sibling `source` elements, so they
       * join the signature as well.
       */
      const declaredImageSources = [
        ...pictureSources,
        mediaElement.getAttribute("srcset") || "",
        mediaElement.getAttribute("src") || ""
      ].filter(Boolean);
      rawSource = declaredImageSources.join("|") || mediaElement.currentSrc;
    } else if (mediaElement instanceof HTMLVideoElement) {
      const declaredVideoSources = [
        mediaElement.getAttribute("src") || "",
        ...[...mediaElement.querySelectorAll("source[src]")].map(
          (sourceElement) => sourceElement.getAttribute("src") || ""
        )
      ].filter(Boolean);
      rawSource = declaredVideoSources.join("|") ||
        mediaElement.getAttribute("poster") ||
        mediaElement.currentSrc ||
        "";
    }

    /* The value is transient and capped; only counts are ever sent or stored. */
    return rawSource
      ? `${mediaElement.tagName}:${String(rawSource).slice(0, 300)}`
      : "";
  }

  function mediaIsLoaded(mediaElement) {
    if (mediaElement instanceof HTMLImageElement) {
      return mediaElement.complete && mediaElement.naturalWidth > 0;
    }

    return (
      mediaElement instanceof HTMLVideoElement &&
      mediaElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    );
  }

  function mediaIsSubstantialAndNearby(mediaElement) {
    const rectangle = mediaElement.getBoundingClientRect();
    const style = getComputedStyle(mediaElement);
    const isLargeEnough = Boolean(
      rectangle.width >= MINIMUM_MEDIA_WIDTH &&
      rectangle.height >= MINIMUM_MEDIA_HEIGHT
    );
    const isNearViewport = Boolean(
      rectangle.top <= window.innerHeight * 2.5 &&
      rectangle.bottom >= -window.innerHeight * 0.5
    );

    return Boolean(
      isLargeEnough &&
      isNearViewport &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0 &&
      !mediaElement.closest("#behavyour-intent-overlay")
    );
  }

  function countLoadedFeedMedia(mediaElement, expectedSource) {
    if (
      !extensionEnabled ||
      intentPromptIsVisible ||
      infiniteFeedPromptPending ||
      document.hidden ||
      getMediaSourceSignature(mediaElement) !== expectedSource ||
      lastCountedSourceByMedia.get(mediaElement) === expectedSource ||
      !mediaIsLoaded(mediaElement) ||
      !mediaIsSubstantialAndNearby(mediaElement)
    ) {
      return;
    }

    const now = Date.now();

    /*
     * "Ten loads" means one continuing feed run. If no qualifying media has
     * appeared for 45 seconds, the next item begins a fresh sequence instead
     * of completing a batch that started much earlier in the day.
     */
    if (
      lastFeedMediaAt &&
      now - lastFeedMediaAt > MEDIA_SEQUENCE_IDLE_TIME
    ) {
      resetInfiniteFeedSequence();
    }

    if (mediaSourcesInCurrentSequence.has(expectedSource)) {
      /* Remember the element too, so repeated mutations do no extra work. */
      lastCountedSourceByMedia.set(mediaElement, expectedSource);
      return;
    }

    mediaSourcesInCurrentSequence.add(expectedSource);
    lastCountedSourceByMedia.set(mediaElement, expectedSource);

    if (!mediaSequenceStartedAt) {
      mediaSequenceStartedAt = now;
    }

    lastFeedMediaAt = now;
    newMediaLoads += 1;

    if (mediaElement instanceof HTMLVideoElement) {
      newVideoLoads += 1;
    } else {
      newImageLoads += 1;
    }

    if (newMediaLoads < INFINITE_FEED_MEDIA_LIMIT) {
      return;
    }

    const data = {
      newMediaLoads,
      imageLoads: newImageLoads,
      videoLoads: newVideoLoads,
      elapsedSeconds: Math.max(
        1,
        Math.round((now - mediaSequenceStartedAt) / 1000)
      )
    };

    /* Stop accepting more feed items until this checkpoint is resolved. */
    infiniteFeedPromptPending = true;
    resetInfiniteFeedSequence();
    reportQuestionableAction("infiniteFeedCheckpoints", data);
  }

  function watchPotentialFeedMedia(mediaElement) {
    if (
      !(mediaElement instanceof HTMLImageElement) &&
      !(mediaElement instanceof HTMLVideoElement)
    ) {
      return;
    }

    if (
      !extensionEnabled ||
      intentPromptIsVisible ||
      infiniteFeedPromptPending ||
      document.hidden ||
      Date.now() - lastUserScrollInputAt >
        MEDIA_DISCOVERY_AFTER_SCROLL_WINDOW
    ) {
      return;
    }

    const sourceSignature = getMediaSourceSignature(mediaElement);

    if (
      !sourceSignature ||
      lastCountedSourceByMedia.get(mediaElement) === sourceSignature ||
      pendingSourceByMedia.get(mediaElement) === sourceSignature
    ) {
      return;
    }

    pendingSourceByMedia.set(mediaElement, sourceSignature);
    let waitingForReadyEvent = false;

    const readyEvent = mediaElement instanceof HTMLImageElement
      ? "load"
      : "loadeddata";

    function stopWaitingAfterError() {
      if (pendingSourceByMedia.get(mediaElement) === sourceSignature) {
        pendingSourceByMedia.delete(mediaElement);
      }
    }

    function waitForReadyEvent() {
      if (waitingForReadyEvent) {
        return;
      }

      waitingForReadyEvent = true;
      mediaElement.addEventListener(readyEvent, countWhenReady, { once: true });
      mediaElement.addEventListener("error", stopWaitingAfterError, {
        once: true
      });
    }

    function countWhenReady() {
      waitingForReadyEvent = false;

      if (pendingSourceByMedia.get(mediaElement) !== sourceSignature) {
        return;
      }

      if (getMediaSourceSignature(mediaElement) !== sourceSignature) {
        pendingSourceByMedia.delete(mediaElement);
        watchPotentialFeedMedia(mediaElement);
        return;
      }

      /* A responsive source can change just before its old image stops loading. */
      if (!mediaIsLoaded(mediaElement)) {
        waitForReadyEvent();
        return;
      }

      pendingSourceByMedia.delete(mediaElement);
      mediaElement.removeEventListener("error", stopWaitingAfterError);
      countLoadedFeedMedia(mediaElement, sourceSignature);
    }

    if (mediaIsLoaded(mediaElement)) {
      requestAnimationFrame(countWhenReady);
    } else {
      waitForReadyEvent();
    }
  }

  function startInfiniteFeedObserver() {
    const observer = new MutationObserver((mutationRecords) => {
      let examinedMedia = 0;

      function findMediaOwnedBySource(sourceElement) {
        const parentVideo = sourceElement.closest("video");

        if (parentVideo) {
          return parentVideo;
        }

        /* In a responsive picture, one img displays the chosen source. */
        return sourceElement.closest("picture")?.querySelector("img") || null;
      }

      function offerMedia(mediaElement) {
        if (examinedMedia >= MAXIMUM_MEDIA_PER_MUTATION_BATCH) {
          return;
        }

        examinedMedia += 1;
        watchPotentialFeedMedia(mediaElement);
      }

      mutationRecords.forEach((record) => {
        if (examinedMedia >= MAXIMUM_MEDIA_PER_MUTATION_BATCH) {
          return;
        }

        if (record.type === "attributes") {
          if (record.target.matches("img, video")) {
            offerMedia(record.target);
          } else if (record.target.matches("source")) {
            const parentMedia = findMediaOwnedBySource(record.target);

            if (parentMedia) {
              offerMedia(parentMedia);
            }
          }

          return;
        }

        record.addedNodes.forEach((addedNode) => {
          if (
            examinedMedia >= MAXIMUM_MEDIA_PER_MUTATION_BATCH ||
            !(addedNode instanceof Element)
          ) {
            return;
          }

          if (addedNode.matches("img, video")) {
            offerMedia(addedNode);
          } else if (addedNode.matches("source")) {
            const parentMedia = findMediaOwnedBySource(addedNode);

            if (parentMedia) {
              offerMedia(parentMedia);
            }
          }

          [...addedNode.querySelectorAll("img, video")]
            .slice(0, MAXIMUM_MEDIA_PER_MUTATION_BATCH - examinedMedia)
            .forEach(offerMedia);
        });
      });
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "poster"]
    });

    /* Auto-playing an existing/virtualized video can reveal a new feed item. */
    document.addEventListener(
      "play",
      (event) => {
        if (event.target instanceof HTMLVideoElement) {
          watchPotentialFeedMedia(event.target);
        }
      },
      true
    );
  }

  // -------------------------------------------------------------------------
  // Recognizing movement shape
  // -------------------------------------------------------------------------

  function evaluateMovementBurst() {
    if (!firstPoint || !previousPoint) {
      resetMovementBurst();
      return;
    }

    const noRecentUsefulAction =
      Date.now() - lastUsefulActionAt > MINIMUM_IDLE_TIME_FOR_WANDER;
    const enoughMovement =
      moveCount >= MINIMUM_MOVES_FOR_WANDER &&
      distanceTravelled >= MINIMUM_DISTANCE_FOR_WANDER;

    if (!noRecentUsefulAction || !enoughMovement) {
      resetMovementBurst();
      return;
    }

    const directDistanceFromStart = Math.hypot(
      previousPoint.x - firstPoint.x,
      previousPoint.y - firstPoint.y
    );
    const durationSeconds = Math.max(
      1,
      Math.round((Date.now() - movementStartedAt) / 1000)
    );

    let metric = "pointerWanders";

    if (directDistanceFromStart <= LOOP_END_DISTANCE) {
      metric = "pointerLoops";
    } else if (
      reversalCount >= MINIMUM_REVERSALS &&
      distanceTravelled >= MINIMUM_REVERSAL_DISTANCE
    ) {
      metric = "pointerReversals";
    }

    const data = {
      pattern: metric,
      moveCount,
      distancePixels: Math.round(distanceTravelled),
      durationSeconds,
      reversalCount,
      startRegion: describePageRegion(firstPoint.x, firstPoint.y),
      endRegion: describePageRegion(previousPoint.x, previousPoint.y)
    };

    resetMovementBurst();
    reportQuestionableAction(metric, data);
  }

  function movementChangedDirection(previousVector, nextVector) {
    if (!previousVector) {
      return false;
    }

    const previousLength = Math.hypot(previousVector.x, previousVector.y);
    const nextLength = Math.hypot(nextVector.x, nextVector.y);

    // Tiny sensor movements should not count as deliberate reversals.
    if (previousLength < 4 || nextLength < 4) {
      return false;
    }

    const dotProduct =
      previousVector.x * nextVector.x +
      previousVector.y * nextVector.y;
    const cosineOfAngle = dotProduct / (previousLength * nextLength);

    // Below -0.6 is a turn of roughly 127 degrees or more.
    return cosineOfAngle < -0.6;
  }

  // -------------------------------------------------------------------------
  // Awareness cue and required intent prompt
  // -------------------------------------------------------------------------

  function showAwarenessCue(message) {
    if (
      awarenessCue ||
      intentPromptIsVisible ||
      Date.now() - lastAwarenessCueAt < AWARENESS_CUE_COOLDOWN
    ) {
      return;
    }

    lastAwarenessCueAt = Date.now();
    awarenessCue = document.createElement("div");
    awarenessCue.id = "behavyour-awareness-cue";
    awarenessCue.setAttribute("role", "status");
    awarenessCue.textContent = `${message} Notice it; no judgment.`;
    document.body.append(awarenessCue);

    setTimeout(() => {
      awarenessCue?.remove();
      awarenessCue = null;
    }, 3500);
  }

  function addPromptText(parent, tagName, text, className) {
    const element = document.createElement(tagName);
    element.textContent = text;

    if (className) {
      element.className = className;
    }

    parent.append(element);
    return element;
  }

  function lockPageScrollingForPrompt() {
    const oldDocumentOverflow = document.documentElement.style.overflow;
    const oldBodyOverflow = document.body.style.overflow;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    /* Return a function that puts the page back exactly as it was. */
    return function restorePageScrolling() {
      document.documentElement.style.overflow = oldDocumentOverflow;
      document.body.style.overflow = oldBodyOverflow;
    };
  }

  function createBlockingPromptOverlay() {
    const overlay = document.createElement("div");
    overlay.id = "behavyour-intent-overlay";
    overlay.tabIndex = -1;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "behavyour-prompt-title");
    function preventScrollingOutsidePrompt(event) {
      const eventStartedInsidePanel = Boolean(
        event.target instanceof Element &&
        event.target.closest(".behavyour-prompt-panel")
      );

      /*
       * The long reflection panel must remain scrollable on a small screen.
       * Only movement on the dark area is cancelled; the page itself is also
       * protected by the overflow lock in `lockPageScrollingForPrompt()`.
       */
      if (!eventStartedInsidePanel) {
        event.preventDefault();
      }
    }

    overlay.addEventListener("wheel", preventScrollingOutsidePrompt, {
      passive: false
    });
    overlay.addEventListener("touchmove", preventScrollingOutsidePrompt, {
      passive: false
    });

    /* Keep keyboard focus inside the hard-lock dialog. */
    overlay.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = [...overlay.querySelectorAll(
        "textarea, button:not(:disabled)"
      )];

      if (focusableElements.length === 0) {
        event.preventDefault();
        overlay.focus();
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    });

    return overlay;
  }

  function countReflectionWords(text) {
    const normalizedText = String(text || "").trim();

    if (!normalizedText) {
      return 0;
    }

    if (REFLECTION_WORD_SEGMENTER) {
      /*
       * This browser feature recognizes word-like pieces in many languages.
       * Punctuation-only chunks do not satisfy the reflection requirement.
       */
      return [...REFLECTION_WORD_SEGMENTER.segment(normalizedText)].filter(
        (piece) => piece.isWordLike
      ).length;
    }

    return (
      normalizedText.match(
        /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu
      ) || []
    ).length;
  }

  function showDriftReflectionPrompt(eventId, resetSeconds) {
    if (intentPromptIsVisible) {
      queuedDriftPrompt = { eventId, resetSeconds };
      return;
    }

    infiniteFeedPromptPending = true;
    intentPromptIsVisible = true;
    recoveryTriggerMetric = "infiniteFeedCheckpoints";
    const previouslyFocusedElement = document.activeElement;
    const restorePageScrolling = lockPageScrollingForPrompt();
    const overlay = createBlockingPromptOverlay();
    const panel = document.createElement("div");
    panel.className = "behavyour-prompt-panel behavyour-drift-panel";
    overlay.append(panel);

    const eyebrow = addPromptText(
      panel,
      "div",
      "INFINITE FEED CHECKPOINT",
      "behavyour-prompt-eyebrow"
    );
    eyebrow.setAttribute("aria-hidden", "true");

    const title = addPromptText(
      panel,
      "h2",
      "Reconnect where you began to where the feed took you"
    );
    title.id = "behavyour-prompt-title";

    addPromptText(
      panel,
      "p",
      "Ten new, substantial images or videos loaded after scrolling. " +
        "The feed stays locked until both questions contain at least 50 " +
        "words combined.",
      "behavyour-trigger-explanation"
    );

    const initialLabel = addPromptText(
      panel,
      "label",
      "1. What did you originally come here to watch or find?",
      "behavyour-intent-label"
    );
    initialLabel.htmlFor = "behavyour-initial-point";

    const initialInput = document.createElement("textarea");
    initialInput.id = "behavyour-initial-point";
    initialInput.className = "behavyour-reflection-input";
    initialInput.rows = 4;
    initialInput.maxLength = 2000;
    initialInput.placeholder =
      "Describe the specific reason you opened this page and what you expected to see.";
    panel.append(initialInput);

    const currentLabel = addPromptText(
      panel,
      "label",
      "2. What are you seeing or watching now, and how far has it drifted?",
      "behavyour-intent-label"
    );
    currentLabel.htmlFor = "behavyour-current-point";

    const currentInput = document.createElement("textarea");
    currentInput.id = "behavyour-current-point";
    currentInput.className = "behavyour-reflection-input";
    currentInput.rows = 4;
    currentInput.maxLength = 2000;
    currentInput.placeholder =
      "Describe the current item and whether it still serves the original purpose.";
    panel.append(currentInput);

    const progress = addPromptText(
      panel,
      "p",
      `0 / ${MINIMUM_DRIFT_REFLECTION_WORDS} words · answer both questions`,
      "behavyour-prompt-guidance"
    );
    progress.setAttribute("aria-live", "polite");

    const continueButton = document.createElement("button");
    continueButton.type = "button";
    continueButton.disabled = true;
    continueButton.textContent = "Save reflection and reset";
    panel.append(continueButton);

    function updateWordProgress() {
      const initialWords = countReflectionWords(initialInput.value);
      const currentWords = countReflectionWords(currentInput.value);
      const totalWords = initialWords + currentWords;
      const bothQuestionsAnswered = initialWords > 0 && currentWords > 0;

      continueButton.disabled = Boolean(
        totalWords < MINIMUM_DRIFT_REFLECTION_WORDS ||
        !bothQuestionsAnswered
      );
      progress.textContent =
        `${totalWords} / ${MINIMUM_DRIFT_REFLECTION_WORDS} words · ` +
        (bothQuestionsAnswered
          ? "both questions answered"
          : "write something in both answers");
    }

    initialInput.addEventListener("input", updateWordProgress);
    currentInput.addEventListener("input", updateWordProgress);

    continueButton.addEventListener("click", async () => {
      continueButton.disabled = true;
      progress.textContent = "Saving your reflection on this device…";

      try {
        const response = await chrome.runtime.sendMessage({
          type: "recordDriftReflection",
          eventId,
          initialPoint: initialInput.value,
          currentPoint: currentInput.value
        });

        if (!response?.ok) {
          progress.textContent =
            response?.error || "The reflection could not be saved. Try again.";
          continueButton.disabled = false;
          return;
        }

        beginHandsOffReset(
          overlay,
          panel,
          Number(resetSeconds) || 5,
          previouslyFocusedElement,
          restorePageScrolling
        );
      } catch {
        progress.textContent =
          "The extension could not save this yet. Your answers remain here; " +
          "try the button again.";
        continueButton.disabled = false;
      }
    });

    document.body.append(overlay);
    initialInput.focus();
  }

  function showIntentPrompt(eventId, triggerMetric, resetSeconds) {
    if (intentPromptIsVisible) {
      return;
    }

    intentPromptIsVisible = true;
    recoveryTriggerMetric = triggerMetric;
    const previouslyFocusedElement = document.activeElement;

    /*
     * This is the enforceable part of the in-page checkpoint: the underlying
     * page cannot keep scrolling while the user writes an intent and completes
     * the hands-off reset. The exact prior inline styles are restored later.
     */
    const restorePageScrolling = lockPageScrollingForPrompt();
    const overlay = createBlockingPromptOverlay();

    const panel = document.createElement("div");
    panel.className = "behavyour-prompt-panel";
    overlay.append(panel);

    const eyebrow = addPromptText(
      panel,
      "div",
      "A MOMENT TO NOTICE",
      "behavyour-prompt-eyebrow"
    );
    eyebrow.setAttribute("aria-hidden", "true");

    const title = addPromptText(
      panel,
      "h2",
      "What were you trying to do just now?"
    );
    title.id = "behavyour-prompt-title";

    addPromptText(
      panel,
      "p",
      descriptionForMetric(triggerMetric),
      "behavyour-trigger-explanation"
    );

    const label = addPromptText(
      panel,
      "label",
      "My intent was to…",
      "behavyour-intent-label"
    );
    label.htmlFor = "behavyour-intent-input";

    const intentInput = document.createElement("textarea");
    intentInput.id = "behavyour-intent-input";
    intentInput.rows = 3;
    intentInput.maxLength = 240;
    intentInput.placeholder = "For example: compare the two options I just read";
    panel.append(intentInput);

    const guidance = addPromptText(
      panel,
      "p",
      `Write at least ${MINIMUM_INTENT_CHARACTERS} characters. ` +
        "This answer stays on this device.",
      "behavyour-prompt-guidance"
    );

    const continueButton = document.createElement("button");
    continueButton.type = "button";
    continueButton.disabled = true;
    continueButton.textContent = "Save intent and reset";
    panel.append(continueButton);

    intentInput.addEventListener("input", () => {
      continueButton.disabled =
        intentInput.value.trim().length < MINIMUM_INTENT_CHARACTERS;
      guidance.textContent =
        intentInput.value.trim().length < MINIMUM_INTENT_CHARACTERS
          ? `Write at least ${MINIMUM_INTENT_CHARACTERS} characters. ` +
            "This answer stays on this device."
          : "Ready. Next comes a short hands-off reset.";
    });

    continueButton.addEventListener("click", async () => {
      continueButton.disabled = true;
      guidance.textContent = "Saving your intent…";

      const response = await chrome.runtime.sendMessage({
        type: "recordIntent",
        eventId,
        intent: intentInput.value
      });

      if (!response.ok) {
        guidance.textContent = response.error;
        continueButton.disabled = false;
        return;
      }

      beginHandsOffReset(
        overlay,
        panel,
        Number(resetSeconds) || 5,
        previouslyFocusedElement,
        restorePageScrolling
      );
    });

    document.body.append(overlay);
    intentInput.focus();
  }

  function beginHandsOffReset(
    overlay,
    panel,
    seconds,
    previouslyFocusedElement,
    restorePageScrolling
  ) {
    panel.replaceChildren();
    overlay.focus();
    recoveryIsRunning = true;
    recoveryDuration = Math.max(3, Math.min(15, seconds));
    recoveryEndsAt = Date.now() + recoveryDuration * 1000;
    recoveryAnchorPoint = null;

    addPromptText(
      panel,
      "div",
      "COMPETING ACTION",
      "behavyour-prompt-eyebrow"
    );
    addPromptText(panel, "h2", "Take your hand off the mouse");
    addPromptText(
      panel,
      "p",
      "Keep the pointer still. Significant movement restarts the timer.",
      "behavyour-trigger-explanation"
    );
    recoveryStatusElement = addPromptText(
      panel,
      "output",
      "",
      "behavyour-recovery-countdown"
    );

    function finishRecovery() {
      const completedTriggerMetric = recoveryTriggerMetric;
      const waitingDriftPrompt = queuedDriftPrompt;
      queuedDriftPrompt = null;
      clearInterval(recoveryTimer);
      overlay.remove();
      intentPromptIsVisible = false;
      recoveryIsRunning = false;
      recoveryStatusElement = null;
      recoveryAnchorPoint = null;
      restorePageScrolling();

      if (previouslyFocusedElement instanceof HTMLElement) {
        previouslyFocusedElement.focus();
      }

      if (completedTriggerMetric === "infiniteFeedCheckpoints") {
        infiniteFeedPromptPending = false;
      }

      reportCompletedReset(completedTriggerMetric);

      if (waitingDriftPrompt) {
        /* Let the finished overlay leave the DOM before opening the queued one. */
        setTimeout(() => {
          showDriftReflectionPrompt(
            waitingDriftPrompt.eventId,
            waitingDriftPrompt.resetSeconds
          );
        }, 0);
      }
    }

    function updateRecoveryCountdown() {
      const millisecondsLeft = Math.max(0, recoveryEndsAt - Date.now());
      const secondsLeft = Math.ceil(millisecondsLeft / 1000);
      recoveryStatusElement.textContent = `${secondsLeft}`;

      if (millisecondsLeft === 0) {
        finishRecovery();
      }
    }

    updateRecoveryCountdown();
    recoveryTimer = setInterval(updateRecoveryCountdown, 100);
  }

  function handlePointerDuringRecovery(event) {
    const currentPoint = { x: event.clientX, y: event.clientY };

    if (recoveryAnchorPoint) {
      const movement = Math.hypot(
        currentPoint.x - recoveryAnchorPoint.x,
        currentPoint.y - recoveryAnchorPoint.y
      );

      if (movement >= SIGNIFICANT_RECOVERY_MOVEMENT) {
        recoveryEndsAt = Date.now() + recoveryDuration * 1000;
        recoveryAnchorPoint = currentPoint;

        if (recoveryStatusElement) {
          recoveryStatusElement.textContent =
            `${recoveryDuration} · movement noticed, restarting`;
        }
      }
    } else {
      /* The first observed move also restarts the hands-off interval. */
      recoveryAnchorPoint = currentPoint;
      recoveryEndsAt = Date.now() + recoveryDuration * 1000;
    }
  }

  // -------------------------------------------------------------------------
  // Page event listeners
  // -------------------------------------------------------------------------

  window.addEventListener(
    "pointermove",
    (event) => {
      if (recoveryIsRunning) {
        handlePointerDuringRecovery(event);
        return;
      }

      if (shouldIgnorePointerEvent(event)) {
        resetMovementBurst();
        return;
      }

      const currentPoint = { x: event.clientX, y: event.clientY };

      if (!firstPoint) {
        firstPoint = currentPoint;
        movementStartedAt = Date.now();
      }

      if (previousPoint) {
        const movementVector = {
          x: currentPoint.x - previousPoint.x,
          y: currentPoint.y - previousPoint.y
        };

        distanceTravelled += Math.hypot(
          movementVector.x,
          movementVector.y
        );

        if (
          movementChangedDirection(
            previousMovementVector,
            movementVector
          )
        ) {
          reversalCount += 1;
        }

        previousMovementVector = movementVector;
      }

      previousPoint = currentPoint;
      moveCount += 1;

      /*
       * Debouncing: every move restarts the timer. Evaluation occurs only
       * after the pointer has settled for 1.2 seconds.
       */
      clearTimeout(movementTimer);
      movementTimer = setTimeout(
        evaluateMovementBurst,
        MOVEMENT_SETTLE_TIME
      );
    },
    { passive: true }
  );

  window.addEventListener(
    "click",
    (event) => {
      if (intentPromptIsVisible || !extensionEnabled || !event.isTrusted) {
        return;
      }

      const clickedElement =
        event.target instanceof Element ? event.target : null;
      const interactiveControl = clickedElement
        ? clickedElement.closest(INTERACTIVE_ELEMENT_SELECTOR)
        : null;
      const followedLink = clickedElement
        ? clickedElement.closest("a[href]")
        : null;
      const isRapidRepeat =
        clickedElement === lastClickedElement &&
        Date.now() - lastClickAt < RAPID_REPEAT_WINDOW;

      const eventData = {
        elementKind: describeElement(interactiveControl),
        pageRegion: describePageRegion(event.clientX, event.clientY),
        millisecondsSincePreviousClick:
          lastClickAt > 0 ? Date.now() - lastClickAt : null
      };

      if (isRapidRepeat) {
        reportQuestionableAction("repeatedClicks", eventData);
      } else if (!interactiveControl) {
        reportQuestionableAction("blankAreaClicks", eventData);
      }

      if (followedLink) {
        reportLinkDeparture(followedLink);
      }

      lastClickAt = Date.now();
      lastClickedElement = clickedElement;
      recordUsefulAction();
    },
    // Capture phase observes without cancelling the webpage's click.
    true
  );

  /*
   * Scroll events can also be caused by a site's own code. Requiring a nearby
   * wheel, touch, or navigation-key input keeps auto-advancing pages from
   * looking like user scrolling. `capture: true` also sees nested feed panels.
   */
  window.addEventListener(
    "wheel",
    (event) => {
      if (event.isTrusted) {
        lastUserScrollInputAt = Date.now();
      }
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    "touchmove",
    (event) => {
      if (event.isTrusted) {
        lastUserScrollInputAt = Date.now();
      }
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.isTrusted &&
        SCROLL_KEYS.has(event.key) &&
        !pageIsInSensitiveInteraction()
      ) {
        lastUserScrollInputAt = Date.now();
      }
    },
    { capture: true, passive: true }
  );
  document.addEventListener(
    "scroll",
    (event) => {
      handleScrollActivity(event);
      recordUsefulAction();
    },
    { capture: true, passive: true }
  );

  const usefulEventTypes = [
    "keydown",
    "input",
    "focusin",
    "dragstart"
  ];

  usefulEventTypes.forEach((eventType) => {
    window.addEventListener(eventType, recordUsefulAction, { passive: true });
  });

  startInfiniteFeedObserver();
  loadSettings();
})();
