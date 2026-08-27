# ADR 0008: Per-Event Check-In With A Scoped Write RPC

## Status

Accepted.

## Decision

Add a single nullable `checked_in_at timestamptz` column to `participants` (the event-level roster), not a separate race-scoped check-in table. Check-in is a per-event fact ("has this racer arrived and collected a bib") that a participant carries into every race they're entered in, matching how the roster itself is per-event and races draw their `entries` from it (see `AGENTS.md` domain invariant 3). No race in the current MVP needs independent check-in from its siblings at the same event.

Writes to `checked_in_at` go through a new `security definer` Postgres function, `set_participant_checked_in(participant_id, checked_in)`, rather than a blanket RLS `UPDATE` policy on `participants`. The function checks `is_event_owner(event_id)` or `has_event_role(event_id, array['organizer', 'checkin'])` (both introduced in ADR 0006) before writing, and only ever touches the one column. This mirrors `reopen_race()`'s existing shape (ADR 0005): authorization logic lives inside the function instead of a table-wide policy, so a `checkin`-role volunteer can flip the flag without also being able to edit `bib`, `first_name`, `team`, or `category` — a blanket `UPDATE` policy would have made all four writable, not just the intended field, since Postgres RLS cannot restrict a policy to specific columns on its own.

The owner and `organizer`-role members already have unrestricted `participants` writes via the existing `"organizer manage participants"` / `"member manage participants"` policies, so the RPC's ownership/organizer branch is a convenience — it lets the check-in UI call one function regardless of which role the caller has, rather than branching client-side between a direct `.update()` and an RPC.

The check-in view and the per-race start list (`/startlist/[raceId]`) are new UI surfaces on the existing organizer-admin pages (`/event/[eventId]` and a new route alongside `/score/[raceId]`), not a new app surface. `canCheckIn(role)` in `useEventAccess.ts` follows the existing `canManageEvent`/`canScore` pattern.

## Rationale

A race-scoped check-in table was considered (one row per `entries` row) but rejected: it would let the same racer be "checked in" for one race at an event but not another, which has no operational meaning here — check-in confirms the person and their bib showed up, once, before any of their races start. It would also require check-in to happen after race entries are assigned, whereas organizers commonly want to check racers in as they arrive, independent of which races are finalized yet.

A blanket RLS `UPDATE` policy for the `checkin` role was rejected in favor of the RPC for the column-scoping reason above, and because it keeps the authorization decision in one place (the function) rather than spread across a policy plus client-side UI restraint.

## Consequences

- Check-in status is visible (read-only) to any event member via the existing `"member read participants"` policy from ADR 0006; only the write path is newly scoped.
- If a future requirement needs per-race check-in (e.g. a multi-day event with the same roster racing on different days under different check-in windows), that's a new table and RPC, not a breaking change to this one.
- The start list at `/startlist/[raceId]` is read-only and reachable by any event member (owner or any `event_members` role), since knowing who's confirmed as present and their bib assignment is useful to scorers and officials too, not just check-in volunteers.
