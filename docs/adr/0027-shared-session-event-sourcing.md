# ADR 0027: Shared Sessions Use a Multi-Timer Event Log and Cached State

## Status

Accepted.

## Decision

ADR 0017's single-stopwatch `casual_sessions` schema is replaced by
`shared_sessions`, `shared_session_participants`, and `shared_session_events`.
A shared session may contain multiple named timers. Its append-only event log
is canonical; `shared_sessions.state` is a JSONB cache reduced inside the same
transaction as each accepted event and is never an independent write target.

Events have a client UUID idempotency key, a per-session server sequence, an
optional timer id, a typed payload, and both client and server timestamps.
Supported types are timer control (`start`, `pause`, `lap`, `reset`,
`complete`), timer structure (`timer_added`, `timer_removed`,
`timer_renamed`, `timers_reordered`), and session configuration
(`session_renamed`, `repeat_config_set`). The cache has a `timers` array,
`timer_order`, optional `repeat_config`, and the accepted sequence. Timer lap
data remains event-derived input, not a relational standing or result.

The security model remains narrow security-definer RPCs: authenticated owners
create, close, delete, and may list only their own sessions; anonymous joiners
use the join, event, cached-state, results, and live-view RPCs. Tables have RLS
and no direct anon grants. Participant bearer identifiers are omitted from the
cached-state and public read payloads. Owner-only structural events prevent a
joiner from deleting or changing another timer; any participant can operate a
timer through control events.

The Broadcast channel convention changes to `session:<code>`. Clients broadcast
the accepted event returned by `record_session_event`, never the full cache.
The new events and participants tables are in `supabase_realtime` for
operational parity, but Broadcast remains the in-session transport. The hourly
expiry job stops expired waiting/running sessions and purges stopped sessions
after 30 days.

## Consequences

- Existing casual-session data is intentionally dropped; it is ephemeral.
- Clients must migrate to the new RPC signatures and event names in later
  milestone issues.
- Reconnect/live reads use the cached JSON snapshot, while audit/export can
  replay the immutable event log.
- ADRs 0017, 0022, 0023, and 0024 are superseded only for their
  `casual_*` shared-session schema/RPC references; their separate-app, public
  results, live-view, close/delete, and local-solo decisions otherwise remain.
