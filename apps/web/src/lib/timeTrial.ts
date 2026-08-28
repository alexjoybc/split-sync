import type { Crossing, Entry, EntryStatus } from "./types";

/**
 * Time-trial scoring — a pure derived module that reads raw crossings and
 * entries and returns elapsed-time standings, queue, and progress state.
 * No I/O, no Supabase calls. See docs/adr/0014-time-trial-race-type.md.
 *
 * Model:
 *   0 crossings → queued
 *   1 crossing  → running (startedAt = first crossing)
 *   2 crossings → finished (startedAt = 1st, finishedAt = 2nd, elapsedMs = diff)
 *   3+ crossings → needs-review (elapsedMs still 1st–2nd as best-effort)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimeTrialPhase = "queued" | "running" | "finished" | "needs-review";

export interface TimeTrialRow {
  bib: string;
  name: string;
  team: string | null;
  phase: TimeTrialPhase;
  startedAt: number | null; // epoch ms
  finishedAt: number | null; // epoch ms
  elapsedMs: number | null;
  position: number | null; // null if not ranked (queued/running/dns/dnf/dsq)
  gapText: string; // "—" for leader, "+N.N" for others, "" if not ranked
  status: EntryStatus; // from entry; 'ok' for queued/running/finished/needs-review
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Format a duration in tenths-of-a-second precision, e.g. "1:04.2" or "9.3". */
function fmtElapsed(ms: number): string {
  const totalTenths = Math.round(ms / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60);
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}.${tenths}`;
  return `${s}.${tenths}`;
}

/** Build a map of bib → sorted crossing times (epoch ms), skipping deleted crossings. */
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

/** Derive phase + timing fields for a single bib given its sorted crossings. */
function derivePhase(
  times: number[]
): Pick<TimeTrialRow, "phase" | "startedAt" | "finishedAt" | "elapsedMs"> {
  if (times.length === 0) {
    return { phase: "queued", startedAt: null, finishedAt: null, elapsedMs: null };
  }
  if (times.length === 1) {
    return { phase: "running", startedAt: times[0], finishedAt: null, elapsedMs: null };
  }
  // 2 or more: use 1st + 2nd as start/finish
  const startedAt = times[0];
  const finishedAt = times[1];
  const elapsedMs = finishedAt - startedAt;
  const phase: TimeTrialPhase = times.length === 2 ? "finished" : "needs-review";
  return { phase, startedAt, finishedAt, elapsedMs };
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Natural (numeric-aware) sort for bib strings so "9" < "10" < "20".
 * Non-numeric bibs fall back to locale-compare.
 */
export function sortBibsNaturally(bibs: string[]): string[] {
  return [...bibs].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}

/**
 * Progress bar semantics for a rider currently in the `running` phase.
 * @param elapsedMs    How long the rider has been on course (now - startedAt).
 * @param referenceMs  Best finished time, or null if no one has finished yet.
 */
export function getProgress(
  elapsedMs: number,
  referenceMs: number | null
): { pct: number; indeterminate: boolean; overtimeMs: number | null } {
  if (referenceMs == null || referenceMs <= 0) {
    return { pct: 0, indeterminate: true, overtimeMs: null };
  }
  if (elapsedMs >= referenceMs) {
    return { pct: 100, indeterminate: false, overtimeMs: elapsedMs - referenceMs };
  }
  return {
    pct: Math.round((elapsedMs / referenceMs) * 100),
    indeterminate: false,
    overtimeMs: null,
  };
}

// ---------------------------------------------------------------------------
// Main scoring functions
// ---------------------------------------------------------------------------

/**
 * Returns the riders who have not yet started (phase === 'queued'), in
 * natural bib order, excluding DNS/DNF/DSQ entries.
 */
export function computeTimeTrialQueue(crossings: Crossing[], entries: Entry[]): TimeTrialRow[] {
  const timesByBib = crossingTimesByBib(crossings);

  const queued: TimeTrialRow[] = [];
  for (const entry of entries) {
    if (entry.status !== "ok") continue;
    const times = timesByBib.get(entry.bib) ?? [];
    const derived = derivePhase(times);
    if (derived.phase !== "queued") continue;
    queued.push({
      bib: entry.bib,
      name: entry.name,
      team: entry.team,
      ...derived,
      position: null,
      gapText: "",
      status: entry.status,
    });
  }

  const sortedBibs = sortBibsNaturally(queued.map((r) => r.bib));
  const bibOrder = new Map(sortedBibs.map((b, i) => [b, i]));
  queued.sort((a, b) => (bibOrder.get(a.bib) ?? 0) - (bibOrder.get(b.bib) ?? 0));

  return queued;
}

/**
 * Returns all entries, ranked by elapsed time ascending (finished/needs-review),
 * plus DNS/DNF/DSQ riders appended at the end sorted alphabetically.
 *
 * Only `finished` and `needs-review` entries receive a numeric position and
 * gapText. `queued` and `running` entries are not ranked (position = null).
 */
export function computeTimeTrialResults(crossings: Crossing[], entries: Entry[]): TimeTrialRow[] {
  const timesByBib = crossingTimesByBib(crossings);

  const ranked: (TimeTrialRow & { elapsedMs: number })[] = [];
  const unrankedOk: TimeTrialRow[] = []; // queued + running — no position yet
  const statused: TimeTrialRow[] = []; // dns / dnf / dsq

  for (const entry of entries) {
    const times = timesByBib.get(entry.bib) ?? [];

    if (entry.status !== "ok") {
      statused.push({
        bib: entry.bib,
        name: entry.name,
        team: entry.team,
        phase: "queued", // phase is irrelevant for non-ok; use queued as sentinel
        startedAt: null,
        finishedAt: null,
        elapsedMs: null,
        position: null,
        gapText: "",
        status: entry.status,
      });
      continue;
    }

    const derived = derivePhase(times);

    if (derived.phase === "finished" || derived.phase === "needs-review") {
      ranked.push({
        bib: entry.bib,
        name: entry.name,
        team: entry.team,
        ...derived,
        elapsedMs: derived.elapsedMs!, // guaranteed non-null for finished/needs-review
        position: null, // filled in after sort
        gapText: "", // filled in after sort
        status: entry.status,
      });
    } else {
      unrankedOk.push({
        bib: entry.bib,
        name: entry.name,
        team: entry.team,
        ...derived,
        position: null,
        gapText: "",
        status: entry.status,
      });
    }
  }

  // Sort finished entries by elapsed time ascending
  ranked.sort((a, b) => a.elapsedMs - b.elapsedMs);

  const leaderMs = ranked.length > 0 ? ranked[0].elapsedMs : null;

  const rankedResult: TimeTrialRow[] = ranked.map((r, i) => ({
    ...r,
    position: i + 1,
    gapText: i === 0 ? "—" : `+${fmtElapsed(r.elapsedMs - leaderMs!)}`,
  }));

  // DNS/DNF/DSQ sorted alphabetically by name then bib (same as standings.ts)
  statused.sort((a, b) => a.name.localeCompare(b.name) || a.bib.localeCompare(b.bib));

  return [...rankedResult, ...unrankedOk, ...statused];
}
