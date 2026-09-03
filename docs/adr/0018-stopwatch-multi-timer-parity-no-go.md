# ADR 0018: Stopwatch — Multi-Timer Suite Parity (No-Go for Current Milestone)

## Status

Decided.

## Context

The SplitSync casual stopwatch surface (defined in ADR 0017 and AGENTS.md) is a **shared stopwatch with anonymous participants and no roster**. Its competitive differentiators are shared sessions, trust (no ads, no paywalls), and race-sports positioning — not general-purpose timer utility.

Gap analysis against the incumbent (Hybrid Stopwatch & Timer, 10M+ downloads) identified the following headline features absent from SplitSync's stopwatch:

1. **Multiple named, color-coded countdown timers** running simultaneously.
2. **Auto-repeat / interval loops** (e.g., work/rest HIIT cycles).
3. **Floating timers** — picture-in-picture overlay persisting across apps.
4. **Home-screen widgets** — glanceable elapsed/countdown display without opening the app.

Issue #232 already covers a **single repeating countdown** (auto-resets to original value on completion, survives background/kill). The question this ADR addresses is: should SplitSync pursue **full multi-timer suite parity** beyond that single countdown?

## Decision

**No — do not pursue multi-timer suite parity in this milestone.**

The single repeating countdown from #232 is the extent of countdown investment for the current release cycle.

### Rationale

1. **Surface contract mismatch.** AGENTS.md defines the casual stopwatch as a "shared stopwatch + single countdown" surface — not a general-purpose timer app. Multiple simultaneous named timers require a list-based UX paradigm that is categorically different from a one-tap shared stopwatch. Adopting it would redefine the surface rather than extend it.

2. **Competing on the incumbent's home turf.** Hybrid Stopwatch & Timer's multi-timer layout is mature and battle-tested. Matching it feature-for-feature invites a direct comparison in which SplitSync starts from behind, with no structural advantage (SplitSync's advantage is shared sessions, not timer count).

3. **Single countdown covers the primary interval use case.** The HIIT/training scenario — most often cited as the reason users want repeating timers — is satisfied by a single countdown that auto-resets (#232). The marginal value of a second or third simultaneous named countdown in a shared-session context is low.

4. **Android widget maintenance burden.** Home-screen widgets on Android require a dedicated `AppWidgetProvider`, a `RemoteViews` layout, and periodic `AlarmManager`/`WorkManager` updates. Floating timers require a foreground service with a persistent notification. Both incur sustained maintenance cost (OS behavior changes per Android version, background execution restrictions) with no clear top-of-funnel benefit for the SplitSync audience (grassroots race-sports participants, not fitness app power users).

5. **No demand signal yet.** The casual stopwatch is pre-launch. Investing in multi-timer complexity before any real usage data would be premature optimization against a hypothetical audience segment.

## Consequences

- Multi-timer suite implementation issues **will not be created** from this milestone. No parallel named timers, no floating-timer PiP, no home-screen widget.
- Issue #232 (single repeating countdown) **proceeds unblocked** as the sole countdown investment.
- If post-launch user feedback provides a clear demand signal for multiple simultaneous timers, a future ADR should revisit this decision — with usage data as the primary input.
- The casual stopwatch surface contract in AGENTS.md remains: shared sessions, event-log as truth, single stopwatch + single countdown.

## Amendment — ADR 0024

**ADR 0024 (`0024-stopwatch-multiple-local-solo-sessions.md`) narrowly
supersedes this ADR for one specific capability:** a device-local list of
named, switchable solo sessions (one active at a time, capped at 10). All
other rejections in this ADR — simultaneous on-screen timers, floating
picture-in-picture, home-screen widgets — remain in force.
