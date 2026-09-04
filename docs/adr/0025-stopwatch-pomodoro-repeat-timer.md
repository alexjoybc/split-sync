# ADR 0025: Stopwatch — Repeat/Pomodoro Countdown Timer Mode

## Status

Decided.

## Context

ADR 0018 (`0018-stopwatch-multi-timer-parity-no-go.md`) decided against
pursuing multi-timer suite parity and explicitly deferred auto-repeat/interval
(HIIT/Pomodoro) loops, noting:

> "No demand signal yet. The casual stopwatch is pre-launch. Investing in
> multi-timer complexity before any real usage data would be premature
> optimization against a hypothetical audience segment."

ADR 0018 left a door open:

> "If post-launch user feedback provides a clear demand signal for multiple
> simultaneous timers, a future ADR should revisit this decision — with usage
> data as the primary input."

Since launch, user feedback has specifically requested repeat/Pomodoro-style
timers for training use: structured work/rest interval cycles where a
countdown rings at the end of each work block, pauses for a configurable rest
delay, then automatically starts the next repetition. Common use cases include
cycling intervals (e.g., 4 × 4-minute hard efforts with 2-minute recovery),
Pomodoro-style focus blocks (25 min work / 5 min rest), and strength training
rest timers. This is a **single-session, sequential** experience — entirely
different from the simultaneous multi-timer display that ADR 0018 rejected.

ADR 0024 (`0024-stopwatch-multiple-local-solo-sessions.md`) already noted
that each session may run "a repeating countdown — whatever the existing solo
surface supports." This ADR formalises the repeat mode's configuration
contract and explicitly unblocks its implementation.

## Decision

Allow an optional **repeat mode** on a single active countdown session, with
the following constraints:

### What is allowed

1. **Repeat mode configuration.** When creating or editing a countdown, the
   user may enable repeat mode and supply:
   - **Work duration** — the countdown duration for each active interval
     (inherits the session's existing countdown value by default).
   - **Rest/delay duration** — a brief countdown that fires automatically
     after each work interval rings, before the next repetition starts.
     Minimum 0 s (no rest), no fixed maximum.
   - **Repeat count** — the number of work+rest cycles to run. May be set to
     a finite value (1–99) or to **infinite** (loops until the user stops
     manually).

2. **Single visible session.** Repeat mode runs entirely within one active
   countdown session. There is no second timer on screen; the display
   transitions sequentially through work → rest → work → rest. The phase
   label (e.g., "Work" / "Rest") and the current repetition number are shown
   alongside the running time so the user can orient themselves at a glance.

3. **Audible and haptic rings.** Each phase transition (work end, rest end)
   fires an audible ring and a haptic pulse, identical to the existing
   countdown-complete behaviour. No new notification or OS-level alert
   mechanism is introduced.

4. **State persistence.** The current phase, remaining time, and repetition
   counter are persisted in device-local storage (AsyncStorage on native,
   `localStorage`/IndexedDB on web) so that a background/kill cycle during
   an interval can recover the correct phase on next foreground.

5. **Works within the ADR 0024 session model.** Repeat mode is a property of
   a local solo session's countdown configuration. All ADR 0024 constraints
   apply: the session is device-private, not shared via code, and counts
   toward the 10-session cap.

### What remains explicitly rejected (per ADR 0018)

- **Simultaneous on-screen timers.** A repeat session never shows two or more
  timers side-by-side. Work and rest phases are shown one at a time,
  sequentially.
- **Floating / picture-in-picture timers.** No foreground service overlay, no
  system overlay window.
- **Home-screen / lock-screen widgets.** No `AppWidgetProvider`, no
  `WidgetKit` extension.
- **Shared repeat sessions.** Repeat configuration is local-only. It is not
  exposed in the shared/casual session model (ADR 0017) and participants
  joining by code cannot trigger or view interval state.

### Non-goals for this ADR

- **HIIT library / preset templates.** Users configure durations manually.
  Preset programmes (e.g., Tabata 20/10, Pomodoro 25/5) are out of scope and
  may be addressed in a separate issue with usage evidence.
- **Per-repetition variation.** All work intervals share one work duration;
  all rest intervals share one rest duration. Pyramid or ladder-style varying
  intervals are out of scope.
- **Cross-device sync of interval configuration.** Configuration lives in
  local storage only. No Supabase table, column, or RPC is added by this ADR.

## Consequences

- **No backend changes.** Repeat mode configuration is stored in device-local
  storage. No migration, no RLS policy, no new RPC.
- **No cross-surface contract change.** The shared/casual session model
  (ADR 0017), the results permalink (ADR 0022), and the live view (ADR 0023)
  are unaffected.
- **AGENTS.md stopwatch surface description is unchanged.** Repeat mode is an
  extension of the existing single countdown; it does not alter the surface
  contract ("event log is truth; no roster").
- ADR 0018 is **narrowly amended** to allow repeat/Pomodoro mode on a single
  active countdown session. All other ADR 0018 rejections remain in force.
  See the cross-reference note added to ADR 0018.
- Implementation issues for the repeat-mode UI and storage schema reference
  this ADR.
