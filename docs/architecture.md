# Architecture

## Data Model

| Table | Purpose |
| --- | --- |
| `events` | Event metadata, publication status, provider-neutral organizer `owner_id` |
| `participants` | Event-level racer roster: bib, first/last name, team, category, sex, check-in timestamp |
| `races` | A race/category within an event, planned laps and lifecycle state |
| `entries` | Roster participants assigned to a specific race; roster identity frozen on start, status settable throughout |
| `crossings` | A recorded line crossing: race, bib, client UUID, client/server timestamps, source |
| `race_status_changes` | Append-only audit log of every race status transition, written by a trigger |
| `entry_status_changes` | Append-only audit log of every entry status (DNS/DNF/DSQ) transition, written by a trigger |
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

## Standings

`apps/web/src/lib/standings.ts` derives standings from non-deleted crossings:

1. Laps: count crossings per bib.
2. Position: highest lap count first; earliest crossing at that lap breaks ties.
3. Gap: difference to leader's crossing at the same lap, or lap deficit.
4. Last lap: time since previous crossing; lap one is measured from `races.started_at`.

The same logic should be shared with mobile before mobile begins presenting standings.

## Rider Status (DNS/DNF/DSQ)

`entries.status` (`ok` | `dns` | `dnf` | `dsq`) is an organizer-asserted fact, not derived from crossings — it sits alongside crossings as an input to `computeStandings`, which never persists a calculated standing itself (ADR 0001). `computeStandings` excludes non-`ok` entries from ranked position (`position: null`) but still returns them, sorted after all ranked riders, so the UI shows a status badge instead of dropping or misranking them. Every status change is timestamped and attributed (`status_set_by`/`status_set_at`, set by a trigger, not the client) and logged to `entry_status_changes`. See ADR 0007.

## Realtime

Supabase Realtime publishes changes from `crossings` and `races`. Web clients use `useRaceData` to refetch current race data on a change, then recompute the pure standings function. This favors correctness and simple recovery over incremental client state.

## Security

Supabase RLS enforces the application boundary:

- Anonymous: select published event/race/entry/crossing data only.
- Authenticated organizer: manage only rows belonging to events where `owner_id` matches the JWT subject.
- Entries: adding/removing an entry (insert/delete) is permitted only while the corresponding race is `upcoming`. Updates are scoped to the owner or an `organizer`-role member in any race status; the `entries_write_guard` trigger (not RLS) rejects roster identity (bib/name/team/category) changes outside `upcoming`, while allowing `status`/`status_reason` changes at any time.
- Crossings: inserts are permitted only while the parent race is `active`; reads, corrections (soft-delete via update), and deletes remain available to the owning organizer (or a `scorer`/`organizer` member) in any race status.
- Race status transitions: enforced by a trigger regardless of caller, not by RLS alone (RLS still confirms event ownership or an `organizer`-role `event_members` grant, see below).
- Entry status transitions: attribution (`status_set_by`/`status_set_at`) is written only by a trigger, never accepted from the client; every transition is logged to `entry_status_changes`.
- Authenticated volunteer: an accepted row in `event_members` grants role-scoped access to one event, independent of `owner_id` (see ADR 0006). `organizer` members can manage roster/races/participants/invites (including rider status) like the owner (but not delete the event) and share the owner's `reopen_race` authority; `scorer` members can record/undo crossings and start/finish races (crossing inserts still require an `active` race); `checkin` members can additionally flip a participant's check-in status (see below); `official` members get read-only access to the private (draft) event.
- Invite links (`event_invites`) are single-use and expire after 14 days. Looking up or accepting one goes through the `preview_event_invite` / `accept_event_invite` security-definer functions rather than a direct SELECT policy, so tokens are never listable.
- Check-in: `participants.checked_in_at` is writable, at any race status, only through the `set_participant_checked_in(participant_id, checked_in)` security-definer function, which checks event ownership or an `organizer`/`checkin` `event_members` role. This is the same pattern as `reopen_race` — a `checkin` volunteer is not granted a blanket `UPDATE` on `participants`, so they cannot edit bib/name/team/category, only the check-in flag. See ADR 0008.

Migration 00004 introduces the ownership policies. Migration 00005 enforces the start-time roster lock. Migration `20260827000004_race_lifecycle` adds `finished_at`, the lifecycle trigger/audit log, the `reopen_race` function, and the active-only crossing insert policy. Migration `20260827000005_volunteer_roles` adds volunteer roles and invite links. Migration `20260827000006_race_entry_statuses` adds rider status, its audit log, and splits the entries write policy into insert/delete (upcoming-only) and update (owner/organizer-member, field-level lock via trigger). Migration `20260827000007_participant_checkin` adds `checked_in_at` and the `set_participant_checked_in` function.

### Resolving a user's access to an event

`apps/web/src/lib/useEventAccess.ts` resolves, for the signed-in user and one event, whether they are the `owner`, an `event_members` role, or have no access — this drives both the event setup page and the scorer page. It is a UX convenience only; the RLS policies above are the actual enforcement boundary.
