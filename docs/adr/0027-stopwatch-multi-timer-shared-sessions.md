# ADR 0027: Stopwatch — Multi-Timer Sessions, Event-Sourced Shared Collaboration, and Table Rename

**Status:** Accepted
**Date:** 2026-09-04
**Issue:** #463 (schema), #468 (documentation)

---

## Supersedes / Cross-references

| ADR | Relationship |
|---|---|
| [0017 — Casual Stopwatch Shared Sessions](0017-casual-stopwatch-shared-sessions.md) | **Superseded.** The `casual_*` table/RPC naming convention, the single-stopwatch-per-session model, and the `stopwatch:<code>` realtime channel are replaced by this ADR. All architectural invariants (security-definer RPCs, event-log as truth, server-anchored T0, broadcast over postgres_changes) are **carried forward unchanged**. |
| [0018 — Multi-Timer Parity No-Go](0018-stopwatch-multi-timer-parity-no-go.md) | **Reversed for the specific case of multiple independently-controlled timer rows within a shared session.** The rejections in ADR 0018 that remain in force are: simultaneous floating/picture-in-picture overlays, home-screen widgets, and general-purpose "timer app" parity for its own sake. See §3 for the full rationale. |
| [0024 — Multiple Local Solo Sessions](0024-stopwatch-multiple-local-solo-sessions.md) | **Extended.** Local solo sessions are unchanged. This ADR adds the ability to convert a local session into a shared one by uploading its event log (see §4). |
| [0025 — Repeat/Pomodoro Countdown Mode](0025-stopwatch-pomodoro-repeat-timer.md) | **Unaffected.** Repeat mode applies to individual timer rows and is encoded in per-timer events. No changes to the repeat-mode contract. |
| [0026 — Material 3 Redesign](0026-stopwatch-material-3-redesign.md) | **Unaffected.** Color roles, typography, shape/motion tokens, and the instrument-face carve-out are unchanged. The new timer-row list UI adopts the same MD3 roles. |

---

## Context

The original casual stopwatch surface (ADR 0017) shipped a **single shared stopwatch** — one clock per session, collaboratively controlled by all participants. Every session had exactly one running elapsed time, one lap list, and one set of controls (start / lap / stop / reset).

Post-launch usage surfaced two recurring patterns that this model could not serve:

1. **Multi-event timing.** Coaches and race marshals want to run several independent clocks simultaneously within one coordination group — for example, a finish-line team timing both the A race and the B race from the same device group, with each race's clock and splits kept separate and clearly labelled.

2. **Promote a local session to shared.** A solo practitioner starts timing on their own device with no internet, then decides mid-session they want a colleague to join. Under ADR 0024, local sessions were entirely device-private and could not be shared; the only workaround was to stop, create a fresh shared session, and lose the pre-share lap history.

ADR 0018 had explicitly rejected "multiple simultaneous named timers" on the grounds of surface-contract mismatch, maintenance cost, and absence of demand signal. Both patterns above directly answer those objections: post-launch demand is now documented, the UI paradigm is a natural extension of the existing session-switcher list (ADR 0024), and the implementation cost is constrained because the event-sourced model already generalises cleanly to a `timer_id` dimension.

This ADR documents the decisions and their rationale. The migration that delivers the schema is tracked in issue #463.

---

## Decisions

### 1. Table and RPC Rename: `casual_*` → `shared_*`

The `casual_` prefix was chosen at the start of the surface's life to distinguish it from the main event-management surfaces and to signal its informal, no-roster character. After several ADR iterations, the surface has grown to include results permalinks, live views, session management, and (now) multi-timer collaboration. "Casual" no longer describes the surface accurately.

**New names:**

| Old name | New name |
|---|---|
| `casual_sessions` | `shared_sessions` |
| `casual_session_participants` | `shared_session_participants` |
| `casual_session_events` | `shared_session_events` |
| `create_casual_session` | `create_shared_session` |
| `join_casual_session` | `join_shared_session` |
| `record_session_event` | `record_session_event` (unchanged — the name was already generic) |
| `get_session_state` | `get_session_state` (unchanged) |
| `close_casual_session` | `close_shared_session` |
| `delete_casual_session` | `delete_shared_session` |
| `get_casual_session_results` | `get_shared_session_results` |
| `get_casual_session_live_view` | `get_shared_session_live_view` |

The migration drops the old tables (and their associated RLS policies, security-definer RPCs, and `pg_cron` job references) and recreates them under the new names. Casual-session data is ephemeral and is intentionally not migrated.

The `pg_cron` job is renamed from `casual_sessions_expiry` to `shared_sessions_expiry` and its body is updated to reference `shared_sessions`.

The Realtime channel key changes from `stopwatch:<code>` to `session:<code>`. Clients on older app versions that still subscribe to `stopwatch:<code>` will not receive events from new sessions. A migration window is not required because the channel key is embedded in the client and old client versions are incompatible with the new schema by design.

---

### 2. Multiple Independent Timers per Session

A shared session now contains **one or more timer rows**, each identified by a `timer_id` (client-generated UUID). Timers within a session are independent:

- Each timer has its own start/stop/reset lifecycle.
- Each timer has its own lap list.
- Timers do not influence each other's elapsed time or controls.
- All timers within a session share a single Realtime Broadcast channel (`session:<code>`), a single participant list, and a single authentication model (creator signs in, joiners anonymous by code).

#### Schema additions

`shared_sessions` adds a per-session sequence and cached `state jsonb` snapshot. `shared_session_events` is append-only; it adds a nullable `timer_id` (null for session-level events) and a JSON payload. The state cache contains timer rows, timer order, repeat configuration, and the accepted sequence; it is a read cache only.

#### Concurrency and ordering

The server serializes accepted events per session and advances its sequence. Clients reconstruct state by reducing events in sequence order; timer events are routed by `timer_id` and session-level events update the whole session.

The `record_session_event` RPC validates:
- participant membership and client-event idempotency;
- valid event type and required timer id;
- owner authority for structural and session-configuration events;
- the transition against the current cached state, while appending the event and updating the cache atomically.

Multiple participants may submit events to different timers simultaneously without conflict; conflicts are possible only within a single timer (e.g., two concurrent `start` events for the same timer — the first-write-wins rule from ADR 0017 §3 is applied per timer, not per session).

#### UI contract

The stopwatch app presents timer rows in a vertically scrollable list within a session screen. Each row shows:
- A user-supplied timer name (editable).
- The timer's current elapsed/countdown display.
- Per-timer start/lap/stop/reset controls.

All participants see the same list and may operate any timer's controls. The creator alone adds, removes, renames, or reorders timer rows and changes session configuration.

Timer rows can be **reordered** (drag to position) and **deleted** (with a confirmation). These actions are session events, so the shared list is reduced consistently on every client; prior events remain available for audit and results export.

---

### 3. Reversal of ADR 0018's Multi-Timer No-Go

ADR 0018 rejected multi-timer parity with three primary arguments. Each is addressed below.

**"Surface contract mismatch."** ADR 0018 stated that multiple simultaneous timers require "a list-based UX paradigm that is categorically different from a one-tap shared stopwatch." Since ADR 0024, the stopwatch surface already uses a list-based session switcher, and the UI for timer rows within a session is a direct extension of that same list paradigm. The paradigm shift ADR 0018 was wary of has already occurred.

**"Competing on the incumbent's home turf."** The multi-timer feature in this ADR is not a general-purpose timer board aimed at the Hybrid Stopwatch & Timer audience. It is scoped to **named timers within a shared session** — the defining feature is collaborative real-time control across devices, which the incumbent does not offer. The competitive angle is "your team on the same page," not "more timer slots than the other app."

**"No demand signal yet."** Since ADR 0018 was written and the surface launched, the two patterns in §Context above have been concretely documented from post-launch user feedback. The demand signal now exists.

**What remains rejected (unchanged from ADR 0018 and its amendments):**
- Floating / picture-in-picture timers.
- Home-screen or lock-screen widgets.
- Per-session floating timer overlays persisting across apps.
- General-purpose HIIT/interval presets library.
- Cross-device sync of local solo session configuration (local sessions remain device-private per ADR 0024).

---

### 4. Promote a Local Session to Shared ("Share Session")

A user may promote an existing local solo session (ADR 0024) to a shared session by tapping **Share session** from the session detail screen. The steps:

1. The client calls `create_shared_session` (requires authentication) to create a new `shared_sessions` row with a fresh code.
2. The client replays its local event log — one `record_session_event` call per local event, in chronological order — against the new session. The `client_recorded_at` values from the local log are preserved exactly, so the historical timestamps (and thus the derived splits) match what the user saw locally.
3. Once all events are confirmed, the client switches to the shared session UI. Whether it retains an archived local copy is an implementation detail.
4. Participants join as normal via the session code. The uploaded history is immediately visible.

This is an **additive** extension of the event-log-is-truth invariant: the same events that drove the local session's derived state are now on the server, and all derivation remains client-side from the event log. No new persisted computed value is introduced.

---

### 5. Event-Sourcing Retained and Extended — Not Replaced

A natural alternative to the event log at this complexity level would be a mutable JSON snapshot: store the "current state" of each timer in a single JSONB column and update it in place on every control action, using Optimistic Locking or last-writer-wins semantics.

**Why event sourcing is retained:**

1. **Conflict-free collaborative editing.** The event log is append-only. Two participants pressing `lap` on different timers at the same time generate two independent inserts with no conflict. A mutable snapshot would require a read-modify-write cycle with a CAS guard, amplifying lock contention as participant count grows.

2. **Consistency with the existing "event log is truth" invariant.** SplitSync's domain invariant #2 (positions and splits are derived, never persisted) applies equally to the stopwatch surface. The `shared_sessions.state` JSONB column introduced in this ADR is a *read cache* (updated by the security-definer RPC as a side effect of event insertion), not a replacement for event-log derivation. All elapsed-time and split calculations remain client-side from the ordered event log.

3. **Results permalink correctness.** `get_shared_session_results` serves the results permalink by returning the ordered event log, from which the client derives all splits and totals. A pure-snapshot model would lose intermediate lap events on every update, making it impossible to reconstruct the full split history.

4. **Auditability.** Every control action (who pressed start on which timer, at what client-side timestamp, accepted at what server-side timestamp) is permanently recorded and replayable. A mutable snapshot cannot provide this.

5. **Offline and reconnect resilience.** A reconnecting client asks for all events since its last known `sequence` and replays them locally — the same mechanism that drove the original catch-up design (ADR 0017 §5). This generalises to multiple timers with no architectural change.

The `state` JSONB cache introduced in this ADR is explicitly **not** a step toward replacing event sourcing. It exists solely to allow `get_shared_session_live_view` and `get_session_state` to return the current per-timer status without requiring the caller to replay the full event log on the server. The cache is always derived from the event log by the RPC; it is never written by any client directly.

---

## Consequences

### Schema

- Three new tables (`shared_sessions`, `shared_session_participants`, `shared_session_events`) replace the three `casual_*` tables. See `docs/architecture.md` for the current column definitions.
- `shared_sessions` adds `sequence bigint` and `state jsonb` relative to the old `casual_sessions`.
- `shared_session_events` adds `timer_id uuid` and `payload jsonb` relative to the old `casual_session_events`.
- The `pg_cron` job is renamed from `casual_sessions_expiry` to `shared_sessions_expiry`.

### Security model

- The security-definer RPC pattern from ADR 0017 is unchanged: no direct table grants for anon writes; all access flows through RPCs.
- `create_shared_session` validates `auth.uid() IS NOT NULL` (creator must be authenticated), same as `create_casual_session`.
- `join_shared_session` is callable by the anon role, same as `join_casual_session`.
- RPC names are updated as listed in §1 above.

### Realtime

- The Broadcast channel key changes from `stopwatch:<code>` to `session:<code>`.
- The event broadcast model is extended: clients broadcast accepted events and reduce them locally, rather than broadcasting a full mutable state snapshot.
- The `state` cache in `shared_sessions` enables the live-view RPC to serve a compact current-state snapshot without a full event-log replay on the server — suitable for lightly-connected spectator viewers.

### Runbooks

- `docs/runbooks/production-setup.md`: the `pg_cron` job section is updated from `casual_sessions_expiry` / `casual_sessions` to `shared_sessions_expiry` / `shared_sessions`.

### Help content

- `apps/web/src/app/help/page.tsx`: the stopwatch surface sections are updated to describe sessions, timer rows, and the new sharing model.

### AGENTS.md

- The "Casual stopwatch" surface row is updated to "Shared stopwatch" to match the renamed tables. The core invariants (creator auth, anonymous join, event log as truth, no roster) are unchanged.

### Backwards compatibility

- Clients that reference `casual_*` table names directly (there should be none — all access was RPC-gated) will break. The RPC-only access model from ADR 0017 means all clients should be unaffected by the table rename as long as the RPC names are updated to match.
- Old client builds that use the `stopwatch:<code>` Broadcast channel will not receive updates from new sessions. This is acceptable because the schema change requires an app update regardless.
