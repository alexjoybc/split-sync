import type { Crossing, Entry } from "./types";

export interface StandingRow {
  position: number;
  bib: string;
  name: string;
  team: string | null;
  laps: number;
  lastCrossingAt: number | null; // epoch ms
  lastLapMs: number | null;
  gapText: string; // "—" for leader, "+12.3", "+1:04.2", "-2 laps"
  isUnknownBib: boolean;
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
      times,
    };
  });

  rows.sort((a, b) => {
    if (a.laps !== b.laps) return b.laps - a.laps;
    if (a.lastCrossingAt == null && b.lastCrossingAt == null) return 0;
    if (a.lastCrossingAt == null) return 1;
    if (b.lastCrossingAt == null) return -1;
    return a.lastCrossingAt - b.lastCrossingAt;
  });

  const leader = rows[0];

  return rows.map((r, i) => {
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
    };
  });
}
