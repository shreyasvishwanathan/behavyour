# Reviewing Behavyour

Behavyour uses plain JavaScript, HTML, and CSS, with no runtime dependencies or
build step. Start with [README.md](README.md) for the product and installation.

## Files and flow

| Files | Responsibility |
|---|---|
| `manifest.json` | Extension entry points and permissions. Content scripts run in the main frame of ordinary websites. |
| `content.js`, `content.css` | Observe page activity, retain temporary measurements, and show in-page reminders and resets. |
| `background.js` | Coordinate storage, categories, tab pauses, live link trails, history analysis, and messages. |
| `popup.html`, `popup.js` | Toolbar state, cooldown, waiting tabs, and optional history invitation. |
| `pause.html`, `pause.js`, `pause.css` | Held-tab stillness, return/save choices, intent, and deliberate opening. |
| `dashboard.html`, `dashboard.js` | Overview, filtered activity log, website evidence, and explicit settings save. |
| `ui.css` | Shared popup and dashboard styles, including history results. |
| `tests/*.test.js` | Checks using Node's built-in test runner and mocked browser/page APIs. |
| `icon.svg` | Source artwork. |

```text
Webpage events → content.js → aggregate messages → background.js
                                                    ↕
                                           extension storage
                                                    ↕
                                       popup / pause / dashboard

Optional Chrome history → background.js → domain-level evidence
```

Chrome may stop the service worker between events. Durable state belongs in
storage, while Promise queues serialize overlapping work during a worker's
lifetime. DOM IDs, message types, storage keys, and metric names are contracts
across these files; update both sides when changing one.

## Storage and privacy

`DEFAULTS` and `EMPTY_TOTALS` in `background.js` define the existing storage
shape. `getState()` merges missing fields for older installations without
resetting their settings or statistics.

| Location | What it holds |
|---|---|
| `chrome.storage.local` settings | Coach switches, thresholds, allowed domains, category corrections, and history preference. |
| Local tab state | Cooldown, up to 50 queued destinations retained for seven days, and active/prior tab snapshots. Queued URLs and tab snapshots can include full URLs and page titles. |
| Local activity | Daily/lifetime counters; up to 30 sessions with 60 recent events each. Events include domains, page titles, aggregate facts, and user-written intentions/reflections. |
| Local live context | Recent signal times and domain-only navigation trails, pruned after 20 inactive minutes. |
| Local history results | Domain summaries, counts, percentages, and last-seen calendar days. No raw visit paths, IDs, chains, or exact visit times. |
| `chrome.storage.session` | Unanswered feed checkpoints keyed by tab ID: event ID, reset duration, and creation time. No answer text or media address. Survives worker restarts and page reloads, clears with the browser/extension session. |
| Page memory | Pointer samples, temporary media-source identifiers, and optional visible-word samples. Never sent or persisted as raw data. |

Broad website access supports observation and in-page prompts. `tabs` supports
tab protection, `storage` retains state, and `alarms` schedules optional history
analysis. Browser-internal pages cannot run the observer. There are no network
uploads or external scripts.

Deleting activity clears counters, sessions, saved intentions, and live
trail/intervention state while preserving settings, queued tabs, and history
choices/results. It does not clear unanswered feed prompts: a valid response
still releases the page even when its old activity event no longer exists.
History deletion clears derived results; permission revocation also disables
the history feature.

## Invariants to preserve

- **Observations remain descriptive.** Mouse and click heuristics can describe
  useful work. History timestamps do not measure focus or reading time. The
  dashboard shows counts and navigation bands, without a personal score.
- **Avoid double counting.** `pointerLoops` and `pointerReversals` already add
  to `pointerWanders`; `blankAreaClicks` and `repeatedClicks` already add to
  `lowValueClicks`. Use aggregate totals once when grouping dashboard metrics.
  Retried intent/reflection messages must count completion only once.
- **Keep dates local.** Daily keys use local calendar parts; UTC conversion can
  put late-night activity on the wrong day. Sessions group events separated by
  fewer than 20 quiet minutes and are not focus timers.
- **Validate messages in the worker.** `handleMessage` accepts only approved
  behavior metrics and positive integer counts. Pause actions verify their
  extension-page sender and attached tab. Observer settings are returned through
  `getContentSettings`, which excludes the dashboard's full activity/history.
- **Enforce opening in the worker.** A held destination is addressed by an
  opaque queue ID. Opening requires the original cooldown to finish, an intent
  of at least 12 characters, and a 3–9 second reflection delay. Successful
  opening restarts the cooldown. Closing a held tab saves it; explicit Return
  removes it. Allowed sites bypass an active pause without extending it.
- **Respect independent switches.** The master switch stops tracking and
  enforcement. Individual coach switches disable their interventions while
  retaining observations. Ordinary intent prompts share a ten-minute cooldown;
  enabled feed checkpoints deliberately bypass it.
- **Preserve accessibility and page state.** Blocking overlays contain keyboard
  focus, leave their own content scrollable, and restore page scrolling/focus
  afterward. Hands-off reset timing tolerates tiny pointer jitter.
- **Keep feed recovery reliable.** Ten qualifying new images/videos after real
  scrolling trigger a checkpoint. Both answers need a real word and at least
  50 combined words; validate again in the worker using language-aware counting.
  The prompt survives same-tab reload/navigation. A valid response releases it
  even if its bounded activity event was pruned.

The constants near the top of `content.js` and `background.js` are the source
of truth for exact thresholds. Keep intentional exclusions for touch/pen,
editing, selection, hidden pages, fullscreen, and pointer lock. Reload and Back
must not deepen live link trails. Media checks must remain bounded and avoid
counting duplicate sources, hidden preloaders, or static initial images.

## Optional analysis

History permission requests must originate from a user action. Analysis needs
both permission and the setting, shares an in-flight run, and rechecks current
choices before saving. It examines 30 days with a 2,000-URL cap and batches of
25 visit reads, excluding known remote-device, reload, restore, and frame noise.

Nearby pages on one domain form an episode. Short returns, repeated checks,
multiple days, and surrounding contexts provide evidence; redirects and sites
being returned to must not be mislabeled as detours. Automatic learning needs
strict repeated evidence. User rules override learned and built-in categories;
allowed and neutral sites are excluded from learning. Partial hyperlink ancestry
may help rank a candidate but cannot qualify it for learning alone.

Navigation continuity and historical link trails are descriptive summaries,
never blocking inputs. Parallel tabs, missing referrers, and capped history
make the evidence incomplete. Optional page-tone sampling uses small English
word lists, discards the words, and never triggers a prompt on its own.

## Checks

```sh
node --test tests/*.test.js
```

The checks use mocked APIs: they cover worker data/decision contracts, page
observers and prompts, and popup/pause timing and retry behavior. They do not
prove real browser event ordering, rendering, or compatibility.

After reloading the unpacked extension and existing website tabs, check:

1. **Dashboard:** empty and populated activity, the four views, local dates,
   activity filters, readable counts, and settings that apply after Save.
2. **Tab flow:** cooldown, allowed/pinned bypass, Return, Save, later review,
   intentional opening, and a newer cooldown arriving during reflection.
3. **Page prompts:** keyboard-only operation, form editing, nested scroll areas,
   target-blank/SPA links, and hands-off reset without a focus or scroll trap
   after completion.
4. **Feed recovery:** scroll through ten qualifying media loads, reload before
   answering, reject short/punctuation-only responses, then save two answers
   with 50 combined words and finish the reset. Check the saved activity entry.
5. **Privacy controls:** denied/revoked history permission, deleted history,
   feature switches on an already-open page, and activity deletion while a feed
   prompt is unanswered.
