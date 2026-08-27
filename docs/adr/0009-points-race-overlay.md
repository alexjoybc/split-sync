# ADR 0009: Velodrome Points Race As A Config-Driven Standings Overlay

## Status

Accepted.

## Decision

Score a velodrome points race entirely from the same `crossings` + `entries` facts that drive overall standings (`apps/web/src/lib/standings.ts`), with no new fact table. Per ADR 0001, "scoring rules more complex than mass-start laps, such as points races, require a separate overlay rather than mutating base crossings" — this feature is that overlay:

- `races` gains six columns: `is_points_race boolean`, `sprint_interval_laps int`, `sprint_points int[]`, `final_sprint_multiplier int`, `lap_gain_bonus int`, `lap_loss_penalty int`, all with sensible non-null defaults (`5`, `{5,3,2,1}`, `2`, `20`, `0`) so existing races are unaffected and a new race can be marked as a points race with a single flag. This is per-race configuration, not a global constant, so different points races can run different sprint intervals/point tables. `laps_planned` (already on `races`) doubles as the points race's fixed total lap count.
- A new pure module, `apps/web/src/lib/pointsRace.ts`, mirrors `standings.ts`'s shape: no I/O, only derivations from `Crossing[]` / `Entry[]` / the race's config columns.
  - `getSprintLaps` computes which laps are sprints (every `sprintIntervalLaps`, plus the final lap always, deduplicated if they coincide).
  - `getSprintResult` reads the arrival order at a given lap directly off each rider's existing crossing sequence (their Nth crossing) — this is the same data `computeStandings` already derives from, just indexed by lap number instead of by "most recent."
  - `computePointsStandings` sums sprint points (with the final sprint at `finalSprintMultiplier`) plus lap-gain bonuses (see below), ranked by points desc, then laps desc, then final-sprint placing, then earliest final crossing — the same tie-break chain overall standings use for the last two steps.
  - Lap-gain/lap-loss detection reuses the same "gap between lap counts" idea `computeStandings` already surfaces as `"-N lap(s)"`: a rider's completed-lap count becoming more than 1 ahead of the best count among the other still-racing riders is a lap gain, credited once per additional whole lap of separation.
- The live board (`/live/[raceId]`) and announcer view (`/announce/[raceId]`) render a `PointsClassification` / `PointsOverlay` section only `if (race.is_points_race)`, showing a sprint-lap banner (final sprint visually distinguished), that sprint's own mini-result while the field is on the sprint lap, and the cumulative points leaderboard. The "briefly surface the sprint result, then fold back" behavior described in the issue is driven by live crossings rather than a UI timer: the banner is keyed to the highest lap count reached so far being *exactly* a sprint lap, and it disappears on its own the instant any rider crosses to complete the next lap.
- Race creation (`/event/[eventId]`, "Add race") gets a "Points race" checkbox and sprint-interval input, defaulted on when the existing `velodrome-points` template is selected. Only `sprint_interval_laps` is exposed at creation; the other config fields keep their DB defaults (`5/3/2/1` sprint points, `×2` final sprint, `+20` lap-gain bonus, no lap-loss penalty) since local-event organizers do not need a full custom point-table editor for the MVP.

## Rationale

Persisting a computed points total, or capturing sprint results as a separate scored event, would duplicate the crossings that already exist and reintroduce exactly the reconciliation problem ADR 0001 was written to avoid: if a scorer corrects a crossing (soft-delete + re-add), every sprint result and the cumulative leaderboard that depends on it must recompute automatically, the same way overall standings already do. Reading sprint results as "the Nth crossing" rather than a bespoke capture step means corrections just work for points races with zero additional code.

The six new `races` columns (rather than a separate `race_points_config` table) were chosen because every field is a scalar attribute of one race and none of them are ever queried independently of their race — a join table would add a foreign key and an extra round trip for no benefit at grassroots scale.

## Consequences

- No RLS changes were needed: the new columns are plain fields on `races`, already covered by the existing `"organizer manage races"` (owner writes) and `"public read published races"` (spectator reads) policies.
- The lap-gain/lap-loss detector compares each rider's completed-lap count against the single best count among the field rather than modeling multiple simultaneous breakaway groups; this is a deliberate simplification adequate for grassroots fields (documented in `pointsRace.ts`), not a general n-group lapping model.
- The points overlay is display-only in this iteration: there is no dedicated points-race podium, no category-scoped points leaderboard beyond whatever category filter the live board already applies to the crossings/entries passed in, and no organizer control to edit `sprint_points`, `final_sprint_multiplier`, `lap_gain_bonus`, or `lap_loss_penalty` from the UI (they take their DB defaults). A richer points-race config editor is a candidate follow-up if organizers need non-default point tables.
- `Race` (`apps/web/src/lib/types.ts`) is no longer a small, purely-lifecycle-shaped type — any future consumer selecting a full `races` row now also gets the points-race config columns, defaulted to points-race-off values for every non-points race.
