# Behavyour — Attention Guard

Behavyour is a local-first Chrome/Edge extension for noticing and interrupting
automatic tab-opening and mouse habits. It does not grade the person. It turns
observable browser patterns into a pause, a specific next choice, and a readable
record of what happened.

The source is intentionally formatted and commented for a reader who is new to
JavaScript, HTML, CSS, and browser extensions. Start with
[REVIEW_GUIDE.md](REVIEW_GUIDE.md) for the file map, data contracts, thresholds,
and a glossary of the less obvious code.

## What the extension now does

### 1. Creates real space between new tabs

- Opening a normal tab starts the configured cooldown.
- Another tab attempted during that cooldown is redirected to Behavyour's own
  checkpoint page; its destination is saved locally instead of being destroyed.
- The checkpoint begins with a five-second hands-off-mouse reset. Accumulated
  movement restarts it, while tiny sensor jitter is tolerated.
- The user can return to the prior task, keep the destination for later, or wait
  for the cooldown and open exactly that one destination deliberately.
- An intentional opening requires a written purpose (at least 12 characters),
  followed by a 3–9 second reflection period that grows with repeated attempts.
- There is no one-click “unlock” during a cooldown. Browser extension settings
  remain the unavoidable emergency exit.
- Up to 50 paused destinations are retained on-device for seven days and can be
  reviewed from the toolbar popup.

### 2. Recognizes several mouse/click patterns

The webpage observer distinguishes:

- A substantial movement burst that does not land on an observable action.
- A loop that ends close to where it started.
- Repeated back-and-forth direction changes.
- A click in an area with no recognized interactive control.
- A very quick second click on the same element.

Click classifications are uncertain heuristics, so they never hard-block by
themselves. The observer ignores touch/pen input, form editing, text selection,
dragging, fullscreen, pointer lock, and hidden pages to reduce false positives.

The first signal shows a small, non-judgmental awareness cue. When the configured
number of signals occurs within 90 seconds, the user is asked to write what they
were trying to do and then keep the mouse still for 3–15 seconds. The blocking
prompt is rate-limited to once per ten minutes.

### 3. Interrupts hyperlink rabbit holes and sustained scrolling

- On ordinary pages, a real hyperlink click leaves a short-lived domain-only
  departure marker. The next page's referrer supplies a second best-effort clue.
- A chain stays active for 20 minutes. Reload, Back/Forward, downloads, and
  same-document anchor jumps do not deepen it.
- The default checkpoint appears after seven successive linked pages (editable
  from five to twelve). It freezes the underlying page, requires a written
  intent, and then requires the same hands-off reset as the mouse coach.
- Links opened into another tab inherit the source trail when Chrome preserves
  the opener relationship. Missing referrers can still hide a link, so the
  dashboard calls these observed trails rather than complete journeys.
- Sustained scrolling requires active user scroll input, enough active time,
  at least twelve distinct bursts, at least eight screens downward, and either
  substantial page growth, a categorized page, or fifteen screens downward.
  This avoids treating one long document or programmatic scrolling as proof of
  an automatic habit loop.
- The scroll threshold is editable from one to ten active minutes. With its
  pause enabled, reaching it freezes the page and invokes the
  intent-plus-hands-off checkpoint. The event may be worth noticing, but the
  extension does not infer that the user is tired.
- A separate infinite-feed guard watches only media added or given a new source
  after real scrolling, including responsive `<picture>` sources. It ignores
  small/hidden/far-away visuals and caps each
  DOM-mutation scan. Repeated copies of one placeholder source count once per
  sequence. A gap of more than 45 seconds between qualifying items starts a
  fresh sequence, so unrelated loads hours apart do not add up. On the tenth
  substantial image or video, it hard-locks the feed and asks two questions:
  what the user originally came to watch/find, and where the feed has drifted.
  Both must be answered with at least 50 words combined before the hands-off
  reset can release the page.
- An unanswered feed checkpoint is kept in browser-session storage and returns
  after an ordinary reload or same-tab navigation. Closing the tab, turning off
  that coach, or disabling the extension remains a deliberate emergency exit.
- The media hard lock is enabled by default and is not suppressed by the normal
  ten-minute prompt cooldown. Turning its setting off keeps aggregate evidence
  but removes this hard intervention.
- An optional screen-tone estimate is **off by default**. At a scroll checkpoint
  only, it samples up to 500 visible English words across fifteen viewport
  points, uses two small inspectable word lists, immediately discards the words,
  and retains only aggregate counts and a rough tone band. Tone never blocks by
  itself.

### 4. Shows what actually happened

The dashboard uses counts instead of an invented attention score. It includes:

- Seven local-calendar days of mouse patterns, tab shifts, link/scroll
  checkpoints, resets, returns, saved tabs, and intentional openings.
- Today's linked arrivals, deep-trail checkpoints, sustained-scroll checkpoints,
  ten-visual feed checkpoints, optional negative-list matches per sampled word,
  and negative-leaning samples.
- Lifetime recovery actions.
- Activity sessions separated by 20 quiet minutes.
- A plain-English timeline for each session: movement distance, sampled moves,
  reversals, approximate page region, repeat-click timing, tab decisions, page
  category, feed image/video counts, and any intent or 50-word drift reflection
  the user deliberately saved.

Exact pointer coordinates and sampled webpage words are not retained.

### 5. Keeps classifications editable

Small built-in lists cover common video, news, social, and entertainment sites.
Users can add an allowed domain, assign their own category, or mark a site
`neutral`. A user rule always wins over built-in and history-derived labels.

### 6. Learns recurring detours from optional history

History access is not requested at installation. The invitation appears in the
initial popup, and the browser permission prompt occurs only after the user
chooses to enable it.

When enabled, the v3 learner examines the last 30 days locally:

- It ignores synced-device visits (when Chrome exposes locality), reloads,
  session-restore-style visits, and subframe noise.
- It groups nearby pages on the same domain into one website episode.
- It follows Chrome's available referring-visit ids to reconstruct partial
  hyperlink ancestry, and shows aggregate chains of at least five successive
  links inside 20 minutes. Frequently appearing deeper domains become supporting
  evidence for review, but link depth alone cannot auto-classify a site.
- It looks for short `A → B → A` returns, 10-second-to-2-minute context episodes,
  repeat checks within an hour, recurrence across days, and surrounding-domain
  breadth.
- It subtracts occasions where a domain was the context returned to, preventing
  the resumed work site from looking like the detour.
- Near-instant transitions are treated as possible login/payment redirect noise.
- Unknown sites are learned automatically only after strict, multi-day,
  multi-context evidence. Weaker evidence remains visible as “watching only.”
- The dashboard explains the raw counts and lets the user treat a suggestion as
  a distraction or mark it neutral.

The same timestamps also produce a **Navigation Continuity** estimate from
rapid cross-domain movement, short return loops, and domain breadth. It compares
the recent seven-day median with an earlier baseline only when enough sessions
exist. It is descriptive and never used to block anything.

History cannot reveal which tab was focused, true reading time, scrolling, or
intent. Referring-visit ancestry may also be incomplete because of parallel
tabs, missing referrers, or the analysis cap. Consequently, all history output
is labeled as possible navigation evidence—not measured attention or a
diagnosis. Exact visit paths, referrer IDs, reconstructed chains, and timestamps
are discarded after aggregation; only domains, counts, percentages, and the
last-seen local day are retained.

## Install locally

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Pin **Behavyour** to the toolbar.
5. Open **Insights & settings** to choose the tab cooldown, mouse/link/scroll/feed
   checkpoints, allowed sites, and category corrections.

After editing extension files, press **Reload** on the extensions page. Existing
ordinary tabs may also need one reload before the updated content script runs.

## Privacy boundary

Long-lived settings, aggregates, session details, queued destinations, saved
intentions, and optional history-derived results live in
`chrome.storage.local`. A live link trail retains only recent domains,
timestamps, and depth. If screen tone is on, sampled words exist briefly in
`content.js` memory and are discarded before its aggregate result is sent.
There is no server, account, analytics SDK, advertising code, or remote script.

An unanswered feed-checkpoint id is temporarily kept in
`chrome.storage.session` so a page reload cannot erase the lock. It contains no
answer text or media address and disappears when resolved, the tab closes, or
the browser/extension session ends.

Behavyour needs broad website access to observe pointer, click, link, and scroll
events, and the `tabs` permission to enforce the tab pause. The optional
`history` permission can
be revoked from the dashboard; revocation or history deletion clears derived
history results. Browser-internal pages cannot run the mouse observer.

These heuristics can be wrong. The extension is a behavioral aid, not medical,
psychological, or productivity assessment software.
