# Architecture

## Data Model

| Table | Purpose |
| --- | --- |
| `events` | Event metadata, publication status, provider-neutral organizer `owner_id` |
| `participants` | Event-level racer roster: bib, first/last name, team, category, sex, check-in timestamp |
| `races` | A race/category within an event, planned laps, lifecycle state, and optional velodrome points race scoring config or time trial config |
| `entries` | Roster participants assigned to a specific race; roster identity frozen on start, status settable throughout |
| `crossings` | A recorded line crossing: race, bib, client UUID, client/server timestamps, source |
| `race_status_changes` | Append-only audit log of every race status transition, written by a trigger |
| `crossing_corrections` | Append-only audit log of every crossing edit/restore, written by a trigger |
| `entry_status_changes` | Append-only audit log of every entry status (DNS/DNF/DSQ) transition, written by a trigger |
| `race_entry_penalties` | Time/lap penalties, relegations, and notes applied to a race entry — the record itself (insert/delete only), not an audit log of it |
| `event_members` | Accepted volunteer grant: event, JWT-subject `user_id`, role |
| `event_invites` | Single-use, time-limited invite link: event, role, token, expiry |

`crossings` intentionally does not foreign-key `bib` to `entries`. It keeps a factual audit record and allows future connector ingestion. The current UI only presents assigned entries as tappable inputs.

## Backend API

`apps/web/src/app/api` contains server-side Next.js route handlers deployed as
Vercel Functions in the existing `split-sync-web` project. This is SplitSync's
HTTP API surface; it is hosted at `https://splitsync.org/api/...` rather than
in a separate backend deployment. `GET /api/health` is unauthenticated for
deployment health checks.

Authenticated handlers require a Supabase access JWT in `Authorization:
Bearer <token>`. `apps/web/src/lib/server/supabaseApi.ts` validates the token
with Supabase and sends the same token on its downstream Supabase request.
RLS remains the authorization boundary, so API handlers never use a
`service_role` key or reimplement event-role checks. See ADR 0013.

## Lifecycle

```text
event: draft -> live -> finished
race:  upcoming -> active -> finished
```

- A draft is visible only to its owner.
- Publishing an event makes its event, races, entries, and crossings readable to spectators.
- Starting a race sets `started_at` and prevents entry writes.
- Finishing a race sets `finished_at`.
- A crossing uses device time for ordering and server time for audit/replication.
- Only `upcoming -> active`, `active -> finished`, and an explicit, reasoned
  `finished -> active` reopen are legal transitions. Every other transition
  (e.g. skipping straight to `finished`, or reopening without a reason) is
  rejected at the database level by the `races_lifecycle_guard` trigger, not
  just hidden in the UI. See ADR 0005.
- Reopening a finished race is done through the `reopen_race(race_id, reason)`
  Postgres function, which requires a non-empty reason, checks event
  ownership, clears `finished_at`, and returns the race to `active`. Direct
  client updates cannot perform this transition.
- Every race status change (including ordinary start/finish) is recorded in
  `race_status_changes` with the previous/new status, actor, timestamp, and
  optional reason, via an `after update` trigger.
- Crossings support two correction primitives beyond plain soft-delete:
  editing a crossing's `bib`/`client_recorded_at` via `correct_crossing()`,
  and restoring a soft-deleted crossing via `restore_crossing()`. Both are
  `security definer` Postgres functions requiring event ownership (or an
  `organizer`/`scorer`-role `event_members` grant) and a non-empty reason,
  and both preserve the crossing's original `id`/`client_id` (the
  offline-retry idempotency key) — a correction only ever changes the
  displayed bib or time, never the crossing's identity. Every such change,
  plus every plain soft-delete, is recorded in `crossing_corrections` (actor,
  previous/new value, and — for edits/restores — a required reason) by a
  `crossings_correction_guard`/`crossings_correction_audit` trigger pair that
  enforces this regardless of which client performs the underlying `UPDATE`.
  See ADR 0010.

## Cloning

An organizer can clone an event's structure into a new draft event via the
`clone_event(event_id, include_roster, title)` Postgres function:

- Copies event metadata (title, sport, location, and the detail fields) into
  a new `events` row, always forcing `status = 'draft'` and a fresh
  `owner_id`; `starts_at`/`ends_at` are never copied.
- Copies every `races` row (name, sequence order, planned laps) into the new
  event; cloned races always start `upcoming` with no `started_at`/
  `finished_at`.
- Optionally copies `participants` rows (a fresh roster snapshot) into the
  new event when `include_roster` is true.
- Never copies `entries`, `crossings`, or any race-day state.

Like `reopen_race`, this is a `security definer` function that re-checks
ownership of the *source* event against the caller's JWT subject before
writing anything. See ADR 0009.

## Standings

`apps/web/src/lib/standings.ts` derives standings from non-deleted crossings:

1. Laps: count crossings per bib.
2. Position: highest lap count first; earliest crossing at that lap breaks ties.
3. Gap: difference to leader's crossing at the same lap, or lap deficit.
4. Last lap: time since previous crossing; lap one is measured from `races.started_at`.

The same logic should be shared with mobile before mobile begins presenting standings.

## Rider Status (DNS/DNF/DSQ)

`entries.status` (`ok` | `dns` | `dnf` | `dsq`) is an organizer-asserted fact, not derived from crossings — it sits alongside crossings as an input to `computeStandings`, which never persists a calculated standing itself (ADR 0001). `computeStandings` excludes non-`ok` entries from ranked position (`position: null`) but still returns them, sorted after all ranked riders, so the UI shows a status badge instead of dropping or misranking them. Every status change is timestamped and attributed (`status_set_by`/`status_set_at`, set by a trigger, not the client) and logged to `entry_status_changes`. See ADR 0007.

## Velodrome Points Race

A points race is scored entirely as an overlay on the same crossings/entries that drive overall standings — no new fact table (ADR 0011). `races` carries the scoring config (`is_points_race`, `sprint_interval_laps`, `sprint_points`, `final_sprint_multiplier`, `lap_gain_bonus`, `lap_loss_penalty`), all defaulted so non-points races are unaffected. `apps/web/src/lib/pointsRace.ts` derives, purely from crossings + that config:

1. Sprint laps: every `sprint_interval_laps` laps, plus the final lap always (never double-counted if it coincides with an interval).
2. Sprint result: the arrival order at a given lap, read directly off each rider's existing crossing sequence (their Nth crossing) — the same facts, no separate capture step.
3. Points: sprint placings (at `final_sprint_multiplier` on the last lap) plus a lap-gain bonus each time a rider's completed-lap count pulls more than one lap ahead of the best of the rest of the field.
4. Ranking: points desc, then laps desc, then final-sprint placing, then earliest final crossing.

The live board and announcer view render a sprint-lap banner, that sprint's own mini-result, and the cumulative points leaderboard only when `race.is_points_race` is true; the mini-result folds back into the leaderboard automatically once any rider crosses to the next lap, driven by live crossings rather than a UI timer.

## Penalties And Adjustments

`race_entry_penalties` (`time_penalty` | `lap_penalty` | `relegation` | `note`) is an organizer/official-asserted fact, same category as rider status, applied as the final step in `computeStandings` after the raw per-lap/gap computation: a time penalty shifts an entry's effective ranking time, a lap penalty reduces its effective lap count, and a relegation sorts it to the back of its same-effective-lap tier. `StandingRow`'s raw fields (`laps`, `lastCrossingAt`, `lastLapMs`) are never altered by a penalty — only the derived `position`/`gapText` and the row's `timePenaltySeconds`/`lapPenalty`/`relegated`/`penalties` fields reflect it, preserving the "raw vs. adjusted" split even though only the adjusted view is shown by default. Every penalty requires a reason and is attributed (`set_by`/`set_at`, set by a trigger, not the client). Unlike rider status, penalties are cumulative (a table of penalty rows, not a column), and rows are only ever inserted or deleted, not updated. See ADR 0012.

## Time Trial

A time trial is a race format where riders start and finish solo, one at a time, in bib start order, and are ranked by their individual elapsed time between start and finish (downhill MTB, ski racing, and similar disciplines).

### Data model

`races` carries two new columns added in migration `20260828000002_time_trial_race_type.sql`:
- `is_time_trial boolean not null default false` — enables the format.
- `time_trial_countdown_seconds int not null default 5` — length of the optional start countdown; 0 disables it (immediate start only).

A check constraint (`races_points_or_time_trial_check`) prevents a race from being both `is_points_race` and `is_time_trial` simultaneously — the two formats are mutually exclusive. `laps_planned` is always `null` for time-trial races (same convention as open-ended timed mass-start races).

No changes were made to `crossings` or `entries`. Start and finish are ordinary crossings: a rider's 1st non-deleted crossing (by `client_recorded_at`) is their start; their 2nd is their finish. A 3rd+ crossing is treated as a data-entry error requiring organizer correction rather than a new lap.

`clone_event()` is updated (migration `20260828000003_clone_event_time_trial.sql`) to copy both new columns, and also fixes a previously-missing copy of the points-race config columns (`is_points_race`, `sprint_interval_laps`, `sprint_points`, `final_sprint_multiplier`, `lap_gain_bonus`, `lap_loss_penalty`).

### Scoring semantics

`apps/web/src/lib/timeTrial.ts` derives, purely from `Crossing[]` + `Entry[]`:

- **`queued`** — 0 non-deleted crossings, `status === 'ok'`.
- **`running`** — exactly 1 non-deleted crossing.
- **`finished`** — exactly 2 non-deleted crossings; `elapsedMs = finishedAt - startedAt`.
- **`needs-review`** — 3+ crossings; best-effort elapsed from 1st+2nd; flagged for organizer correction.
- DNS/DNF/DSQ entries excluded from ranking, returned separately (same convention as `standings.ts`).

Ranking is ascending `elapsedMs` among `finished` entries — the opposite of mass-start (which ranks by most laps then earliest time). The live board renders a **different component entirely** (`TimeTrialBoard`) rather than an overlay, since elapsed-time ranking and lap-count ranking are mutually exclusive views.

`computeTimeTrialQueue()` returns `queued` entries in natural/numeric bib order ("9" before "10"). `computeTimeTrialResults()` returns `finished`/`needs-review` entries ranked by `elapsedMs` ascending with `position` and `gapText`. `getProgress()` derives progress-bar state: indeterminate before any rider finishes, proportional against the fastest elapsed time otherwise, overtime indicator when exceeded.

### UI shape

- **Organizer scorer** (`/score/[raceId]`, muted styling): Up Next / On Course / Finished sections. Start controls offer immediate tap or a countdown (length from `time_trial_countdown_seconds`, audible via Web Audio API, cancelable). Start hidden while any rider is on course (solo-only enforcement). Crossing correction/undo via the existing recent-crossings list (unchanged).
- **Spectator live board** (`/live/[raceId]`, full red/yellow styling): Now Running hero with live timer + progress bar; Up Next row list; elapsed-time ranked results table with DNS/DNF/DSQ appended. Announcer view (`/announce/[raceId]`) replaced with elapsed-time results and on-course rider (lap-based standings not shown for TT races).
- **Mobile tracker** (`apps/mobile`): Up Next / On Course / Finished flow; start uses haptic countdown (expo-haptics). Both start and finish call `recordCrossing()` unchanged — a start and a finish are two ordinary crossings.
- **Results page** (`/results/[eventId]`): labels time-trial races as "Time trial" instead of "N laps" / "Timed race".

See ADR 0014 for full rationale.

## Realtime

Supabase Realtime publishes changes from `crossings`, `races`, `entries`, and `race_entry_penalties`. Web clients use `useRaceData` to refetch current race data on a change, then recompute the pure standings function. This favors correctness and simple recovery over incremental client state. `race_entry_penalties` has no `race_id` column to filter the subscription on, so `useRaceData` listens unfiltered and re-scopes on refetch by the race's current entry ids.

## Security

Supabase RLS enforces the application boundary:

- API routes verify the caller's Supabase JWT then forward it to Supabase for
  each downstream call; they do not bypass these policies with a service-role
  credential (ADR 0013).

- Anonymous: select published event/race/entry/crossing data only.
- Authenticated organizer: manage only rows belonging to events where `owner_id` matches the JWT subject.
- Entries: adding/removing an entry (insert/delete) is permitted only while the corresponding race is `upcoming`. Updates are scoped to the owner or an `organizer`-role member in any race status; the `entries_write_guard` trigger (not RLS) rejects roster identity (bib/name/team/category) changes outside `upcoming`, while allowing `status`/`status_reason` changes at any time. Reads are covered by three separate policies: `public read published entries` (live/finished events), `member read entries` (any `event_members` role), and `organizer read entries` (the plain event owner, since `owner_id` is never duplicated into `event_members` — see ADR 0002/0006). All three matter in practice: PostgREST's `upsert()` always performs an internal `RETURNING`, so any write path using it needs a matching SELECT policy even when the caller doesn't request a representation back (#141).
- Crossings: inserts are permitted only while the parent race is `active`; reads, corrections (soft-delete via update), and deletes remain available to the owning organizer (or a `scorer`/`organizer` member) in any race status.
- Race status transitions: enforced by a trigger regardless of caller, not by RLS alone (RLS still confirms event ownership or an `organizer`-role `event_members` grant, see below).
- Crossing corrections: editing a bib/time or restoring a soft-deleted crossing is gated by a trigger requiring a reason, not by RLS alone; `correct_crossing()`/`restore_crossing()` confirm the caller is the owner or an `organizer`/`scorer`-role member, same as `reopen_race()`. `crossing_corrections` itself is read-only (owner or `organizer`/`scorer`-role member) and is only ever written by the `security definer` trigger/functions.
- Entry status transitions: attribution (`status_set_by`/`status_set_at`) is written only by a trigger, never accepted from the client; every transition is logged to `entry_status_changes`.
- Penalties/adjustments: `race_entry_penalties` requires a non-empty reason and a type-appropriate value, enforced by a `before insert` trigger that also writes attribution (`set_by`/`set_at`); rows may be inserted or deleted by the owner or an `organizer`/`official`-role member, never updated. Spectators of a published event can read them (for the public penalty badge), mirroring the `crossings`/`entries` publish split.
- Authenticated volunteer: an accepted row in `event_members` grants role-scoped access to one event, independent of `owner_id` (see ADR 0006). `organizer` members can manage roster/races/participants/invites (including rider status and penalties) like the owner (but not delete the event) and share the owner's `reopen_race` authority; `scorer` members can record/undo/correct crossings and start/finish races (crossing inserts still require an `active` race); `checkin` members can additionally flip a participant's check-in status (see below); `official` members get read-only access to the private (draft) event, plus write access to `race_entry_penalties` — their first and only write capability (see ADR 0012).
- Invite links (`event_invites`) are single-use and expire after 14 days. Looking up or accepting one goes through the `preview_event_invite` / `accept_event_invite` security-definer functions rather than a direct SELECT policy, so tokens are never listable.
- Check-in: `participants.checked_in_at` is writable, at any race status, only through the `set_participant_checked_in(participant_id, checked_in)` security-definer function, which checks event ownership or an `organizer`/`checkin` `event_members` role. This is the same pattern as `reopen_race` — a `checkin` volunteer is not granted a blanket `UPDATE` on `participants`, so they cannot edit bib/name/team/category, only the check-in flag. See ADR 0008.

Migration 00004 introduces the ownership policies. Migration 00005 enforces the start-time roster lock. Migration `20260827000004_race_lifecycle` adds `finished_at`, the lifecycle trigger/audit log, the `reopen_race` function, and the active-only crossing insert policy. Migration `20260827000005_volunteer_roles` adds volunteer roles and invite links. Migration `20260827000006_race_entry_statuses` adds rider status, its audit log, and splits the entries write policy into insert/delete (upcoming-only) and update (owner/organizer-member, field-level lock via trigger). Migration `20260827000007_participant_checkin` adds `checked_in_at` and the `set_participant_checked_in` function. Migration `20260827000008_clone_event` adds the `clone_event` function. Migration `20260827000009_crossing_corrections` adds the `crossing_corrections` audit table, the correction guard/audit triggers, and the `correct_crossing`/`restore_crossing` functions. Migration `20260827000010_velodrome_points_race` adds the points-race scoring config columns on `races`; no RLS changes were needed since they're covered by the existing races policies. Migration `20260827000011_race_entry_penalties` adds `race_entry_penalties`, its insert guard/attribution trigger, and the owner/organizer/official manage policies plus the published-event public read policy. Migration `20260828000001_organizer_read_entries` adds the missing owner-scoped SELECT policy on `entries` that `20260827000006` had dropped without a replacement, fixing a 403 on any entries write path (e.g. `upsert()`) that triggers PostgREST's internal `RETURNING`. Migration `20260828000002_time_trial_race_type` adds `is_time_trial` and `time_trial_countdown_seconds` to `races` plus the mutual-exclusion constraint. Migration `20260828000003_clone_event_time_trial` replaces `clone_event()` to copy all race config columns (points-race columns were previously missing).

### Resolving a user's access to an event

`apps/web/src/lib/useEventAccess.ts` resolves, for the signed-in user and one event, whether they are the `owner`, an `event_members` role, or have no access — this drives both the event setup page and the scorer page. It is a UX convenience only; the RLS policies above are the actual enforcement boundary.

## Casual Stopwatch

The casual stopwatch is the **fourth surface**, independent of the three event-management surfaces (Spectator, Organizer, Mobile tracker). It lives in `apps/stopwatch` (native Expo app, `org.splitsync.stopwatch`) and `apps/web/src/app/stopwatch` (web entry point). See ADR 0017 for full rationale.

### Data model

Three tables support this surface (migration `20260830000001_casual_stopwatch_sessions.sql`):

| Table | Purpose |
| --- | --- |
| `casual_sessions` | A timed session: owner, human-readable name, unique 6-char join code, status, expiry, participant cap, and server-anchored T0 |
| `casual_session_participants` | Everyone in a session — owner plus joiners. `client_id` UUID is the idempotency key for re-join |
| `casual_session_events` | The event log (`start` / `lap` / `stop` / `reset`). Client-generated `id` is the idempotency key. Elapsed time and lap splits are **always derived** from this log — never persisted |

### Auth and access control

- **Creator must be authenticated.** `create_casual_session(p_name, p_display_name)` validates `auth.uid() IS NOT NULL` inside the security-definer RPC and stores `auth.uid()::text` as `casual_sessions.owner_id` — the same pattern as `events.owner_id`.
- **Joiners are anonymous.** `join_casual_session(code, display_name, client_id)` is callable by the anon role; no account required.
- **No direct table grants.** RLS is enabled on all three tables as defense in depth, but the anon role has zero direct SELECT/INSERT/UPDATE grants. All anon access flows through four security-definer RPCs:

| RPC | Caller | Description |
| --- | --- | --- |
| `create_casual_session(name, display_name)` | Authenticated | Creates session + owner participant; generates unique 6-char code |
| `join_casual_session(code, display_name, client_id)` | Anon | Validates code, checks expiry/cap, creates participant row (idempotent) |
| `record_session_event(session_id, participant_id, event_type, client_recorded_at, client_event_id)` | Anon | Validates membership, enforces concurrency rules, upserts event (idempotent on client id) |
| `get_session_state(session_id, participant_id)` | Anon | Returns full session + participants + events for catch-up on reconnect |

The `participant_id` UUID returned on join acts as a bearer token: calls without a valid `(session_id, participant_id)` pair are rejected. The owner RLS policy (`owner_id = auth.uid()::text`) allows authenticated creators to list their own sessions directly.

### Event log is source of truth

Elapsed time and lap splits are computed entirely on the client from the event log:

```
elapsed_ms = (Date.now() + offset_ms) - t0_server.getTime()
split_ms   = client_recorded_at[lap_N] - client_recorded_at[lap_N-1]
```

`t0_server` is set atomically by the server when the first `start` event is accepted and is never changed thereafter. No `standings`, `laps`, or `elapsed` column is ever persisted — this mirrors domain invariant #2.

### Realtime

Both `casual_session_events` and `casual_session_participants` are added to the `supabase_realtime` publication. The Broadcast channel key is `stopwatch:<code>` (e.g., `stopwatch:AB3K9X`). All participants in the same session subscribe to the same channel. The anon role can use Broadcast channels without table SELECT grants, which is why Broadcast is preferred over `postgres_changes` for this surface.

Migration `20260829000001_realtime_publication.sql` first enabled the publication; `20260830000001_casual_stopwatch_sessions.sql` adds the three casual-stopwatch tables.

### Deep links

| Surface | URL pattern |
| --- | --- |
| Web (HTTPS App Link) | `https://splitsync.org/stopwatch/s/<code>` |
| Android native scheme | `org.splitsync.stopwatch://s/<code>` |

Both link directly into the Join screen. The native app registers an Android intent filter for the HTTPS pattern (App Links / `autoVerify: true`); `assetlinks.json` at `apps/web/public/.well-known/assetlinks.json` must include the app's signing-certificate SHA-256 to enable verified deep links. The `<code>` is the 6-character alphanumeric join code stored in `casual_sessions.code`.

## UI System

The visual design system is a shared contract across web and mobile, documented in [`docs/adr/0015-broadcast-ui-refresh.md`](adr/0015-broadcast-ui-refresh.md).

Key elements:

- **Tokens**: `--race-*` CSS custom properties in `apps/web/src/app/globals.css` and matching keys in the `colors` object in `apps/mobile/App.tsx`.
- **Typography**: Geist Sans (body), Barlow Condensed 700 (numeral display columns — rank, lap, gap, elapsed).
- **Motion vocabulary**: three named patterns — `live-pulse`, `rank-flash`, `leader-change` — defined as CSS `@keyframes` utility classes respecting `prefers-reduced-motion`.
- **Element rule table**: which UI elements receive broadcast depth/motion treatment (hero/live only) vs. which remain flat (organizer admin, static content) — see the ADR for the full table.
- **Cross-surface contract**: every token added to web's `:root` block has a matching mobile `colors` key, and vice versa.
