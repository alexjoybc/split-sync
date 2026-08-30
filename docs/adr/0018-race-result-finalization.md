# ADR 0018: Result Finalization And Publishing Workflow

## Status

Accepted.

## Decision

Add an explicit "publish" step, distinct from the existing race lifecycle (ADR 0005: `upcoming -> active -> finished`):

- `races` gains two columns: `results_published_at` (timestamptz, null until published) and `results_under_revision` (boolean, default false).
- A new `security definer` function `finalize_and_publish_race(race_id)` sets `results_published_at = now()` and clears `results_under_revision`. It requires the race to be `finished` and the caller to be the event owner or an `organizer`-role event member — the same authorization shape as `reopen_race()`.
- `reopen_race()` (ADR 0005, extended by ADR 0006) is re-created to also clear `results_published_at` and, when the race had been published, set `results_under_revision = true`. Reopening a race that was never published behaves exactly as before.
- Neither column participates in the `status` state machine, so the existing `races_lifecycle_guard` trigger (which only fires on status changes) does not cover them. A new `races_publish_guard` trigger rejects any direct write to either column unless a transaction-local `splitsync.publish_action` flag is set — only `finalize_and_publish_race()` and `reopen_race()` set it. A bare client `update races set results_published_at = now()` is rejected, mirroring how `finished -> active` is guarded by `splitsync.reopen_reason`.
- A new web route, `apps/web/src/app/score/[raceId]/finalize`, gives the organizer a pre-publish review checklist before calling `finalize_and_publish_race()`: riders with no crossings, riders whose last lap looks unusually slow relative to the field (mass-start only), unresolved DNS/DNF/DSQ statuses (no reason recorded), a summary of any penalties/adjustments applied, and — for time-trial races — riders still queued/running and riders in the `needs-review` phase (3+ crossings) instead of the mass-start-specific checks. Category podium summaries only apply to mass-start races; time trial has no category grouping today.
- The checklist is advisory, not a hard gate: SplitSync's results are explicitly unofficial (see AGENTS.md), so publishing remains allowed even with open checklist items — this is a sanity check for the organizer, not a certification workflow.
- The live board, results hub, and announcer view distinguish three states via shared copy (`classificationCopy()` in `live/[raceId]/page.tsx`): unpublished ("Unofficial live standings" / "Live unofficial classification"), published ("Final classification" / "Final classification · Published \<time\>"), and under revision ("Results under revision"). The mass-start live board previously had a real copy bug — a kicker read "Official live standings" while the footer of the same page read "unofficial" — fixed as part of this change.

## Rationale

Every race today either looks "live" forever or silently becomes indistinguishable from live once `finished`. There was no organizer-asserted "this is done, I reviewed it, publish it" moment, and the live board's own copy contradicted itself about whether results were official. Zone4 and RACE RESULT both treat publication as a deliberate, reviewed action; this ADR adds the minimum version of that for SplitSync's segment without implying certified/official timing status.

`results_published_at`/`results_under_revision` are modeled as plain columns on `races`, not a new state in the `race_status` enum, because "published" is orthogonal to whether the race is currently accepting crossings — a `finished` race can be published or not, and reopening (which is already a legal `finished -> active` transition) needs to interact with publish state without inventing new status values or duplicating the lifecycle guard's transition table.

The review checklist is intentionally computed client-side from data that's already loaded by `useRaceData` (crossings, entries, penalties) rather than a new server-side validation endpoint — consistent with the "derive, don't persist calculated state" pattern (ADR 0001) and the fact that none of these checks are hard requirements.

**Time-trial penalties are explicitly out of scope for this issue.** `apps/web/src/lib/timeTrial.ts` has no `penalties` parameter and the time-trial live board never renders penalty badges — a time_penalty/lap_penalty/relegation applied to a TT entry today has zero effect on that race's classification. This ADR does not fix that; the finalize review screen instead surfaces a warning ("penalties are not yet applied to time-trial classification") when a TT race has any recorded penalties, so an organizer is not silently misled, and a follow-up issue is expected to define the semantics (a `lap_penalty`/`relegation` has no obvious meaning in a start/finish-only format) and wire penalties into `computeTimeTrialResults`.

## Consequences

- Any surface (web, a future connector) that wants to know "is this race's classification final" reads `results_published_at`/`results_under_revision` directly off `races` rather than inferring it from `status` alone.
- Reopening a published race is the only way to unpublish it; there is no standalone "unpublish" action, matching the existing pattern where `reopen_race()` is the sole path back from `finished`.
- The review checklist's "suspicious gaps" heuristic (`flagSuspiciousGaps` in `apps/web/src/lib/standings.ts`) is a simple median-multiple comparison, not a statistically rigorous outlier detector, and only activates once a race has at least 3 riders with recorded lap times. It is a starting point, not a final algorithm.
- Time-trial races do not get penalty visibility in their classification or in the review checklist's penalty warning beyond "these exist, review manually" — tracked as a fast-follow, same posture ADR 0007 took toward this same issue's scope for rider status.
- There is still no UI to browse `race_status_changes`/reopen history beyond the reopen confirmation itself (a gap already noted in ADR 0005/0007); this ADR does not add one for publish/unpublish events either — `results_published_at`/`results_under_revision` on the current row is the only signal, not a full history.
