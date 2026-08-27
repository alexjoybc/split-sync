# ADR 0005: Race Lifecycle Enforcement At The Database Level

## Status

Accepted.

## Decision

Enforce the race lifecycle (`upcoming -> active -> finished`, with an explicit, audited `finished -> active` reopen) in Postgres, not only in the web/mobile UI:

- A `before update` trigger (`races_lifecycle_guard`) on `races` rejects any status transition other than `upcoming -> active`, `active -> finished`, and a flagged `finished -> active`. It also sets `started_at`/`finished_at` consistently regardless of which client issues the update.
- `finished -> active` is only permitted when a transaction-local `splitsync.reopen_reason` setting is present, which only the `reopen_race(race_id, reason)` Postgres function sets. A bare client `update races set status = 'active'` on a finished race is rejected.
- `reopen_race()` is `security definer`, requires a non-empty reason, verifies the caller owns the race's event, and only operates on races that are currently `finished`.
- An `after update` trigger (`races_lifecycle_audit`) records every status change (start, finish, and reopen) in a new `race_status_changes` table with the previous/new status, actor, and optional reason.
- The `crossings` RLS insert policy now additionally requires `races.status = 'active'`. Select/update/delete stay owner-scoped only, so corrections remain possible after a race finishes.

## Rationale

Zone4 and RACE RESULT treat "is this race currently timing" as a hard gate. Today's UI already hides the crossing-capture grid outside `active`, and hides the finish/start buttons outside their valid states, but nothing stopped a direct API call, a stale client, or a UI bug from writing a crossing against an `upcoming` or `finished` race, or from silently reopening a finished race without leaving a trace.

Putting the guard in a trigger means it holds regardless of which surface (web scorer, mobile tracker, a future connector, or a raw API call) performs the write, and regardless of future UI bugs. Requiring a reason for reopen, and logging it via `security definer` (bypassing the otherwise read-only `race_status_changes` RLS), keeps the audit log tamper-resistant without introducing a full corrections model.

`race_status_changes` is intentionally minimal. Issue #65 (crossing correction and audit trail) may introduce a broader `crossing_corrections` table for per-crossing edits; this table only covers race-level status changes and is expected to coexist with it.

## Consequences

- Any future client integration automatically inherits the lifecycle rules; there is no way to bypass them short of direct database access with elevated privileges.
- Reopening a race is only possible via `reopen_race()`, which requires a reason. There is currently no UI to browse `race_status_changes` history beyond what the reopen confirmation asks for; that is a candidate future Help/organizer feature.
- The `crossings` "organizer manage crossings" policy was split into per-command policies (`select`, `insert`, `update`, `delete`) because the insert path needs the additional active-race condition while the others do not.
- Offline crossing capture on mobile/web can still queue a crossing against a race that finishes mid-capture; the RLS insert rejection surfaces as a sync error and the crossing stays queued until the race is reopened (or the scorer discards it), rather than being silently dropped or duplicated.
