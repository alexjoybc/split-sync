# ADR 0024: Casual Session Close and Delete

## Status

Accepted.

## Context

A casual stopwatch session previously had no owner-initiated end state. It
became unjoinable only passively, four hours after creation (`expires_at`),
and the row (plus its participants and events) was never removed from the
database. Creators had no way to end a session early or clean up old ones.

Separately, `casual_sessions` had never been granted `select` to
`authenticated`, so the existing "My Sessions" list (a direct
`.from("casual_sessions").select(...)` in both `apps/web` and
`apps/stopwatch`) failed with a permission error for every user. This ADR's
migration fixes that grant alongside the new lifecycle functions, since the
close/delete UI depends on that list working at all.

## Decision

- `casual_sessions.status` gains a fourth, terminal value: `closed`, alongside
  the existing `waiting` / `running` / `stopped`.
- Two new owner-only, security-definer RPCs:
  - `close_casual_session(p_session_id)` — sets status to `closed` from any
    non-closed state. Idempotent. A closed session behaves like a stopped one
    for join/results purposes (rejects `join_casual_session`, rejects
    `record_session_event` with `SESSION_CLOSED`, but remains readable via
    `get_casual_session_results` and `get_casual_session_live_view`).
  - `delete_casual_session(p_session_id)` — hard-deletes the session row.
    Existing `on delete cascade` foreign keys remove its participants and
    events.
  - Both raise `UNAUTHORIZED` unless `owner_id = auth.uid()::text`, matching
    the existing `create_casual_session` pattern. Reset is unaffected.
- `casual_sessions` is added to the `supabase_realtime` publication so a
  session's owner-facing list (web and native `HomeScreen`/`My Sessions`)
  reflects a close/delete without a manual refresh.
- Web and native session screens additionally broadcast `session_closed` /
  `session_deleted` over the existing `stopwatch:<code>` channel when the
  owner acts from within an active session, so already-connected
  participants react immediately rather than waiting to hit `SESSION_CLOSED`
  on their next action. As with all Broadcast traffic on this channel
  (ADR 0017), this is treated as an invalidation hint, not an authorization
  boundary — the RPCs are the actual enforcement point.

## Consequences

- Close is preferred over delete when a creator just wants to stop new
  activity but keep results (e.g. a mis-timed race that's still worth
  publishing); delete is for outright removal.
- A closed session's data is retained indefinitely, same as a stopped one —
  this ADR does not add automatic cleanup of old sessions.
- `casual_sessions` direct reads now work as originally intended by RLS
  ("owner can manage own sessions"); no other table's grants change.
