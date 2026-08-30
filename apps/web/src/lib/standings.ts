import type { Crossing, Entry, EntryPenalty, EntryStatus } from "./types";

export interface StandingRow {
  position: number | null; // null for DNS/DNF/DSQ rows — not part of ranked order
  bib: string;
  name: string;
  team: string | null;
  laps: number; // raw, factual lap count from crossings — never adjusted
  lastCrossingAt: number | null; // epoch ms, raw crossing time — never adjusted
  lastLapMs: number | null; // raw last lap time — never adjusted
  gapText: string; // "—" for leader, "+12.3", "+1:04.2", "-2 laps" — reflects penalties
  isUnknownBib: boolean;
  status: EntryStatus; // "ok" unless the organizer marked DNS/DNF/DSQ
  penalties: EntryPenalty[]; // penalties/adjustments applied to this entry, newest last
  timePenaltySeconds: number; // sum of time_penalty values, added to effective time for ranking
  lapPenalty: number; // sum of lap_penalty values, subtracted from laps for ranking
  relegated: boolean; // dropped to the back of its same-lap tier for ranking
}

/** True if this row carries any penalty/adjustment (for badges/tooltips). */
export function isPenalized(row: StandingRow): boolean {
  return row.penalties.length > 0;
}

/**
 * Riders on this race's roster who haven't recorded a single crossing yet.
 * Used by the live board's start-line rows and by the finalization review
 * checklist (#72) — a race can look "done" while a rider was never scored.
 */
export function getRidersWithoutCrossings(rows: StandingRow[]): StandingRow[] {
  return rows.filter((r) => r.status === "ok" && r.laps === 0);
}

/**
 * Flags riders whose most recent lap is unusually slow relative to the
 * field, as a pre-publish sanity check (#72) — e.g. a missed crossing that
 * inflated a lap time, or a rider who is actually still out on course.
 * Heuristic only (no raw per-neighbor gap is exposed by StandingRow): a
 * rider is flagged when they are ranked (laps > 0, status 'ok') and their
 * lastLapMs exceeds `factor`x the field's median lastLapMs. Not a
 * disqualification signal — purely a "look at this before publishing" flag.
 */
export function flagSuspiciousGaps(rows: StandingRow[], factor = 2.5): StandingRow[] {
  const withLapTimes = rows.filter((r) => r.status === "ok" && r.laps > 0 && r.lastLapMs != null);
  if (withLapTimes.length < 3) return []; // too small a field for a median to mean anything
  const sorted = [...withLapTimes].map((r) => r.lastLapMs!).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  if (median <= 0) return [];
  return withLapTimes.filter((r) => r.lastLapMs! > median * factor);
}

/**
 * Per-category (or single "Overall" group when a race has no categories)
 * top-3 podium, shared by the live board and the finalization review screen
 * (#72). Only ranked, on-lap riders are eligible.
 */
export function computePodiums(
  crossings: Crossing[],
  entries: Entry[],
  raceStartMs: number | null,
  categories: string[],
  penalties: EntryPenalty[]
): { category: string; rows: StandingRow[] }[] {
  const groups = categories.length > 0 ? categories : ["Overall"];
  return groups.map((category) => {
    const { crossings: c, entries: e } =
      categories.length > 0 ? filterByCategory(crossings, entries, category) : { crossings, entries };
    const rows = computeStandings(c, e, raceStartMs, penalties)
      .filter((r) => r.status === "ok" && r.laps > 0)
      .slice(0, 3);
    return { category, rows };
  });
}

function fmtDuration(ms: number): string {
  const totalTenths = Math.round(ms / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60);
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}.${tenths}`;
  return `${s}.${tenths}`;
}

export function fmtLapTime(ms: number | null): string {
  if (ms == null) return "—";
  return fmtDuration(ms);
}

/** Distinct, sorted category names present on a race's entries. */
export function getCategories(entries: Entry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    if (e.category && e.category.trim() !== "") set.add(e.category);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Narrow entries + crossings down to a single category before handing them
 * to computeStandings, so rank/gap/last-lap are computed within that group
 * only. Unregistered (unknown-bib) crossings have no category and are
 * excluded from category views but remain visible in the overall view.
 */
export function filterByCategory(
  crossings: Crossing[],
  entries: Entry[],
  category: string | null
): { crossings: Crossing[]; entries: Entry[] } {
  if (!category) return { crossings, entries };
  const filteredEntries = entries.filter((e) => e.category === category);
  const bibs = new Set(filteredEntries.map((e) => e.bib));
  const filteredCrossings = crossings.filter((c) => bibs.has(c.bib));
  return { crossings: filteredCrossings, entries: filteredEntries };
}

export interface RecentCrossing {
  bib: string;
  name: string;
  team: string | null;
  lap: number;
  atMs: number;
  lapMs: number | null;
  isUnknownBib: boolean;
}

/**
 * Flattens every non-deleted crossing (across all riders) into a single
 * feed, newest first — used by the announcer/TV view to show "who just
 * crossed the line" independent of per-rider standings order.
 */
export function getRecentCrossings(
  crossings: Crossing[],
  entries: Entry[],
  raceStartMs?: number | null,
  limit = 5
): RecentCrossing[] {
  const entryByBib = new Map(entries.map((e) => [e.bib, e]));
  const byBib = new Map<string, number[]>();

  for (const c of crossings) {
    if (c.deleted_at) continue;
    const t = new Date(c.client_recorded_at).getTime();
    const arr = byBib.get(c.bib);
    if (arr) arr.push(t);
    else byBib.set(c.bib, [t]);
  }

  const all: RecentCrossing[] = [];
  for (const [bib, timesRaw] of byBib) {
    const times = [...timesRaw].sort((a, b) => a - b);
    const entry = entryByBib.get(bib);
    times.forEach((t, idx) => {
      const lapMs = idx >= 1 ? t - times[idx - 1] : raceStartMs != null ? t - raceStartMs : null;
      all.push({
        bib,
        name: entry?.name ?? `Bib ${bib}`,
        team: entry?.team ?? null,
        lap: idx + 1,
        atMs: t,
        lapMs,
        isUnknownBib: !entry,
      });
    });
  }

  all.sort((a, b) => b.atMs - a.atMs);
  return all.slice(0, limit);
}

/**
 * Derive live standings from raw crossings (mass-start lap racing).
 * Each non-deleted crossing = the rider completing a lap.
 * Order: most laps first, then earliest last-crossing.
 * Gap: same lap count -> time behind the leader's crossing on that lap;
 * fewer laps -> "-N lap(s)".
 */
export function computeStandings(
  crossings: Crossing[],
  entries: Entry[],
  raceStartMs?: number | null,
  penalties: EntryPenalty[] = []
): StandingRow[] {
  const entryByBib = new Map(entries.map((e) => [e.bib, e]));
  const penaltiesByEntryId = new Map<string, EntryPenalty[]>();
  for (const p of penalties) {
    const arr = penaltiesByEntryId.get(p.entry_id);
    if (arr) arr.push(p);
    else penaltiesByEntryId.set(p.entry_id, [p]);
  }
  const byBib = new Map<string, number[]>(); // bib -> sorted crossing times (epoch ms)

  for (const c of crossings) {
    if (c.deleted_at) continue;
    const t = new Date(c.client_recorded_at).getTime();
    const arr = byBib.get(c.bib);
    if (arr) arr.push(t);
    else byBib.set(c.bib, [t]);
  }
  for (const arr of byBib.values()) arr.sort((a, b) => a - b);

  // Riders with no crossings yet still appear (on the start line)
  for (const e of entries) {
    if (!byBib.has(e.bib)) byBib.set(e.bib, []);
  }

  const rows = [...byBib.entries()].map(([bib, times]) => {
    const entry = entryByBib.get(bib);
    const laps = times.length;
    const lastCrossingAt = laps > 0 ? times[laps - 1] : null;
    // Lap time: delta from previous crossing; for lap 1, from the start gun if known
    const lastLapMs =
      laps >= 2
        ? times[laps - 1] - times[laps - 2]
        : laps === 1 && raceStartMs != null
          ? times[0] - raceStartMs
          : null;

    // Penalties/adjustments (#71): asserted facts overlaid on derived
    // standings, same pattern as rider status (ADR 0007) — applied here as
    // a final step after the raw rank/gap inputs are known, never mutating
    // the raw crossing-derived fields above. See docs/adr/0011.
    const entryPenalties = entry ? (penaltiesByEntryId.get(entry.id) ?? []) : [];
    let timePenaltySeconds = 0;
    let lapPenalty = 0;
    let relegated = false;
    for (const p of entryPenalties) {
      if (p.type === "time_penalty") timePenaltySeconds += p.value ?? 0;
      else if (p.type === "lap_penalty") lapPenalty += p.value ?? 0;
      else if (p.type === "relegation") relegated = true;
    }
    const effectiveLaps = Math.max(laps - lapPenalty, 0);
    const effectiveAt = lastCrossingAt == null ? null : lastCrossingAt + timePenaltySeconds * 1000;

    return {
      bib,
      name: entry?.name ?? `Bib ${bib}`,
      team: entry?.team ?? null,
      laps,
      lastCrossingAt,
      lastLapMs,
      isUnknownBib: !entry,
      // Unknown-bib crossings have no entry/status — treat them as ranked,
      // same as before this feature existed.
      status: entry?.status ?? "ok",
      penalties: entryPenalties,
      timePenaltySeconds,
      lapPenalty,
      relegated,
      effectiveLaps,
      effectiveAt,
      times,
    };
  });

  // DNS/DNF/DSQ are adjudication facts overlaid on derived standings (see
  // docs/adr/0007-rider-status.md): excluded from ranked position, but still
  // listed rather than silently dropped or misranked among active riders.
  const ranked = rows.filter((r) => r.status === "ok");
  const statused = rows
    .filter((r) => r.status !== "ok")
    .sort((a, b) => a.name.localeCompare(b.name) || a.bib.localeCompare(b.bib));

  // Ranking uses the penalty-adjusted lap count and time (effectiveLaps /
  // effectiveAt), never the raw crossing-derived fields, so a lap or time
  // penalty (or a relegation, sorted last within its tier) is reflected in
  // final classification per the acceptance criteria in #71.
  ranked.sort((a, b) => {
    if (a.effectiveLaps !== b.effectiveLaps) return b.effectiveLaps - a.effectiveLaps;
    if (a.relegated !== b.relegated) return a.relegated ? 1 : -1;
    if (a.effectiveAt == null && b.effectiveAt == null) return 0;
    if (a.effectiveAt == null) return 1;
    if (b.effectiveAt == null) return -1;
    return a.effectiveAt - b.effectiveAt;
  });

  const leader = ranked[0];

  const rankedResult = ranked.map((r, i) => {
    let gapText = "—";
    if (i > 0 && leader && leader.effectiveLaps > 0) {
      if (r.effectiveLaps === 0) {
        gapText = "";
      } else if (r.effectiveLaps < leader.effectiveLaps) {
        const down = leader.effectiveLaps - r.effectiveLaps;
        gapText = `-${down} lap${down > 1 ? "s" : ""}`;
      } else {
        // same effective laps as leader: compare penalty-adjusted time.
        // (When neither rider has a lap penalty this is exactly the raw
        // "crossing time at that lap" comparison used before #71.)
        gapText = `+${fmtDuration(r.effectiveAt! - leader.effectiveAt!)}`;
      }
    }
    return {
      position: i + 1,
      bib: r.bib,
      name: r.name,
      team: r.team,
      laps: r.laps,
      lastCrossingAt: r.lastCrossingAt,
      lastLapMs: r.lastLapMs,
      gapText,
      isUnknownBib: r.isUnknownBib,
      status: r.status,
      penalties: r.penalties,
      timePenaltySeconds: r.timePenaltySeconds,
      lapPenalty: r.lapPenalty,
      relegated: r.relegated,
    };
  });

  const statusedResult = statused.map((r) => ({
    position: null,
    bib: r.bib,
    name: r.name,
    team: r.team,
    laps: r.laps,
    lastCrossingAt: r.lastCrossingAt,
    lastLapMs: r.lastLapMs,
    gapText: "",
    isUnknownBib: r.isUnknownBib,
    status: r.status,
    penalties: r.penalties,
    timePenaltySeconds: r.timePenaltySeconds,
    lapPenalty: r.lapPenalty,
    relegated: r.relegated,
  }));

  return [...rankedResult, ...statusedResult];
}
