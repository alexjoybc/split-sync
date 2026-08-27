import type { Crossing, Entry, EntryStatus, Race } from "./types";

/**
 * Velodrome points race scoring — a derived overlay on top of the same
 * crossings + entries used by `standings.ts` (see ADR 0001 and
 * docs/adr/0009-points-race-overlay.md). No new fact table exists: sprint
 * results are read directly from each rider's existing crossing sequence
 * (the Nth crossing = their arrival at lap N), and points are always
 * recomputed from crossings + the race's scoring config, never persisted.
 */

export interface PointsRaceConfig {
  sprintIntervalLaps: number;
  sprintPoints: number[];
  finalSprintMultiplier: number;
  lapGainBonus: number;
  lapLossPenalty: number;
  totalLaps: number | null;
}

/** Reads the per-race points-race config columns off a `races` row. */
export function getPointsRaceConfig(race: Race): PointsRaceConfig {
  return {
    sprintIntervalLaps: race.sprint_interval_laps,
    sprintPoints: race.sprint_points,
    finalSprintMultiplier: race.final_sprint_multiplier,
    lapGainBonus: race.lap_gain_bonus,
    lapLossPenalty: race.lap_loss_penalty,
    totalLaps: race.laps_planned,
  };
}

export interface SprintLap {
  lap: number;
  isFinal: boolean;
}

/**
 * A sprint is contested every `sprintIntervalLaps` laps, and the final lap
 * is always a sprint (at the final-sprint multiplier), even if it doesn't
 * land on an interval multiple. If it does land on one, it only counts once,
 * at the final multiplier.
 */
export function getSprintLaps(config: PointsRaceConfig): SprintLap[] {
  const { sprintIntervalLaps, totalLaps } = config;
  if (!totalLaps || totalLaps <= 0 || sprintIntervalLaps <= 0) return [];
  const laps: SprintLap[] = [];
  for (let lap = sprintIntervalLaps; lap < totalLaps; lap += sprintIntervalLaps) {
    laps.push({ lap, isFinal: false });
  }
  laps.push({ lap: totalLaps, isFinal: true });
  return laps;
}

function crossingTimesByBib(crossings: Crossing[]): Map<string, number[]> {
  const byBib = new Map<string, number[]>();
  for (const c of crossings) {
    if (c.deleted_at) continue;
    const t = new Date(c.client_recorded_at).getTime();
    const arr = byBib.get(c.bib);
    if (arr) arr.push(t);
    else byBib.set(c.bib, [t]);
  }
  for (const arr of byBib.values()) arr.sort((a, b) => a - b);
  return byBib;
}

export interface SprintResultRow {
  place: number;
  bib: string;
  name: string;
  team: string | null;
  atMs: number;
}

/**
 * The arrival order at a given lap number, read directly from each rider's
 * Nth crossing — no separate capture step. Riders who haven't reached that
 * lap yet, or who are DNS/DNF/DSQ, don't appear.
 */
export function getSprintResult(crossings: Crossing[], entries: Entry[], lap: number): SprintResultRow[] {
  const entryByBib = new Map(entries.map((e) => [e.bib, e]));
  const byBib = crossingTimesByBib(crossings);

  const rows: { bib: string; name: string; team: string | null; atMs: number }[] = [];
  for (const [bib, times] of byBib) {
    if (times.length < lap) continue;
    const entry = entryByBib.get(bib);
    if (entry && entry.status !== "ok") continue;
    rows.push({ bib, name: entry?.name ?? `Bib ${bib}`, team: entry?.team ?? null, atMs: times[lap - 1] });
  }
  rows.sort((a, b) => a.atMs - b.atMs);
  return rows.map((r, i) => ({ place: i + 1, ...r }));
}

/**
 * Detects "lapping the field" events: at any point, a rider's completed-lap
 * count more than 1 ahead of the best lap count among the other still-racing
 * riders is a lap gain (the moment the gap widens past the normal 1-lap
 * front-group lead). Each additional whole lap of separation counts as one
 * more gain. If `lapLossPenalty` is enabled, whichever rider(s) sit at that
 * surpassed lap count take a matching loss.
 *
 * This is a simplification: it compares against the single best other rider
 * rather than modeling multiple simultaneous breakaway groups, which is
 * sufficient for the grassroots fields this overlay targets.
 */
function computeLapEvents(
  crossings: Crossing[],
  entries: Entry[],
  config: PointsRaceConfig
): { gains: Map<string, number>; losses: Map<string, number> } {
  const entryByBib = new Map(entries.map((e) => [e.bib, e]));
  const events: { bib: string; atMs: number }[] = [];
  for (const c of crossings) {
    if (c.deleted_at) continue;
    const entry = entryByBib.get(c.bib);
    if (entry && entry.status !== "ok") continue;
    events.push({ bib: c.bib, atMs: new Date(c.client_recorded_at).getTime() });
  }
  events.sort((a, b) => a.atMs - b.atMs);

  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.status === "ok") counts.set(e.bib, 0);
  }

  const creditedGains = new Map<string, number>();
  const gains = new Map<string, number>();
  const losses = new Map<string, number>();

  for (const ev of events) {
    counts.set(ev.bib, (counts.get(ev.bib) ?? 0) + 1);
    const myCount = counts.get(ev.bib)!;

    let bestOther = 0;
    for (const [bib, c] of counts) {
      if (bib !== ev.bib && c > bestOther) bestOther = c;
    }

    const gap = myCount - bestOther;
    const creditable = Math.max(0, gap - 1);
    const already = creditedGains.get(ev.bib) ?? 0;
    if (creditable > already) {
      const newGains = creditable - already;
      gains.set(ev.bib, (gains.get(ev.bib) ?? 0) + newGains);
      creditedGains.set(ev.bib, creditable);
      if (config.lapLossPenalty > 0) {
        for (const [bib, c] of counts) {
          if (bib !== ev.bib && c === bestOther) {
            losses.set(bib, (losses.get(bib) ?? 0) + newGains);
          }
        }
      }
    }
  }

  return { gains, losses };
}

export interface PointsStandingRow {
  position: number | null;
  bib: string;
  name: string;
  team: string | null;
  points: number;
  laps: number;
  lastCrossingAt: number | null;
  finalSprintPlace: number | null;
  isUnknownBib: boolean;
  status: EntryStatus;
}

/**
 * Derives the cumulative points-race leaderboard from crossings + the
 * race's scoring config. Ranking: total points desc, then total laps desc
 * (rewards the front group over a rider who scored the same points but got
 * lapped), then better final-sprint placing, then earliest final crossing —
 * the same tie-break chain overall standings already use.
 */
export function computePointsStandings(crossings: Crossing[], entries: Entry[], race: Race): PointsStandingRow[] {
  const config = getPointsRaceConfig(race);
  const sprintLaps = getSprintLaps(config);
  const entryByBib = new Map(entries.map((e) => [e.bib, e]));
  const timesByBib = crossingTimesByBib(crossings);
  for (const e of entries) {
    if (!timesByBib.has(e.bib)) timesByBib.set(e.bib, []);
  }

  const pointsByBib = new Map<string, number>();
  const finalSprintPlaceByBib = new Map<string, number>();

  for (const sprint of sprintLaps) {
    const result = getSprintResult(crossings, entries, sprint.lap);
    const multiplier = sprint.isFinal ? config.finalSprintMultiplier : 1;
    for (const row of result) {
      if (row.place > config.sprintPoints.length) continue;
      const pts = config.sprintPoints[row.place - 1] * multiplier;
      pointsByBib.set(row.bib, (pointsByBib.get(row.bib) ?? 0) + pts);
      if (sprint.isFinal) finalSprintPlaceByBib.set(row.bib, row.place);
    }
  }

  const { gains, losses } = computeLapEvents(crossings, entries, config);
  for (const [bib, count] of gains) {
    pointsByBib.set(bib, (pointsByBib.get(bib) ?? 0) + count * config.lapGainBonus);
  }
  if (config.lapLossPenalty > 0) {
    for (const [bib, count] of losses) {
      pointsByBib.set(bib, (pointsByBib.get(bib) ?? 0) - count * config.lapLossPenalty);
    }
  }

  const rows = [...timesByBib.entries()].map(([bib, times]) => {
    const entry = entryByBib.get(bib);
    return {
      bib,
      name: entry?.name ?? `Bib ${bib}`,
      team: entry?.team ?? null,
      laps: times.length,
      lastCrossingAt: times.length ? times[times.length - 1] : null,
      points: pointsByBib.get(bib) ?? 0,
      finalSprintPlace: finalSprintPlaceByBib.get(bib) ?? null,
      isUnknownBib: !entry,
      status: entry?.status ?? ("ok" as EntryStatus),
    };
  });

  const ranked = rows.filter((r) => r.status === "ok");
  const statused = rows
    .filter((r) => r.status !== "ok")
    .sort((a, b) => a.name.localeCompare(b.name) || a.bib.localeCompare(b.bib));

  ranked.sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    if (a.laps !== b.laps) return b.laps - a.laps;
    const aPlace = a.finalSprintPlace ?? Infinity;
    const bPlace = b.finalSprintPlace ?? Infinity;
    if (aPlace !== bPlace) return aPlace - bPlace;
    if (a.lastCrossingAt == null && b.lastCrossingAt == null) return 0;
    if (a.lastCrossingAt == null) return 1;
    if (b.lastCrossingAt == null) return -1;
    return a.lastCrossingAt - b.lastCrossingAt;
  });

  const rankedResult: PointsStandingRow[] = ranked.map((r, i) => ({
    position: i + 1,
    bib: r.bib,
    name: r.name,
    team: r.team,
    points: r.points,
    laps: r.laps,
    lastCrossingAt: r.lastCrossingAt,
    finalSprintPlace: r.finalSprintPlace,
    isUnknownBib: r.isUnknownBib,
    status: r.status,
  }));

  const statusedResult: PointsStandingRow[] = statused.map((r) => ({
    position: null,
    bib: r.bib,
    name: r.name,
    team: r.team,
    points: r.points,
    laps: r.laps,
    lastCrossingAt: r.lastCrossingAt,
    finalSprintPlace: r.finalSprintPlace,
    isUnknownBib: r.isUnknownBib,
    status: r.status,
  }));

  return [...rankedResult, ...statusedResult];
}

/** The highest completed-lap count among riders, i.e. the lap currently underway. */
export function getCurrentLap(crossings: Crossing[]): number {
  const byBib = crossingTimesByBib(crossings);
  let max = 0;
  for (const times of byBib.values()) {
    if (times.length > max) max = times.length;
  }
  return max;
}

/** Finds the sprint, if any, that lands exactly on the given lap. */
export function getSprintAtLap(sprintLaps: SprintLap[], lap: number): SprintLap | null {
  return sprintLaps.find((s) => s.lap === lap) ?? null;
}

/** "Sprint in 2 laps", "Sprint next lap", "Final sprint next lap", or "—" once racing is over. */
export function getNextSprintText(currentLap: number, sprintLaps: SprintLap[]): string {
  const next = sprintLaps.find((s) => s.lap > currentLap);
  if (!next) return "—";
  const lapsAway = next.lap - currentLap;
  const label = next.isFinal ? "Final sprint" : "Sprint";
  return lapsAway === 1 ? `${label} next lap` : `${label} in ${lapsAway} laps`;
}
