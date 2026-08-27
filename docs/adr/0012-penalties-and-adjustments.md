# ADR 0012: Penalties And Adjustments As A Stacked Overlay On Derived Standings

## Status

Accepted.

## Decision

Add an explicit, auditable penalty/adjustment primitive that officials apply on top of crossings-derived standings, without ever mutating or deleting a crossing (ADR 0001):

- A `race_entry_penalties` table records one row per applied penalty: `entry_id`, `type` (`time_penalty` | `lap_penalty` | `relegation` | `note`), `value` (seconds for `time_penalty`, laps for `lap_penalty`, `null` for `relegation`/`note`), `reason` (required, unlike rider status's optional reason), `set_by`/`set_at` (attribution, written only by a `before insert` trigger, never accepted from the client).
- Unlike rider status (#66/ADR 0007), which is a single current value plus a separate history table, penalties are inherently cumulative — an entry can carry several stacked penalties (e.g. a time penalty and a note). So `race_entry_penalties` is the record itself: rows are only ever inserted or deleted (to undo a mistaken entry), never updated.
- `apps/web/src/lib/standings.ts` (`computeStandings`) takes an additional `penalties` argument and applies penalties as a final adjustment step, after the raw per-lap/gap computation: a `time_penalty` adds its seconds to an `effectiveAt` value used only for ranking/gap; a `lap_penalty` subtracts from an `effectiveLaps` value used only for ranking; a `relegation` sorts the entry after all riders in its same-`effectiveLaps` tier. Ranking, position, and gap text are computed from these effective values. The raw, factual `laps`, `lastCrossingAt`, and `lastLapMs` fields on `StandingRow` are untouched by any penalty — this is the "raw vs. adjusted" split called for in the issue, expressed as separate fields on the same row rather than two parallel result sets, since only the adjusted view is shown by default today.
- The scorer UI (`apps/web/src/app/score/[raceId]`) adds a `+ Penalty` control per entry that records a type, value (where applicable), and required reason, and lists/removes existing penalties for that entry.
- Public live/announcer views render a red `Penalty` badge next to a penalized rider's name with a tooltip/title summarizing each applied penalty and its reason.

## Rationale

RACE RESULT and other timing platforms explicitly separate penalties from raw splits; SplitSync's only prior lever to affect a result was deleting or editing a crossing, which destroys the factual timing record. Modeling penalties as their own table (rather than columns on `entries`, as was chosen for status) matches the issue's schema sketch and reflects that penalties genuinely stack — a rider can receive a time penalty and a separate disciplinary note in the same race, and organizers need to see/undo each independently.

Penalties/adjustments are an asserted organizer/official fact, same category as a crossing or a status change, so persisting them does not violate ADR 0001's "never persist a calculated standing" rule — what's persisted is the penalty itself, not the resulting position.

The `official` `event_members` role (added read-only in #75) gets its first write capability here: managing `race_entry_penalties`. The issue's own motivation ("officials... need to apply a time penalty") is that role's real-world mandate, and today it had no write path at all, making it largely decorative. `canManagePenalties()` in `useEventAccess.ts` is deliberately a separate helper from `canManageEvent()` (owner/organizer) so this one expansion doesn't implicitly grant officials roster or race-lifecycle control.

## Consequences

- `StandingRow` gained `penalties`, `timePenaltySeconds`, `lapPenalty`, and `relegated` fields; any future consumer of `computeStandings` that cares about final classification must pass the `penalties` argument (it defaults to `[]`, so existing call sites keep working unpenalized) and should use the row's `position`/`gapText` (already adjusted) rather than re-deriving from `laps`/`lastCrossingAt` if it wants penalty-aware output.
- The gap text for two riders in the same effective-lap tier now compares penalty-adjusted time to the leader's penalty-adjusted time, rather than each rider's raw crossing time on a specific raw lap number. When no lap penalty is in play (the overwhelmingly common case) this is identical to the pre-#71 calculation; once a lap penalty changes a rider's effective lap tier relative to their raw laps, the "time at that lap" comparison is necessarily an approximation, which is acceptable for unofficial live classification.
- `useRaceData` now also fetches `race_entry_penalties` (scoped to the race's current entry ids, since the table has no `race_id` column) and subscribes to it unfiltered via Realtime, refetching on any change — consistent with the existing "refetch everything on any change" tradeoff for `crossings`/`races`, and now also `entries` (previously not subscribed, needed so a status or roster change on another device propagates live without a manual refresh).
- There is no UI to browse a full penalty audit trail beyond the current list of active rows (no "removed penalty" history), same gap already noted for `race_status_changes`/`entry_status_changes` in prior ADRs.
- This issue does not implement a formal protest/appeal workflow or automatic penalty detection, per its stated scope.
