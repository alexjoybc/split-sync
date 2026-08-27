# ADR 0006: Crossing Correction And Audit Trail

## Status

Accepted.

## Decision

Add two audited correction primitives for `crossings`, alongside the existing plain soft-delete (`deleted_at`), following the same "enforce in Postgres, not just the UI" convention established for race lifecycle (ADR 0005):

- `correct_crossing(crossing_id, bib, client_recorded_at, reason)`: edits a crossing's `bib` and/or `client_recorded_at`. Requires a non-empty `reason` and that the caller owns the race's event.
- `restore_crossing(crossing_id, reason)`: clears `deleted_at` on a soft-deleted crossing. Requires a non-empty `reason`, event ownership, and that the crossing is currently deleted.
- Both functions are `security definer`, mirroring `reopen_race()`.
- A new append-only `crossing_corrections` table records every crossing change (`bib`, `client_recorded_at`, or `deleted_at`): the field changed, previous/new value, actor, timestamp, and reason. It is populated by an `after update` trigger (`crossings_correction_audit`, `security definer`) so organizers cannot write to it directly — it is read-only via RLS, owner-scoped through `crossings -> races -> events`.
- A `before update` trigger (`crossings_correction_guard`) rejects any change to `bib` or `client_recorded_at`, or any restore (`deleted_at` not null -> null), unless a transaction-local `splitsync.correction_reason` setting is present — which only `correct_crossing()`/`restore_crossing()` set. A bare client `update crossings set bib = ...` is rejected with an explanatory error, the same way a bare `finished -> active` race update is rejected today.
- Plain soft-delete (`deleted_at` null -> not null, the existing one-tap "Undo") is deliberately left unreasoned and unchanged — the guard does not require a reason for it — but it is still logged to `crossing_corrections` (with `reason` null) for a complete history.
- Neither function ever touches `crossings.id` or `crossings.client_id`: corrections change what is displayed, never the row's identity or offline-retry idempotency key.
- No scoring-engine changes: `apps/web/src/lib/standings.ts` already derives standings from non-deleted crossings by `bib`/`client_recorded_at` on every recompute, so edits and restores are picked up automatically via the existing Realtime refetch.

## Rationale

Volunteer scoring reliably produces a handful of misdials and fat-fingered taps per event (Zone4, RACE RESULT). Before this change the only correction primitive was soft-delete; fixing a wrong bib or timestamp required either accepting the error or a direct database edit with no record of who changed what or why. Reusing the `security definer` + transaction-local-setting + guard-trigger pattern from race lifecycle gives the same guarantee here: the rule holds for any client (web scorer today, a future mobile correction UI, or a raw API call), and the audit trail cannot be bypassed by skipping the RPC.

`crossing_corrections` is a separate table from `race_status_changes` (per the note in ADR 0005) because it audits a different entity at a different grain (per-crossing field changes vs. per-race status transitions), but follows the same shape and RLS pattern for consistency.

## Consequences

- The web scorer's recent-crossings list gains "Edit" (bib/time, with required reason) and a "Recently removed" list with "Restore" (with required reason); both call the new RPCs. Mobile is intentionally out of scope for this issue — mobile undo (soft-delete only) is unchanged.
- `useRaceData` now also fetches a bounded window (20) of recently soft-deleted crossings so the scorer can offer restore without an unbounded "show deleted" query.
- Organizers can view the correction history in `crossing_corrections` (owner-scoped read), but there is no dedicated UI to browse it yet beyond what the edit/restore forms ask for — a candidate future organizer feature, same as `race_status_changes` history today.
- Because `correct_crossing`/`restore_crossing` are `security definer`, they bypass RLS for their own `UPDATE`, but the `crossings_correction_guard` trigger still fires for every write path and enforces the reason requirement regardless.
