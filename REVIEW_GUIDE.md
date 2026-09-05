# Behavyour code review guide

This guide is for a reviewer who understands the product idea but is still
learning JavaScript, HTML, CSS, and Chrome extensions. It explains the code's
shape, the unusual syntax, every important data boundary, and the assumptions
worth challenging.

## The smallest useful mental model

```text
An ordinary webpage
  |
  | pointer, click, link, and user-driven scroll events
  v
content.js keeps short-lived measurements in memory
  |
  | small messages: a metric name plus aggregate facts
  v
background.js makes decisions and writes chrome.storage.local
  |                         |
  |                         | optional permission
  v                         v
popup / dashboard       Chrome history timestamps and visit ancestry
```

There is no server, login, analytics SDK, remote script, or cloud model. The
service worker can be stopped whenever Chrome considers it idle, so anything
that must survive belongs in browser storage.

## Recommended reading order

1. `manifest.json` — the browser-readable table of contents and permissions.
2. `content.js` — live page observation, lightweight tone sampling, and the
   in-page intent/reset checkpoint.
3. `background.js` — storage, categories, history analysis, live link trails,
   tab enforcement, and message routing.
4. `pause.html`, `pause.js`, then `pause.css` — the held-tab checkpoint.
5. `popup.html`, then `popup.js` — the small toolbar window.
6. `dashboard.html`, then `dashboard.js` — settings and readable evidence.
7. `content.css`, `ui.css`, and `history.css` — appearance only.
8. `README.md` — user-facing behavior and limitations.

Search for a section banner such as `Live hyperlink-trail checkpoints` when a
file feels long. Each banner groups one product responsibility.

## File map

| File | Plain-English responsibility | Where it runs |
|---|---|---|
| `manifest.json` | Declares files, permissions, and extension entry points | Read by Chrome/Edge |
| `background.js` | Owns durable state and all browser-level decisions | Event-driven service worker |
| `content.js` | Observes one ordinary page and shows in-page checkpoints | Main frame of each website |
| `content.css` | Styles only the injected cue and modal | Ordinary website |
| `pause.html` | Structure of the held-tab checkpoint | Extension tab |
| `pause.js` | Enforces stillness, intent, reflection, return/save/open choices | Extension tab |
| `pause.css` | Styles the held-tab checkpoint | Extension tab |
| `popup.html` | Structure of the toolbar window | Extension popup |
| `popup.js` | Draws the timer, counts, queue, and history invitation | Extension popup |
| `dashboard.html` | Labeled spaces for settings and evidence | Extension options tab |
| `dashboard.js` | Draws evidence and saves settings | Extension options tab |
| `ui.css` | Shared popup/dashboard styles | Extension pages |
| `history.css` | Optional-history-specific styles | Popup/dashboard |
| `icon.svg` | Vector source artwork | Project asset |

## Why `manifest.json` has no comments

JSON does not support comments. Adding `//` or `/* ... */` would make the
extension invalid, so its fields are explained here:

| Field | Meaning |
|---|---|
| `manifest_version: 3` | Uses the service-worker extension architecture |
| `permissions` | Core storage, tabs, and alarms capabilities |
| `optional_permissions: history` | History is requested only after an explicit click |
| `host_permissions: <all_urls>` | Lets `content.js` observe ordinary websites; this is intentionally broad and deserves scrutiny |
| `background.service_worker` | Names the invisible coordinator |
| `action.default_popup` | Names the toolbar page |
| `options_page` | Names the full dashboard |
| `content_scripts` | Injects the page observer and its styles |
| `run_at: document_idle` | Waits until the page is mostly constructed |
| `all_frames: false` | Watches only the main page, not every embedded iframe |

Browser-internal pages such as `chrome://extensions` cannot run content scripts.

## How the languages connect

HTML supplies structure, JavaScript supplies behavior, and CSS supplies
appearance.

- `id="todayLinkedVisits"` is a unique HTML connection point.
- `getElement("todayLinkedVisits")` finds that point in JavaScript.
- `.behavior-summary` is a reusable HTML class styled by CSS.
- `#behavyour-intent-overlay` is a unique injected element styled by CSS.

Treat HTML ids, message types, storage keys, and metric names as cross-file
contracts. Renaming one side without the other breaks the connection.

## JavaScript that may look “expert”

| Syntax or pattern | What it means here |
|---|---|
| `async` / `await` | Wait for a browser request without freezing the page |
| `() => {}` | Short spelling for a function |
| `` `Hello ${name}` `` | Insert a value into a string |
| `value?.property` | Optional chaining: missing values return `undefined` instead of crashing |
| `value ?? fallback` | Use the fallback only when the first value is missing, not when it is valid `false` |
| `{ ...old, newValue }` | Object spread: copy an object, then replace selected fields |
| `[first] = array` | Destructuring: name an array position |
| `.map(...)` | Turn every array item into another item |
| `.filter(...)` | Keep items that satisfy a rule |
| `.some(...)` | Ask whether at least one item satisfies a rule |
| `Set` | A collection with no duplicates; used for domains and word lists |
| `Map` | A key/value collection; used for transient history calculations |
| `Promise.all(...)` | Run one bounded group of independent history reads together |
| `try` / `catch` | Attempt a fallible browser/URL operation and handle failure |
| IIFE: `(() => { ... })()` | Runs `content.js` immediately while hiding its variables from the webpage |
| Closure | An inner function remembers surrounding values; the reset timer remembers the overlay and prior styles |
| Debounce | Restart a short timer until input settles; used for movement evaluation and settings autosave |
| Capture listener | Observe an event on its way down the page tree; needed for nested scrolling and site controls |
| Promise queue | Serialize read/change/write storage updates so two events do not overwrite each other |
| `return true` in `onMessage` | Chrome plumbing that keeps the asynchronous response channel open |

CSS has a few similarly deliberate constructs:

- `:root` variables give colors readable names.
- `grid-template-columns` defines layout columns.
- `@media` replaces layouts on small screens.
- `.popup .switch:disabled` is a more specific selector than `.switch`.
- `.hidden { display: none !important; }` intentionally guarantees that a
  hidden element stays hidden despite another display rule.

## Message contracts

`background.js` has one `handleMessage` switch. This is the best place to audit
what one extension surface can ask another to do.

| Message | Sender | Meaning |
|---|---|---|
| `getContentSettings` | `content.js` | Return page-observer settings, current category, and any unanswered same-tab feed challenge |
| `linkDeparture` | `content.js` | Remember a destination domain for up to 15 seconds |
| `pageArrival` | `content.js` | Continue/reset the live hyperlink trail and possibly create a checkpoint |
| `behavior` | `content.js` | Record one approved aggregate mouse/click/scroll metric |
| `recordIntent` | `content.js` | Attach user-authored intent to the exact triggering event |
| `recordDriftReflection` | `content.js` | Validate and save both feed-drift answers only after 50 combined words |
| `getState` | popup/dashboard | Return full local extension state plus current category/permission status |
| `pause` / `resume` | popup | Turn the whole extension off/on; `pause` is refused during an active tab cooldown |
| `getPauseContext` | `pause.js` | Fetch one queued destination without putting its URL in the page address |
| `returnToTask` | `pause.js` | Resolve a held tab by returning to the prior tab |
| `saveForLater` | `pause.js` | Keep a queued destination for later review |
| `beginIntentionalOpen` | `pause.js` | Validate intent and begin the reflection delay |
| `completeIntentionalOpen` | `pause.js` | Open exactly one validated destination after the delay |
| `reviewPendingTab` | popup | Reopen/focus the oldest held destination's checkpoint |
| `enableHistoryInsights` | popup/dashboard | Turn optional analysis on and run it |
| `disableHistoryInsights` | dashboard | Turn it off and clear derived history results |
| `analyzeHistory` | dashboard/alarm | Rebuild history evidence now |

Paused-tab actions also verify that their sender is really `pause.html`. A
normal website cannot ask the service worker to release an arbitrary queued URL.

## Durable storage at a glance

The `DEFAULTS` object near the top of `background.js` is the storage schema.
Important groups are:

- User settings: cooldown, coach switches, thresholds, allowed sites, and
  category corrections.
- Tab protection: `lockUntil`, `pendingTabs`, and recent tab attempts.
- Live, short-lived context: active tab snapshots, mouse signal timestamps, and
  domain-only `navigationTrails`.
- Evidence: daily/lifetime `stats` and up to 30 activity sessions.
- Optional history output: aggregate candidates, learned categories, navigation
  continuity, and partial link-trail summaries.

One item intentionally sits outside `DEFAULTS`: an unanswered feed challenge is
held in `chrome.storage.session`, keyed by tab id, so it survives a page reload
but not a browser/extension session. It stores no media URL or answer text.

`getState()` merges new totals into older installations, discards an obsolete
recent-URL structure, and expires held destinations older than seven days.

### Main statistic keys

| Key | Meaning |
|---|---|
| `tabsOpened` | Normal new tabs observed while enabled |
| `blockedTabs` | Extra tabs redirected to the safe checkpoint during cooldown |
| `sensationalVisits` | Completed page loads matching an editable category; the old key name remains for storage compatibility |
| `distractionOpens` | New-tab destinations already matching a category |
| `pointerWanders` | Broad mouse-movement count; specific loops/reversals also increment it |
| `pointerLoops` | Movement ended near its starting point |
| `pointerReversals` | Movement repeatedly changed direction |
| `lowValueClicks` | Broad uncertain-click count; blank/repeated clicks also increment it |
| `blankAreaClicks` | Click outside a recognized page control |
| `repeatedClicks` | Same element clicked again within 350 ms |
| `shortDetours` | Categorized tab left within 30 seconds |
| `linkedPageVisits` | Observed link-like arrivals in live 20-minute trails |
| `rabbitHoleCheckpoints` | Live trail crossed the configured depth |
| `sustainedScrolling` | User-driven scroll session crossed all scroll requirements |
| `infiniteFeedCheckpoints` | Ten substantial new images/videos loaded after real scrolling |
| `driftReflectionsCompleted` | Both hard-lock questions were saved with at least 50 combined words |
| `negativeToneSamples` | Optional checkpoint sample met the strict negative-leaning band |
| `toneSampledWords` | Total capped words examined by optional visible-tone samples |
| `negativeToneWordHits` | Words matching the inspectable negative list |
| `positiveToneWordHits` | Words matching the inspectable positive list |
| `intentPromptsCompleted` | In-page intents saved |
| `mouseResetsCompleted` | Hands-off resets completed, regardless of which in-page pattern triggered them |
| `returnedToTask` | Held tabs resolved by going back |
| `savedForLater` | Held destinations deliberately deferred |
| `intentionalOpens` | Held destinations opened after intent and reflection |

## Exact live heuristics to review

### Mouse movement

A burst needs at least 25 sampled pointer moves, 700 pixels of cumulative
movement, more than 2.5 seconds since an observable useful action, and then 1.2
seconds of settling. It becomes:

- a loop when its end is within 140 pixels of its start;
- a reversal pattern after at least eight sharp reversals and 400 pixels; or
- a generic wander otherwise.

Raw points exist only in `content.js` variables and are discarded after the
calculation. Touch, pen, hidden pages, fullscreen, pointer lock, selected text,
and focused form fields are excluded. These are uncertain patterns, not proof
that movement was useless.

### Clicks

- A blank-area signal means no ancestor matched the explicit interactive-control
  selector.
- A repeated-click signal means the exact same DOM element was clicked again
  inside 350 ms.
- Synthetic (script-created) clicks are ignored.

The click continues to the website. One signal shows a small awareness cue;
the configured two-to-five signals inside 90 seconds create the stronger prompt.

### Live hyperlink trail

1. A trusted click on a normal HTTP(S) link sends its destination origin—not
   path or link text—to `background.js`.
2. The destination page reports normal/reload/back-forward navigation plus its
   referrer domain. A single-page-app URL change is confirmed after 900 ms.
3. A matching departure remains usable for 15 seconds. The entire trail expires
   after 20 inactive minutes.
4. Reload, Back/Forward, downloads, and hash-only jumps do not add depth.
5. New tabs can copy the opener's trail. This is best effort because websites
   and browser privacy behavior can remove the opener or referrer.
6. At the configured 5–12 linked-page depth (default 7), an event is recorded
   and the in-page intent/reset checkpoint is requested.

The page is already reached when the checkpoint appears; the extension prevents
the next automatic action rather than destroying the navigation that led there.

### Sustained scrolling

A scroll event counts only within 1.2 seconds of a trusted wheel, touchmove, or
scroll-navigation key. A session resets after 45 quiet seconds or when another
scroll container becomes active. Long pauses contribute at most 1.5 seconds,
so idle time cannot inflate “active” time.

All of these must be true:

- configured one-to-ten minutes of active scrolling (default 2);
- at least twelve scroll bursts;
- at least eight viewport heights downward; and
- either two viewport heights of feed growth, a categorized current page, or
  at least fifteen viewport heights downward.

It records downward/upward screen lengths, active and elapsed time, burst count,
direction changes, and page growth. A prompt can occur at most once per ten
minutes. This is a behavioral checkpoint, not evidence that the person is tired.

### Optional visible-tone estimate

This is off by default and runs only when sustained scrolling already qualifies.
It samples a 3-by-5 grid in the current viewport, takes the nearest normal text
blocks, skips form/editable areas, stops at 6,000 characters and 500 English
words, and compares words with two small `Set` lists near the top of `content.js`.

At least 60 sampled words and four emotional-list matches are required for any
band. “Negative-leaning” further requires at least five negative-list hits and
at least 65% negative hits among positive-plus-negative matches. No raw words
are sent or stored. The method misses context, sarcasm, negation, morphology,
images, video/audio, and nearly every non-English expression; it never creates
an intervention by itself.

### Infinite-feed media hard lock

This guard uses a `MutationObserver`, which is a browser feature that reports
new DOM nodes and selected attribute changes. It does not repeatedly scan the
whole page.

1. Only images/videos added—or given a new `src`, `srcset`, or `poster`—within
   five seconds of trusted scroll input are considered. Responsive `<picture>`
   child sources are mapped back to their displayed `<img>`.
2. A completed image load, video `loadeddata`, or newly played virtualized video
   is counted once per element/source. Source strings exist transiently in two
   `WeakMap`s and a sequence-only `Set` for deduplication; they are never sent or
   stored. A responsive source change is checked again after the next animation
   frame so the previous already-loaded image is not mistaken for the new one.
3. The displayed rectangle must be at least 160×100 pixels, visible, and between
   half a viewport behind and 2.5 viewports ahead.
4. Each mutation callback examines at most 50 media candidates. Small icons,
   hidden preloaders, initial static media, and far-ahead batches are excluded;
   once the cap is reached, later added subtrees are not queried at all.
5. Repeated elements using the same placeholder/source count only once within
   the current sequence; the short-lived source `Set` clears with the sequence.
6. A gap longer than 45 seconds between qualifying items ends that sequence;
   the next media item starts again at one.
7. On item ten, `infiniteFeedCheckpoints` records the image/video split and
   elapsed seconds. More items are ignored while the checkpoint is pending.
8. When the guard switch is on, this checkpoint bypasses the normal ten-minute
   prompt cooldown and opens the hard reflection lock every ten qualifying
   visual loads.

The two required answers are “What did you originally come here to watch or
find?” and “What are you seeing or watching now, and how far has it drifted?”
Both fields must contain a real word and reach at least 50 word-like pieces combined.
`Intl.Segmenter` is the slightly unusual API here: it gives a language-aware
count and prevents punctuation-only chunks from counting as words; a Unicode
letter/number expression is the older-browser fallback. The browser-side
service worker validates this again, so changing the button in page developer
tools is not enough. Each field is capped at 2,000 characters. The answers stay
in the matching local activity event.

While it is unanswered, only the event id, reset length, creation time, and tab
id are held in `chrome.storage.session`. That makes the prompt return after an
ordinary reload or same-tab navigation without creating permanent browsing
data. Resolving it or closing the tab deletes this temporary entry. Browser-level
extension controls remain the humane emergency exit.

#### Manual acceptance test for this lock

1. Reload the unpacked extension and then reload an ordinary feed page.
2. Keep scrolling while ten different, substantial images/videos load; do not
   leave a 45-second gap between qualifying items.
3. Confirm that the overlay appears and the page behind it cannot be clicked or
   scrolled.
4. Confirm that blank fields, fewer than 50 words, or punctuation-only chunks
   leave the button disabled. Each question needs at least one real word.
5. Reload that same tab before answering. The two-question lock should return.
6. Write at least 50 words across both answers. The button should save the text,
   start the hands-off timer, and release only when that timer finishes.
7. Open Activity sessions in the dashboard and verify the image/video counts,
   both saved answers, their word count, and the completed reset.

### In-page intervention

A qualifying checkpoint:

1. covers the page and locks page scrolling;
2. traps keyboard focus inside the dialog while leaving its panel scrollable on
   small screens;
3. requires at least eight typed intent characters;
4. replaces the dialog with a 3–15 second hands-off reset; and
5. restarts that timer after at least four pixels of accumulated movement.

The previous inline overflow styles and keyboard focus are restored afterward.
Ordinary strong in-page prompts share a ten-minute cooldown to avoid harassment.
The infinite-feed hard lock is the deliberate exception: every tenth qualifying
new visual requires the longer two-part, 50-word reflection, followed by the
same hands-off reset.

## Tab-pause enforcement

- The first ordinary new tab starts the configured cooldown.
- During strict cooldown, later tabs are redirected—not deleted—to `pause.html`.
- The destination URL remains in storage behind an opaque queue id.
- A fixed initial five-second stillness check cannot be skipped.
- Return and Save remain available; opening requires at least 12 intent
  characters after cooldown and a progressive 3/5/7/9-second reflection.
- Completing an intentional open restarts the cooldown.
- Toolbar shutdown is disabled and refused while cooldown is active. Chrome's
  own extension-management page remains the unavoidable emergency exit.
- At most 50 destinations are kept for seven days.

Allowed sites and pinned tabs can bypass the new-tab pause according to settings.

## Optional history model

The browser permission request stays directly inside a real button click, as
required by Chrome. Once enabled, the daily alarm and “Analyze now” use a shared
in-flight Promise so two runs cannot overlap.

The v3 analysis:

- searches 30 days with a 2,000-URL safety cap;
- reads visits in batches of 25 and reports failed URLs;
- immediately removes old, non-local (when known), reload, restore-style, and
  frame visits;
- groups nearby pages on one domain into episodes;
- measures 10-second-to-2-minute exits, A→B→A returns within ten minutes,
  repeat checks inside an hour, signal days, and surrounding contexts;
- subtracts cases where a domain was the site returned to;
- suppresses candidates dominated by under-ten-second redirect-like exits; and
- stores exact ids/timestamps only long enough to calculate aggregate output.

Unknown domains automatically join `learnedDistractions` only after strict
multi-day, multi-context evidence. User `neutral` rules and allowed sites always
win. Weaker patterns remain reviewable and have explicit “Treat as distraction”
and “Mark neutral” actions.

Two descriptive additions never block by themselves:

- Navigation Continuity weights rapid cross-domain transitions 55%, short
  A→B→A loops 30%, and domain breadth 15%. A recent-vs-baseline comparison needs
  four recent eligible sessions across three days and five earlier sessions.
- Historical link ancestry follows Chrome's `referringVisitId` only for
  `transition === "link"`, finds partial leaf chains with at least five linked
  edges inside 20 minutes, and retains only aggregate depths and frequently
  appearing domains. Link-depth evidence can make a site visible for review but
  cannot auto-classify it by itself.

History cannot supply tab identity, focus, closing, dwell, scrolling, visible
content, or intent. Parallel tabs and missing referrers make inferred sequence
especially uncertain.

## Privacy and permissions review

| Capability | Why it exists | Persisted result |
|---|---|---|
| Broad website access | Observe trusted pointer/click/link/scroll events and show a modal | Aggregates; domain-only live trails; user-authored intent |
| Tabs | Enforce cooldown and remember prior task context | Counts, held destination URLs, safe session context |
| Storage | Survive service-worker naps; retain long-lived settings/evidence across browser restarts | Local evidence plus a temporary unanswered feed-challenge id |
| Alarms | Run optional history analysis daily | Alarm schedule only |
| History (optional) | Build reviewable navigation patterns and categories | Aggregate domain evidence, never raw visit ids/paths/timestamps |
| Visible tone (optional setting, no new permission) | Add rough context to a qualifying scroll event | Counts and a band; sampled words are discarded |
| Infinite-feed observer | Count newly loaded substantial media after real scrolling | Item totals only; source signatures remain transient in page memory |

History permission removal or browser-history deletion clears derived history
results. Reset Activity clears counts, sessions, intentions, and short-lived
trail/intervention state while preserving settings, held tabs, and optional
history choices. It does not dismiss an unanswered feed lock; after the activity
event is removed, a valid 50-word response still releases the page but has no
event to attach to.

## Decisions and limitations worth challenging

1. Broad page access creates a real trust burden even with local-only code.
2. The built-in category list is small, culturally incomplete, and editable.
3. “Blank area,” “wander,” link depth, and scroll thresholds can all describe
   legitimate work. The UI deliberately reports observations, not guilt.
4. Live link ancestry can miss privacy-stripped referrers and can over-count a
   normal sequence when a referrer is present but no click marker survived.
5. History order combines visits from parallel tabs and therefore cannot prove a
   real task interruption.
6. The 2,000-URL cap bounds work but can make high-volume history partial.
7. The tiny English tone lexicon is cheap and auditable but semantically weak.
8. An ordinary same-tab reload restores an unanswered feed prompt. Closing the
   tab, reloading/disabling the extension itself, or closing the browser remains
   possible. This is deliberate behavioral friction, not security software.
9. There is no validated clinical or productivity score, and the code should
   not grow one without appropriate evidence.

## Deep-review checklist

- Read every constant near the top of `background.js` and `content.js`; verify
  each threshold matches the product promise.
- Search for `chrome.storage.local.set` to see every durable write.
- Search for `chrome.permissions` and `chrome.history` to audit optional access.
- Search for `addActivityToState` and `incrementStoredMetric` to find statistics.
- Search for `showIntentPrompt` and `sendTabToPausePage` to find enforcement.
- Compare HTML ids with `getElement(...)` in the paired script.
- Inspect `CATEGORIES`, `NEGATIVE_TONE_WORDS`, and `POSITIVE_TONE_WORDS`; these are
  subjective defaults and intentionally easy to edit.
- Test allow-listed/pinned sites, denied/revoked history permission, history
  deletion, empty referrers, a target-blank link, SPA navigation, nested feeds,
  long documents, form editing, and extension reloads.
- Keep all labels descriptive. Do not turn a proxy into a diagnosis.

After changing files, reload the unpacked extension in `chrome://extensions` or
`edge://extensions`, then reload existing website tabs so their content script
is replaced.
