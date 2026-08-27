# ADR 0007: Rider Status (DNS/DNF/DSQ) As An Overlay On Derived Standings

## Status

Accepted.

## Decision

Add explicit rider status to `entries` — `ok` (default), `dns`, `dnf`, `dsq` — as an asserted organizer fact, distinct from the crossings-derived standings described in ADR 0001:

- `entries` gains `status` (`entry_status` enum), `status_reason`, `status_set_by`, and `status_set_at`. `status_set_by`/`status_set_at` are attribution columns written only by a trigger (`entries_write_guard`), never directly by a client.
- An append-only `entry_status_changes` audit table (mirroring `race_status_changes` from ADR 0005) records every status transition with previous/new status, reason, actor, and timestamp, populated by an `after update` `security definer` trigger.
- `apps/web/src/lib/standings.ts` (`computeStandings`) treats `status` as an overlay on top of the crossings-derived rows: entries with `status !== "ok"` are excluded from ranked position (`position: null`, no gap) but still returned in the list, sorted after all ranked riders, so the UI can render a status badge instead of silently dropping or misranking them.
- Roster identity fields (`bib`, `name`, `team`, `category`) remain locked to `race.status = 'upcoming'` (ADR from #64's roster lock), but `status`/`status_reason` must be settable while a race is `active` (DNF/DSQ happen mid-race) or `finished` (late corrections). RLS alone can't express that column-level split, so the `entries` update policy was relaxed to owner-only and the roster-lock is now enforced by the `entries_write_guard` trigger, which compares old/new roster fields and raises if they changed outside `upcoming`.
- The scorer UI (`apps/web/src/app/score/[raceId]`) exposes an OK/DNS/DNF/DSQ control per entry regardless of race status, and disables crossing capture for a statused entry. Public live/results/announcer views render a status badge for statused riders instead of rank/gap.

## Rationale

Every rider that finishes "0 laps" today reads the same on the public board whether they never started, crashed out, or simply haven't crossed yet — misleading for spectators and useless for organizers who need to record it. Per the product's timing-platform gap analysis, DNS/DNF/DSQ are table stakes.

Status is not a derived standing — it's an organizer-asserted fact, same category as a crossing, so persisting it does not violate ADR 0001's "never persist a calculated standing" rule. It's modeled as columns on `entries` (current state) plus a separate audit table (history), following the same split already established for race-level lifecycle status in ADR 0005, rather than introducing a new `race_entry_statuses` table as the issue's schema sketch first suggested — reusing the existing `entries` row keyed by race entry avoids an extra join on every standings read.

## Consequences

- `StandingRow.position` is now `number | null`; every consumer of `computeStandings` must handle `null` (rendered as a status badge) instead of assuming a numeric rank.
- Splitting the entries `for all` policy into `insert`/`delete` (upcoming-only) and `update` (owner-only, any race status) policies means RLS no longer blocks a roster edit attempt during an active race by itself — that protection now lives entirely in the `entries_write_guard` trigger. Any future write path that bypasses triggers (there is none today) would not be protected.
- There is no UI yet to browse `entry_status_changes` history; organizers currently only see the latest reason via the browser `prompt()` pre-fill. A richer status-change log view is a candidate future Help/organizer feature, same gap noted for `race_status_changes` in ADR 0005.
- This issue intentionally does not address blocking or reconciling status changes against a finalized/published race — that is #72's scope, coordinated but not implemented here.
