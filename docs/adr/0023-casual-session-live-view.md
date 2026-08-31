# ADR 0023: Casual Session Live View

## Status

Accepted.

## Decision

Live casual stopwatch viewers use the code-keyed, security-definer
`get_casual_session_live_view(p_code)` RPC. It returns only a sanitized session
header, display names, owner markers, and event log with resolved actor names.
It never returns session, client, or participant identifiers.

The live view is available while a session is waiting, running, or newly stopped
(until its join expiry). It has no participant row, does not count against
`participant_cap`, stores no bearer token, and cannot call
`record_session_event`. Expired sessions use the existing results permalink.

Web and native clients subscribe to `stopwatch:<code>` Broadcast as an
invalidation hint only, then refresh from the RPC. Broadcast payloads are never
treated as authoritative because a code-keyed public channel is not a write
authorization boundary.

## Consequences

- `/stopwatch/s/<code>/live` is a large, controls-free rider display.
- Existing participant timing and bearer-token semantics remain unchanged.
- The added RPC is read-only and keeps direct table access blocked by RLS.
