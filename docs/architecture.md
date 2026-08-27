# Architecture

## Data Model

| Table | Purpose |
| --- | --- |
| `events` | Event metadata, publication status, provider-neutral organizer `owner_id` |
| `participants` | Event-level racer roster: bib, first/last name, team, category, sex, check-in timestamp |
| `races` | A race/category within an event, planned laps, lifecycle state, and optional velodrome points race scoring config |
| `entries` | Roster participants assigned to a specific race; roster identity frozen on start, status settable throughout |
| `crossings` | A recorded line crossing: race, bib, client UUID, client/server timestamps, source |
| `race_status_changes` | Append-only audit log of every race status transition, written by a trigger |
| `crossing_corrections` | Append-only audit log of every crossing edit/restore, written by a trigger |
| `entry_status_changes` | Append-only audit log of every entry status (DNS/DNF/DSQ) transition, written by a trigger |
| `race_entry_penalties` | Time/lap penalties, relegations, and notes applied to a race entry — the record itself (insert/delete only), not an audit log of it |
| `event_members` | Accepted volunteer grant: event, JWT-subject `user_id`, role |
| `event_invites` | Single-use, time-limited invite link: event, role, token, expiry |

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
  `security definer` Postgres functions requiring event ownership (or an
  `organizer`/`scorer`-role `event_members` grant) and a non-empty reason,
  and both preserve the crossing's original `id`/`client_id` (the
  offline-retry idempotency key) — a correction only ever changes the
  displayed bib or time, never the crossing's identity. Every such change,
  plus every plain soft-delete, is recorded in `crossing_corrections` (actor,
  previous/new value, and — for edits/restores — a required reason) by a
  `crossings_correction_guard`/`crossings_correction_audit` trigger pair that
  enforces this regardless of which client performs the underlying `UPDATE`.
  See ADR 0010.

## Cloning

An organizer can clone an event's structure into a new draft event via the
`clone_event(event_id, include_roster, title)` Postgres function:

- Copies event metadata (title, sport, location, and the detail fields) into
  a new `events` row, always forcing `status = 'draft'` and a fresh
  `owner_id`; `starts_at`/`ends_at` are never copied.
- Copies every `races` row (name, sequence order, planned laps) into the new
  event; cloned races always start `upcoming` with no `started_at`/
  `finished_at`.
- Optionally copies `participants` rows (a fresh roster snapshot) into the
  new event when `include_roster` is true.
- Never copies `entries`, `crossings`, or any race-day state.

Like `reopen_race`, this is a `security definer` function that re-checks
ownership of the *source* event against the caller's JWT subject before
writing anything. See ADR 0009.

## Standings

`apps/web/src/lib/standings.ts` derives standings from non-deleted crossings:

1. Laps: count crossings per bib.
2. Position: highest lap count first; earliest crossing at that lap breaks ties.
3. Gap: difference to leader's crossing at the same lap, or lap deficit.
4. Last lap: time since previous crossing; lap one is measured from `races.started_at`.

The same logic should be shared with mobile before mobile begins presenting standings.

## Rider Status (DNS/DNF/DSQ)

`entries.status` (`ok` | `dns` | `dnf` | `dsq`) is an organizer-asserted fact, not derived from crossings — it sits alongside crossings as an input to `computeStandings`, which never persists a calculated standing itself (ADR 0001). `computeStandings` excludes non-`ok` entries from ranked position (`position: null`) but still returns them, sorted after all ranked riders, so the UI shows a status badge instead of dropping or misranking them. Every status change is timestamped and attributed (`status_set_by`/`status_set_at`, set by a trigger, not the client) and logged to `entry_status_changes`. See ADR 0007.

## Velodrome Points Race

A points race is scored entirely as an overlay on the same crossings/entries that drive overall standings — no new fact table (ADR 0011). `races` carries the scoring config (`is_points_race`, `sprint_interval_laps`, `sprint_points`, `final_sprint_multiplier`, `lap_gain_bonus`, `lap_loss_penalty`), all defaulted so non-points races are unaffected. `apps/web/src/lib/pointsRace.ts` derives, purely from crossings + that config:

1. Sprint laps: every `sprint_interval_laps` laps, plus the final lap always (never double-counted if it coincides with an interval).
2. Sprint result: the arrival order at a given lap, read directly off each rider's existing crossing sequence (their Nth crossing) — the same facts, no separate capture step.
3. Points: sprint placings (at `final_sprint_multiplier` on the last lap) plus a lap-gain bonus each time a rider's completed-lap count pulls more than one lap ahead of the best of the rest of the field.
4. Ranking: points desc, then laps desc, then final-sprint placing, then earliest final crossing.

The live board and announcer view render a sprint-lap banner, that sprint's own mini-result, and the cumulative points leaderboard only when `race.is_points_race` is true; the mini-result folds back into the leaderboard automatically once any rider crosses to the next lap, driven by live crossings rather than a UI timer.

## Penalties And Adjustments

`race_entry_penalties` (`time_penalty` | `lap_penalty` | `relegation` | `note`) is an organizer/official-asserted fact, same category as rider status, applied as the final step in `computeStandings` after the raw per-lap/gap computation: a time penalty shifts an entry's effective ranking time, a lap penalty reduces its effective lap count, and a relegation sorts it to the back of its same-effective-lap tier. `StandingRow`'s raw fields (`laps`, `lastCrossingAt`, `lastLapMs`) are never altered by a penalty — only the derived `position`/`gapText` and the row's `timePenaltySeconds`/`lapPenalty`/`relegated`/`penalties` fields reflect it, preserving the "raw vs. adjusted" split even though only the adjusted view is shown by default. Every penalty requires a reason and is attributed (`set_by`/`set_at`, set by a trigger, not the client). Unlike rider status, penalties are cumulative (a table of penalty rows, not a column), and rows are only ever inserted or deleted, not updated. See ADR 0012.

## Realtime

Supabase Realtime publishes changes from `crossings`, `races`, `entries`, and `race_entry_penalties`. Web clients use `useRaceData` to refetch current race data on a change, then recompute the pure standings function. This favors correctness and simple recovery over incremental client state. `race_entry_penalties` has no `race_id` column to filter the subscription on, so `useRaceData` listens unfiltered and re-scopes on refetch by the race's current entry ids.

## Security

Supabase RLS enforces the application boundary:

- Anonymous: select published event/race/entry/crossing data only.
- Authenticated organizer: manage only rows belonging to events where `owner_id` matches the JWT subject.
- Entries: adding/removing an entry (insert/delete) is permitted only while the corresponding race is `upcoming`. Updates are scoped to the owner or an `organizer`-role member in any race status; the `entries_write_guard` trigger (not RLS) rejects roster identity (bib/name/team/category) changes outside `upcoming`, while allowing `status`/`status_reason` changes at any time.
- Crossings: inserts are permitted only while the parent race is `active`; reads, corrections (soft-delete via update), and deletes remain available to the owning organizer (or a `scorer`/`organizer` member) in any race status.
- Race status transitions: enforced by a trigger regardless of caller, not by RLS alone (RLS still confirms event ownership or an `organizer`-role `event_members` grant, see below).
- Crossing corrections: editing a bib/time or restoring a soft-deleted crossing is gated by a trigger requiring a reason, not by RLS alone; `correct_crossing()`/`restore_crossing()` confirm the caller is the owner or an `organizer`/`scorer`-role member, same as `reopen_race()`. `crossing_corrections` itself is read-only (owner or `organizer`/`scorer`-role member) and is only ever written by the `security definer` trigger/functions.
- Entry status transitions: attribution (`status_set_by`/`status_set_at`) is written only by a trigger, never accepted from the client; every transition is logged to `entry_status_changes`.
- Penalties/adjustments: `race_entry_penalties` requires a non-empty reason and a type-appropriate value, enforced by a `before insert` trigger that also writes attribution (`set_by`/`set_at`); rows may be inserted or deleted by the owner or an `organizer`/`official`-role member, never updated. Spectators of a published event can read them (for the public penalty badge), mirroring the `crossings`/`entries` publish split.
- Authenticated volunteer: an accepted row in `event_members` grants role-scoped access to one event, independent of `owner_id` (see ADR 0006). `organizer` members can manage roster/races/participants/invites (including rider status and penalties) like the owner (but not delete the event) and share the owner's `reopen_race` authority; `scorer` members can record/undo/correct crossings and start/finish races (crossing inserts still require an `active` race); `checkin` members can additionally flip a participant's check-in status (see below); `official` members get read-only access to the private (draft) event, plus write access to `race_entry_penalties` — their first and only write capability (see ADR 0012).
- Invite links (`event_invites`) are single-use and expire after 14 days. Looking up or accepting one goes through the `preview_event_invite` / `accept_event_invite` security-definer functions rather than a direct SELECT policy, so tokens are never listable.
- Check-in: `participants.checked_in_at` is writable, at any race status, only through the `set_participant_checked_in(participant_id, checked_in)` security-definer function, which checks event ownership or an `organizer`/`checkin` `event_members` role. This is the same pattern as `reopen_race` — a `checkin` volunteer is not granted a blanket `UPDATE` on `participants`, so they cannot edit bib/name/team/category, only the check-in flag. See ADR 0008.

Migration 00004 introduces the ownership policies. Migration 00005 enforces the start-time roster lock. Migration `20260827000004_race_lifecycle` adds `finished_at`, the lifecycle trigger/audit log, the `reopen_race` function, and the active-only crossing insert policy. Migration `20260827000005_volunteer_roles` adds volunteer roles and invite links. Migration `20260827000006_race_entry_statuses` adds rider status, its audit log, and splits the entries write policy into insert/delete (upcoming-only) and update (owner/organizer-member, field-level lock via trigger). Migration `20260827000007_participant_checkin` adds `checked_in_at` and the `set_participant_checked_in` function. Migration `20260827000008_clone_event` adds the `clone_event` function. Migration `20260827000009_crossing_corrections` adds the `crossing_corrections` audit table, the correction guard/audit triggers, and the `correct_crossing`/`restore_crossing` functions. Migration `20260827000010_velodrome_points_race` adds the points-race scoring config columns on `races`; no RLS changes were needed since they're covered by the existing races policies. Migration `20260827000011_race_entry_penalties` adds `race_entry_penalties`, its insert guard/attribution trigger, and the owner/organizer/official manage policies plus the published-event public read policy.

### Resolving a user's access to an event

`apps/web/src/lib/useEventAccess.ts` resolves, for the signed-in user and one event, whether they are the `owner`, an `event_members` role, or have no access — this drives both the event setup page and the scorer page. It is a UX convenience only; the RLS policies above are the actual enforcement boundary.
