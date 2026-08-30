# ADR 0022: Casual Session Results Permalink — Anonymous Read of Finished Sessions and Event-Log Retention

## Status

Accepted.

## Context

ADR 0017 defined the casual stopwatch surface: sessions joined by a 6-char
code, an append-only event log as the source of truth, and a 4-hour join
expiry. Every access path it defined is participant-scoped: `join_casual_session`
rejects stopped or expired sessions, and `get_session_state` requires a valid
`participant_id` bearer token.

That leaves a hole after a session ends (#226). The native app's "Share
Result" button shared the *join* link (`/stopwatch/s/<code>`), which stops
working the moment the session is stopped — exactly when people want to share
the outcome. There was no way for anyone (including participants) to see the
lap table once the session was stopped on another device or the 4-hour expiry
passed, and no way to get the data out of the system at all.

## Decisions

### 1. One anonymous, read-only results RPC keyed by the code

Migration `20260830000003_casual_session_results.sql` adds a single
security-definer RPC:

```
get_casual_session_results(p_code text) → json
```

- Callable by the anon role. Knowing the 6-char code is the only credential —
  the same trust model as joining (ADR 0017 §2): the code is an out-of-band
  secret with ~1.6 billion combinations.
- **Read-only.** It adds no write path. RLS stays enabled on all three casual
  tables with zero direct anon grants; this remains the only new entry in the
  RPC surface.
- **Terminal sessions only.** It returns data when `status = 'stopped'` OR
  `expires_at < now()`. Unknown codes and still-live sessions raise the same
  generic `RESULTS_NOT_AVAILABLE` error, so the code space cannot be probed to
  distinguish "no such session" from "session in progress". Live-session state
  remains reachable only through the participant-token paths.
- **It ignores `expires_at` for reading.** Expiry gates *joining*, not
  *remembering*: results remain readable after the 4-hour join expiry.

### 2. Participant bearer tokens are never exposed

`participant_id` doubles as the write bearer token for
`record_session_event` (ADR 0017 §2). A public read endpoint must not leak
it. The RPC therefore:

- resolves actor display names onto each event server-side (`actor_name`),
  instead of returning `actor_participant_id`;
- returns participants as `{ display_name, is_owner }` only — no ids, no
  `client_id`.

### 3. Results are derived, never persisted

The results payload is the raw session header, participants, and ordered
event log. Lap splits, cumulative times, best lap, and total time are derived
client-side by replaying the log (same derivation as the live clients,
respecting `reset` boundaries). No standings/laps/total column is added —
domain invariant #2 holds.

### 4. Data lifecycle: event log retained after expiry

Nothing in the schema deletes `casual_session_events` at expiry today; the
only deletion path is an owner `reset`. This ADR makes that retention a
**contract**: the results permalink (`/stopwatch/s/<code>/results`) must keep
working after the 4-hour join expiry. Any future cleanup job (ADR 0017 §6
sketched a 30-day purge of stopped sessions) must retain stopped sessions and
their events for at least that retention window and may not run before a
session is terminal.

### 5. Surfaces

- **Web** (`apps/web/src/app/stopwatch/s/[code]/results`): spectator-style,
  read-only page — session name, total, lap table (split / cumulative / best
  lap / actor), copy-to-clipboard, and CSV download. No session controls.
- **Native** (`apps/stopwatch`): the stopped-session "Share Result" now shares
  the results permalink plus a lap summary text, and a "Share CSV" action
  shares the lap table as CSV through the OS share sheet. The solo stopwatch
  gets the same text/CSV sharing (no server involved — solo laps never leave
  the device).
- **Web solo** (`/stopwatch`): copy and CSV download of the local lap table.

CSV shape is identical across surfaces:
`lap,split,total,split_ms,total_ms[,recorded_by]` — human-readable clock
strings plus raw milliseconds, with `recorded_by` only for shared sessions.

## Rationale

**Why a code-keyed anonymous read instead of reusing `get_session_state`?**
`get_session_state` requires a `participant_id`, but the whole point of a
results permalink is that recipients were never participants. Requiring a
join to view results would also be impossible: joining is rejected once the
session stops.

**Why only terminal sessions?**
A live read keyed only by the code would let a non-participant silently watch
a session in progress. Participation (and the participant strip showing who
is present) is the live contract; results are the after contract. Expired
sessions are included because they are equally terminal — `join` already
rejects them regardless of status.

**Why client-side CSV instead of a server export endpoint?**
The payload is small (bounded by the event rate limit and session lifetime),
the derivation logic already exists in every client, and a server endpoint
would be a second place to get the derivation wrong. A permalink + client
export keeps the API surface at one read RPC.

## Consequences

- New migration `20260830000003_casual_session_results.sql` (RPC only; no
  schema or policy changes).
- New public web route `/stopwatch/s/[code]/results` with no auth dependency.
- Event-log retention beyond `expires_at` is now a documented contract that
  constrains any future cleanup/purge job.
- The native "Share Result" contract changes from join-link to
  results-permalink + summary text.
- `docs/architecture.md` casual-stopwatch section updated with the new RPC
  and the results lifecycle.
