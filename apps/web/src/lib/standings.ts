import type { Crossing, Entry, EntryStatus } from "./types";

export interface StandingRow {
  position: number | null; // null for DNS/DNF/DSQ rows — not part of ranked order
  bib: string;
  name: string;
  team: string | null;
  laps: number;
  lastCrossingAt: number | null; // epoch ms
  lastLapMs: number | null;
  gapText: string; // "—" for leader, "+12.3", "+1:04.2", "-2 laps"
  isUnknownBib: boolean;
  status: EntryStatus; // "ok" unless the organizer marked DNS/DNF/DSQ
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
  raceStartMs?: number | null
): StandingRow[] {
  const entryByBib = new Map(entries.map((e) => [e.bib, e]));
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

  ranked.sort((a, b) => {
    if (a.laps !== b.laps) return b.laps - a.laps;
    if (a.lastCrossingAt == null && b.lastCrossingAt == null) return 0;
    if (a.lastCrossingAt == null) return 1;
    if (b.lastCrossingAt == null) return -1;
    return a.lastCrossingAt - b.lastCrossingAt;
  });

  const leader = ranked[0];

  const rankedResult = ranked.map((r, i) => {
    let gapText = "—";
    if (i > 0 && leader && leader.laps > 0) {
      if (r.laps === 0) {
        gapText = "";
      } else if (r.laps < leader.laps) {
        const down = leader.laps - r.laps;
        gapText = `-${down} lap${down > 1 ? "s" : ""}`;
      } else {
        // same laps as leader: compare crossing time on that lap
        const leaderAtLap = leader.times[r.laps - 1];
        gapText = `+${fmtDuration(r.lastCrossingAt! - leaderAtLap)}`;
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
  }));

  return [...rankedResult, ...statusedResult];
}
