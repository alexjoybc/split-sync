# Architecture

## Data Model

| Table | Purpose |
| --- | --- |
| `events` | Event metadata, publication status, provider-neutral organizer `owner_id` |
| `participants` | Event-level racer roster: bib, first/last name, team, category, sex |
| `races` | A race/category within an event, planned laps and lifecycle state |
| `entries` | Roster participants assigned to a specific race; frozen on start |
| `crossings` | A recorded line crossing: race, bib, client UUID, client/server timestamps, source |

`crossings` intentionally does not foreign-key `bib` to `entries`. It keeps a factual audit record and allows future connector ingestion. The current UI only presents assigned entries as tappable inputs.

## Lifecycle

```text
event: draft -> live -> finished
race:  upcoming -> active -> finished
```

- A draft is visible only to its owner.
- Publishing an event makes its event, races, entries, and crossings readable to spectators.
- Starting a race sets `started_at` and prevents entry writes.
- A crossing uses device time for ordering and server time for audit/replication.

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

Migration 00004 introduces the ownership policies. Migration 00005 enforces the start-time roster lock.
