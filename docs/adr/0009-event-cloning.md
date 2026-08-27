# ADR 0009: Event Cloning Via A Security Definer RPC

## Status

Accepted.

## Decision

Add a Postgres RPC, `clone_event(p_event_id uuid, p_include_roster boolean default false, p_title text default null)`, that copies an existing event's structure into a brand-new draft event:

- Copies `events` fields that describe the event itself (title, sport, location, and the on-site detail fields added for the Help/details work) but always forces the new row to `status = 'draft'`, a fresh `owner_id` set from the caller's JWT, and never copies `starts_at`/`ends_at`.
- Copies every `races` row (`name`, `sequence_order`, `laps_planned`) into the new event. Cloned races are always inserted with no `status`/`started_at`/`finished_at` supplied, so they take the table defaults (`upcoming`, null, null) — the same state a manually created race starts in.
- Optionally (`p_include_roster = true`) copies `participants` rows (`bib`, `first_name`, `last_name`, `team`, `category`, `sex`) with new IDs into the new event.
- Never copies `entries` or `crossings` — cloning is a pre-race-day, structural operation only.
- Is `security definer` with `set search_path = public`, following the `reopen_race()` precedent: it re-checks that the caller owns the source event via `auth.jwt()->>'sub'` (using `exists (select ... where owner_id = auth.jwt()->>'sub')` rather than a direct `<>` comparison, so an unauthenticated/null JWT subject fails closed instead of silently passing).
- `revoke all ... from public; grant execute ... to authenticated;`, matching the existing RPC access-control convention.

There is no separate "categories" table to copy — race category is just `races.name`, and rider category is a free-text `participants.category`/`entries.category` column — so "copy the category list" in the issue is satisfied entirely by copying `races` and, when requested, `participants`.

## Rationale

Recurring local series (weekly velodrome nights, a CX series) re-create nearly identical event structure every week. A single atomic server-side operation is preferable to sequential client-side inserts (the pattern used everywhere else in the app) because cloning spans three tables and must not partially succeed — e.g. leaving a new event with no races if a later insert fails. `security definer` with an explicit ownership re-check (the same shape as `reopen_race()`) lets one function insert into `events`, `races`, and `participants` for the *new* event id without needing bespoke RLS policies for "insert a full clone," while still fully respecting ownership of the *source* event.

## Consequences

- A new draft event created this way looks, to every other part of the app, exactly like one created via `/new` and then built up by hand — it has no marker linking it back to its source event. If a "cloned from" audit trail is ever needed, it would require a new column.
- Because races are inserted with default status, the `races_lifecycle_guard` trigger (ADR 0005) is not implicated — that trigger only fires on `update`, not `insert`.
- Roster copy is a snapshot at clone time; edits to the source event's roster after cloning are not reflected in the clone (matches the "roster is created once" invariant — the clone gets its own independent roster).
- Cloning is event-level only; there is no per-race clone-into-another-event operation (explicitly out of scope in issue #68).
