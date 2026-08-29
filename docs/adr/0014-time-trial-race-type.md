# ADR 0014: Time Trial Race Type As Solo Start/Finish Timing

## Status

Accepted.

## Context

SplitSync's only race format so far is mass-start lap racing (velodrome, cyclocross): every rider shares the same start instant, and standings come from comparing lap counts and crossing order (ADR 0001), optionally overlaid with points-race scoring (ADR 0011).

Downhill MTB, ski racing, and similar disciplines use a different format entirely: riders go **solo, one at a time**, in a fixed start order, and are ranked by their own elapsed time between an individual start and an individual finish — not by comparing them to anyone running at the same moment. There is no shared "lap count" concept; a rider either hasn't started, is on course, or has finished.

This ADR defines how that format fits into SplitSync's existing data model and UI conventions, and deliberately scopes the first milestone down to keep the change small.

## Scope decision: free-start (multiple riders on course simultaneously)

Riders are released one at a time by an operator tap, but any number may be on course simultaneously — each with their own independent elapsed timer. This supports real alpine/ski start protocols where the starter releases a new rider as soon as the previous rider has cleared the first gate, without waiting for a finish.

Dual/pair starts (two riders released together and timed as a pair) remain deferred.

Starts are always **operator-triggered** — immediate tap or countdown-to-tap. No clock-scheduled interval starts.

## Decision

### Data model — reuse `crossings`, add two columns to `races`

Per ADR 0001's closing note ("scoring rules more complex than mass-start laps... require a separate overlay rather than mutating base crossings"), a time trial is scored as an overlay on the exact same `crossings` + `entries` facts, with **no new fact table and no changes to `crossings` or `entries`**:

- A rider's **start** is their 1st non-deleted crossing (ordered by `client_recorded_at`); their **finish** is their 2nd. This is the same "Nth crossing" indexing `standings.ts` already uses for lap numbers — a time-trial race is simply one where every rider has at most two "laps," and the thing being compared is the gap between them (elapsed time) instead of how many of them there are.
- `races` gains two columns, following the `is_points_race` precedent (ADR 0011) of per-race scalar config rather than a join table:
  - `is_time_trial boolean not null default false`
  - `time_trial_countdown_seconds int not null default 5` — length of the optional on-screen/audible start countdown; `0` disables the countdown UI entirely and every start is an immediate tap.
- A check constraint, `check (not (is_points_race and is_time_trial))`, makes the two race types mutually exclusive at the database level: points-race scoring is a lap-counting concept and doesn't compose with elapsed-time solo timing.
- `laps_planned` stays `null` for time-trial races, same convention already used for open-ended "timed" mass-start races.
- `clone_event()` is updated to copy both new columns (and, while that function is being touched anyway, to also copy the pre-existing `is_points_race` config columns it was missing — noted here as a drive-by fix, not a new decision).
- No RLS changes: the new columns are plain fields on `races`, already covered by the existing owner-write / published-spectator-read policies.

### Scoring semantics

A pure module (`apps/web/src/lib/timeTrial.ts`, mirroring `pointsRace.ts`'s shape — no I/O, only derivations from `Crossing[]`/`Entry[]`) derives, per entry with `status = 'ok'`:

- **`queued`** — zero crossings.
- **`running`** — exactly one crossing (`startedAt`).
- **`finished`** — two crossings (`startedAt`, `finishedAt`, `elapsedMs = finishedAt - startedAt`).
- **3+ crossings** — treated as a data-entry error, not a third lap: flagged for organizer review rather than silently scored, with a best-effort elapsed time still computed from the first two crossings so the UI has something to show while the organizer corrects it via the existing crossing-correction/undo tooling (ADR 0010). No new correction UI is introduced for this.

Entries with `status in ('dns', 'dnf', 'dsq')` are excluded from queue/ranking and listed separately, identically to how `standings.ts` already handles those statuses.

Ranking is ascending `elapsedMs` among `finished` entries — the opposite comparison from mass-start (`standings.ts` ranks by most-laps-then-earliest-time). This is why the live board renders a **different table entirely** rather than an overlay section: unlike the points-race overlay, which supplements the existing mass-start table, time-trial ranking replaces it outright, since the two ranking philosophies (lap count vs. elapsed time) are mutually exclusive per race by construction.

The start-order queue sorts entries by bib using a natural/numeric sort (bib "9" sorts before "10", not after, even though it's stored as text) rather than a lexicographic string sort — this is the literal meaning of "bib is the start order" and needs to be exact, since organizer bib numbers are rarely zero-padded.

### Progress bar semantics

While an entry is `running`, both the organizer scorer and the spectator live board show a live elapsed timer plus a progress bar:

- Reference time = the fastest `finished` elapsed time recorded so far in the race.
- Bar width = `min(100%, elapsedMs / referenceMs)`.
- Before anyone has finished, there is no reference time yet — the bar renders as an indeterminate/pulsing indicator instead of a fabricated percentage.
- Once a running rider's elapsed time exceeds the reference, the bar stays full and an explicit "+N.Ns over best" indicator is shown instead of letting the bar imply the rider is "done."

This gives spectators and organizers a meaningful "how's this run going" signal without needing course-specific splits or any new instrumentation — it's derived entirely from crossing timestamps already being recorded.

### UI shape

Following the project's existing spectator/organizer styling split (`globals.css`'s `race-*` vs. `race-*--muted` tokens):

- **Organizer scorer** (`/score/[raceId]`, muted styling) and the **mobile tracker** (same flow, native): three row-style sections — **Up Next** (queue), **On Course** (all current runners, each with their own live timer, progress bar, and Finish button), **Finished** (results so far). Start offers both an immediate tap and a countdown-then-tap (length from `time_trial_countdown_seconds`, with an audible beep each second and a distinct final beep, cancelable mid-countdown). Start controls are always visible as long as the queue is non-empty — any number of entries may be `running` simultaneously, each tracked by an independent per-rider timer sub-component.
- **Spectator live board** (`/live/[raceId]`, full red/yellow styling): a "Now Running" hero row (live timer + progress bar), an "Up Next" row list, and a results table ranked by elapsed time, with the same DNS/DNF/DSQ handling convention as the mass-start board.
- **Results page** (`/results/[eventId]`): labels these races "Time trial" instead of "N laps" / "Timed race".
- **Announcer view** (`/announce/[raceId]`): must not render lap-based standings for a time-trial race — at minimum it shows the elapsed-time results table and the current on-course rider. A fully announcer-optimized time-trial layout is an acceptable fast-follow, but misleading lap counts are not.
- Web ships first; the mobile tracker gets the same Up Next / On Course / Finished flow and Start/Finish taps as a follow-on, reusing the existing offline crossing queue (`crossingQueue.ts`) completely unchanged — a start and a finish are just two ordinary `recordCrossing()` calls, so no offline-queue or idempotency changes are needed for this feature at all.

## Rationale

Modeling start/finish as ordinary crossings — rather than inventing a `time_trial_starts` table or adding start/finish columns to `entries` — keeps every existing invariant intact for free: idempotent retries via `client_id`, soft-delete undo, the correction audit trail (ADR 0010), realtime propagation, and RLS all already work correctly for time-trial crossings with zero additional code, because nothing about *how* a crossing is stored changed — only how the existing crossing sequence is interpreted for a race flagged `is_time_trial`.

An additive boolean-plus-overlay on `races` (matching ADR 0011's precedent) was chosen over introducing a `races.kind` enum because the two race types remain structurally similar (both are `races` rows with entries and crossings) and exclusive rather than layered — a simple mutual-exclusion check constraint captures that relationship without forcing every existing `is_points_race`-shaped query to be rewritten against a new enum.

Countdown-then-tap (rather than a fully clock-scheduled interval-start system) was chosen because it matches how these events are actually run — a human starter watches the course and releases the next rider when it's clear, not on a rigid timer — and because it requires zero new scheduling infrastructure: the countdown is a client-side UX affordance around the same single `recordCrossing()` call used for an immediate start.

## Consequences

- No changes to `crossings` or `entries` schemas, RLS, or the offline crossing queue.
- `is_points_race` and `is_time_trial` are mutually exclusive per race by database constraint; a race is either mass-start (optionally with points scoring) or time-trial, never both.
- The live board renders time-trial races with an entirely different component/table than mass-start races, rather than an overlay section — this is a deliberate divergence from the points-race pattern, since elapsed-time ranking and lap-count ranking aren't compatible views of the same data.
- A rider recording a 3rd+ crossing in a time-trial race is treated as an error state requiring organizer correction, not a new lap — this is a real edge case (accidental re-tap) that the scorer UI must surface clearly rather than silently misscoring.
- Dual/pair starts, and any clock-scheduled/interval-start mode, are out of scope for this milestone and will need their own follow-up ADR if/when built.
- `clone_event()` must stay in sync with any future additional time-trial config columns, the same maintenance burden that already exists (and was previously unmet) for points-race columns.
