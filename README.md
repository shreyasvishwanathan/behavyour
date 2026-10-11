# Behavyour

A Chrome and Edge extension that creates a little space between a browsing
impulse and your next action. It notices mouse patterns, extra tabs, long link
trails, and scrolling, then helps you pause and choose what to do next.

## Why it exists

This project is heavily built with AI, but its idea comes from personal human
frustration. Living in India, I see how easily shorts, social media, and endless
sensational content become automatic consumption. The well-being tools I tried
often intervened after I had already decided to keep consuming.

Behavyour explores an earlier moment: the wandering mouse, repeated click, or
next tab. The aim is to make those moments easier to notice and reflect on.
Its observations can be wrong; they do not measure attention or prove a visit
was wasted. Human review of the code and feedback from actual use matter here.

## Install or reload

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**, choose **Load unpacked**, and select this folder.
3. Pin Behavyour to the toolbar. Open its popup, then **Open dashboard & settings**.
4. After editing files, click **Reload** on the extensions page, then reload
   existing website tabs to replace their content script.

There is no build step or dependency installation.

## Use the dashboard

| View | What it helps you do |
|---|---|
| **Overview** | Read today's takeaway, compare four groups of activity, and see what you chose to do next. The week table shows daily counts. |
| **Activity log** | Review today, the last seven days, or all saved sessions, including intentions and feed reflections you wrote. |
| **Website patterns** | Optionally enable local history analysis, review recurring detours, and correct a site's category. Navigation changes and link evidence appear under the details. |
| **Settings** | Adjust reminders, allowed sites, and categories, then click **Save settings**. |

A dash in the week table means no activity was recorded that day. Zero means
activity was recorded, but none of that kind. Counts describe observations and
responses, not minutes spent or an attention score.

The default tab cooldown is three minutes. Extra tabs go to a pause page that
keeps their destinations. You can return to the previous task, save a tab for
later, or wait and open it with a written purpose. The popup lets you review
waiting tabs. Allowed sites and pinned tabs can bypass the pause.

Mouse reminders ask for an intention after repeated signals. Long link trails
and active scrolling can also prompt an intention and a hands-off reset. The
feed guard pauses after ten qualifying new images or videos; it asks two
questions with at least 50 words combined, followed by a hands-off reset.
An unanswered feed pause returns after an ordinary reload.

Each coach has its own setting. Turning a coach off keeps its observed counts;
the toolbar's master switch stops tracking and protection. That switch is
unavailable during an active tab cooldown. Browser extension controls remain
available if you need to disable Behavyour.

## Your data

Everything stays on this device: settings, counts, saved destinations, and
intentions. There is no account, server, analytics service, or remote model.
The activity log keeps up to 30 sessions and 60 recent events per session;
saved destinations expire after seven days.

History access is optional and requested only when you enable it. Analysis
looks at the last 30 days, keeps domain-level evidence, and cannot tell which
tab you were reading or why. Disabling history insights removes that permission
and clears its results. A separate, optional English page-tone estimate is off
by default; sampled words are discarded after counting.

Under **Settings → Your data**, **Delete activity data…** clears activity and
saved intentions after confirmation. Settings, learned history, and saved tabs
remain. An unanswered feed pause still needs a valid response to release it.

## Verify changes

With Node installed, run the checks from this folder:

```sh
node --test tests/*.test.js
```

These use Node's built-in tools and mocked browser APIs. Also reload the
extension and check the changed flow in Chrome or Edge; the tests do not replace
real browser checks. See [REVIEW_GUIDE.md](REVIEW_GUIDE.md) for the file map,
data boundaries, and the checks that matter most.

Please try it, review the source, and suggest changes that make the pauses and
the dashboard more useful to a person.
