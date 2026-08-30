# Play Store Listing — SplitSync Stopwatch

Listing copy for the standalone `org.splitsync.stopwatch` Android app.
Consumed by the Play Store publishing pipeline owned by #214 (stopwatch
release) — see also #220 for the tracker pipeline conventions. Update this
file first; the Play Console listing should always be a copy-paste of what
is here.

Positioning (see #228): the market's top complaint about the dominant
stopwatch apps is ads interrupting timing and expensive weekly
subscriptions. SplitSync Stopwatch leads with the opposite promise — free,
no ads, no subscription, no account for solo use — and differentiates with
shared "Time Together" sessions.

## App title

Max 30 characters.

```
SplitSync Stopwatch
```

## Short description

Max 80 characters. Leads with the free/no-ads promise and mentions shared
"time together" sessions as the differentiator.

```
Free stopwatch, no ads, no account. Share a session and time together, live.
```

## Full description

Max 4000 characters.

```
A stopwatch that just works — and doesn't try to extract money.

SplitSync Stopwatch is completely free. No ads blocking the dial mid-timing. No subscription. No account needed to time solo. Open it and press Start.

SOLO STOPWATCH
• Big, legible dial with hundredths precision
• One-tap lap recording with per-lap and cumulative times
• Best lap automatically highlighted
• Timing anchored to a monotonic clock — stays accurate in the background
• Works fully offline; solo timing sends nothing to any server

TIME TOGETHER — SHARED SESSIONS
The part no ordinary stopwatch does: time the same activity from several phones at once.

• Create a session and share a 6-character code or link
• Friends join with just a display name — no account, no sign-up
• Everyone sees the same server-anchored clock and the same lap splits, live
• Each lap shows who pressed it
• Brief connection drops are fine — devices catch up automatically, laps are never lost

Perfect for training partners splitting duties at the track, coaches timing from both ends of the course, or families timing kids' races together.

THE DEAL
Solo use is anonymous and free forever. Creating a shared session requires a free SplitSync account (so the session has an owner); joining one never does. No ads, no subscription, no upsell.

SplitSync Stopwatch is built by SplitSync, the live classification board for grassroots lap racing (splitsync.org).
```

## Notes for the publisher

- Category: Tools.
- Data safety form: solo use collects nothing; shared sessions store the
  session code, display names, and lap events (see the `casual_sessions`
  schema and ADR 0017). The creator's account email is standard Supabase
  Auth. Declare accordingly — do not claim "no data collected".
- Screenshots: solo dial with laps recorded (best lap highlighted) and a
  shared session with multiple participants in the strip.
- Privacy policy URL: `https://splitsync.org/privacy`.
