# ADR 0024: Stopwatch — Multiple Named Local Solo Sessions

## Status

Decided.

## Context

ADR 0018 (`0018-stopwatch-multi-timer-parity-no-go.md`) decided against
pursuing multi-timer suite parity: no parallel named on-screen timers, no
floating picture-in-picture overlay, no home-screen widgets. The rationale
was surface-contract mismatch, the maintenance cost of widgets/PiP, and the
absence of a pre-launch demand signal.

ADR 0018 explicitly left a door open:

> "If post-launch user feedback provides a clear demand signal for multiple
> simultaneous timers, a future ADR should revisit this decision — with usage
> data as the primary input."

This milestone introduces a **narrower** capability that is architecturally
distinct from what ADR 0018 rejected: a device can hold multiple independent,
named, switchable **local solo stopwatch/timer sessions**, created and
switched one-at-a-time by the user. This is not simultaneous multi-timer
display; it is a list of saved local states the user navigates between.

The need arises from common training practice: a cyclist may want a separate
"track session" stopwatch and a "strength" countdown timer, each with its own
lap history, without having to reset and lose one to use the other. Both
sessions live only on the device; neither involves the Supabase backend, a
shared code, or any participant concept.

## Decision

Allow a **bounded list of named local solo sessions** on the stopwatch
surface, with the following constraints:

### What is allowed

1. **Session list / switcher UI.** The user can create, name, and delete local
   sessions. A list screen (or modal) shows all saved sessions; tapping one
   makes it the active session. Only one session is visible/active at a time —
   there is no split-screen or simultaneous display.

2. **Per-session state.** Each local solo session persists its own stopwatch
   elapsed time, running/paused/stopped status, lap list, and (if applicable)
   countdown configuration. State is stored in device-local storage only
   (AsyncStorage on native, `localStorage`/IndexedDB on web).

3. **Stopwatch and/or countdown.** Each session may be a plain stopwatch, a
   countdown timer, or a repeating countdown — whatever the existing solo
   surface supports. Multi-session does not add new timer modes; it just
   allows multiple instances of the existing modes.

4. **Session cap: 10 sessions per device.** See rationale below. The UI must
   enforce this cap and communicate it clearly to the user (e.g., disable
   "New session" when the cap is reached, with an explanatory tooltip).

### What remains explicitly rejected (per ADR 0018)

- **Simultaneous on-screen timers.** Two or more sessions are never displayed
  side-by-side or in a split view.
- **Floating / picture-in-picture timers.** No foreground service, no system
  overlay window.
- **Home-screen / lock-screen widgets.** No `AppWidgetProvider`, no
  `WidgetKit` extension.
- **Shared multi-session.** Local sessions are device-private. They are not
  joinable by code and do not appear in the server-side casual session model
  (ADR 0017).

### Session count cap: 10

**Rationale:** AsyncStorage on Android is unbounded, but each local session
stores a lap array that grows with every tap. A cap of 10 sessions limits the
worst-case local storage to roughly 10 × (session metadata + lap array). At
a realistic maximum of ~500 laps per session, this is well under 1 MB of
serialized JSON on any modern device.

Ten sessions also covers the practical range of a serious training athlete
(e.g., one session per discipline/day-of-week), without encouraging indefinite
accumulation that can degrade AsyncStorage read/write performance over time.
If post-launch feedback shows the cap is too low, a future ADR can raise it
with storage profiling data.

## Consequences

- **No backend changes.** Local solo sessions are never written to Supabase.
  No migration, no RLS policy, no new RPC.
- **No cross-surface contract change.** The shared/casual session model
  (ADR 0017), the results permalink (ADR 0022), and the live view (ADR 0023)
  are unaffected. AGENTS.md's stopwatch surface description ("Creator owns
  session (auth.uid()); participants join by code/link… event log is truth;
  no roster") refers to shared sessions and remains accurate; local solo
  sessions have always been out of that model.
- **AGENTS.md stopwatch row is unchanged.** The distinction between local
  solo and shared sessions was already implicit; no clarification is needed.
- ADR 0018 is **narrowly superseded** for the specific case of a switchable
  local session list. All of ADR 0018's other rejections remain in force.
  See the cross-reference note added to ADR 0018.
- Implementation issues for the session-list UI and storage layer reference
  this ADR.
