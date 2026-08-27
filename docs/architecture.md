# Architecture

## Data Model

| Table | Purpose |
| --- | --- |
| `events` | Event metadata, publication status, provider-neutral organizer `owner_id` |
| `participants` | Event-level racer roster: bib, first/last name, team, category, sex |
| `races` | A race/category within an event, planned laps and lifecycle state |
| `entries` | Roster participants assigned to a specific race; frozen on start |
| `crossings` | A recorded line crossing: race, bib, client UUID, client/server timestamps, source |
| `race_status_changes` | Append-only audit log of every race status transition, written by a trigger |
| `crossing_corrections` | Append-only audit log of every crossing edit/restore, written by a trigger |

`crossings` intentionally does not foreign-key `bib` to `entries`. It keeps a factual audit record and allows future connector ingestion. The current UI only presents assigned entries as tappable inputs.

## Lifecycle

```text
event: draft -> live -> finished
race:  upcoming -> active -> finished
```

- A draft is visible only to its owner.
- Publishing an event makes its event, races, entries, and crossings readable to spectators.
- Starting a race sets `started_at` and prevents entry writes.
- Finishing a race sets `finished_at`.
- A crossing uses device time for ordering and server time for audit/replication.
- Only `upcoming -> active`, `active -> finished`, and an explicit, reasoned
  `finished -> active` reopen are legal transitions. Every other transition
  (e.g. skipping straight to `finished`, or reopening without a reason) is
  rejected at the database level by the `races_lifecycle_guard` trigger, not
  just hidden in the UI. See ADR 0005.
- Reopening a finished race is done through the `reopen_race(race_id, reason)`
  Postgres function, which requires a non-empty reason, checks event
  ownership, clears `finished_at`, and returns the race to `active`. Direct
  client updates cannot perform this transition.
- Every race status change (including ordinary start/finish) is recorded in
  `race_status_changes` with the previous/new status, actor, timestamp, and
  optional reason, via an `after update` trigger.
- Crossings support two correction primitives beyond plain soft-delete:
  editing a crossing's `bib`/`client_recorded_at` via `correct_crossing()`,
  and restoring a soft-deleted crossing via `restore_crossing()`. Both are
  `security definer` Postgres functions requiring event ownership and a
  non-empty reason, and both preserve the crossing's original `id`/`client_id`
  (the offline-retry idempotency key) — a correction only ever changes the
  displayed bib or time, never the crossing's identity. Every such change,
  plus every plain soft-delete, is recorded in `crossing_corrections` (actor,
  previous/new value, and — for edits/restores — a required reason) by a
  `crossings_correction_guard`/`crossings_correction_audit` trigger pair that
  enforces this regardless of which client performs the underlying `UPDATE`.
  See ADR 0006.

## Standings

`apps/web/src/lib/standings.ts` derives standings from non-deleted crossings:

1. Laps: count crossings per bib.
2. Position: highest lap count first; earliest crossing at that lap breaks ties.
3. Gap: difference to leader's crossing at the same lap, or lap deficit.
4. Last lap: time since previous crossing; lap one is measured from `races.started_at`.

The same logic should be shared with mobile before mobile begins presenting standings.

## Realtime

Supabase Realtime publishes changes from `crossings` and `races`. Web clients use `useRaceData` to refetch current race data on a change, then recompute the pure standings function. This favors correctness and simple recovery over incremental client state.

## Security

Supabase RLS enforces the application boundary:

- Anonymous: select published event/race/entry/crossing data only.
- Authenticated organizer: manage only rows belonging to events where `owner_id` matches the JWT subject.
- Entries: organizer writes are permitted only while the corresponding race is `upcoming`.
- Crossings: organizer-only for now. Event-scoped scorer access is future issue #17.
- Crossings: inserts are permitted only while the parent race is `active`; reads, corrections (soft-delete via update), and deletes remain available to the owning organizer in any race status.
- Race status transitions: enforced by a trigger regardless of caller, not by RLS alone (RLS still confirms event ownership).
- Crossing corrections: editing a bib/time or restoring a soft-deleted crossing is gated by a trigger requiring a reason, not by RLS alone; `crossing_corrections` itself is read-only to organizers (owner-scoped) and is only ever written by the `security definer` trigger/functions.

Migration 00004 introduces the ownership policies. Migration 00005 enforces the start-time roster lock. Migration `20260827000004_race_lifecycle` adds `finished_at`, the lifecycle trigger/audit log, the `reopen_race` function, and the active-only crossing insert policy. Migration `20260827000005_crossing_corrections` adds the `crossing_corrections` audit table, the correction guard/audit triggers, and the `correct_crossing`/`restore_crossing` functions.
