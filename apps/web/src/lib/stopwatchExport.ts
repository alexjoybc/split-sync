// Casual stopwatch lap export helpers (#226).
//
// Shared by the solo stopwatch page (/stopwatch) and the shared-session
// results page (/stopwatch/s/[code]/results). Pure functions + one tiny DOM
// download helper — no Supabase, no React.

import { formatLapTime } from "./stopwatchFormat";

export interface ExportLap {
  lap: number;
  splitMs: number;
  cumulativeMs: number;
  /** Display name of whoever recorded the lap (shared sessions only). */
  actor?: string;
}

/** Format milliseconds → S.hh / M:SS.hh / H:MM:SS.hh (shared with the live dial, #225). */
export const fmtClock = formatLapTime;

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Laps (ascending lap order) → CSV. Includes a recorded_by column only when any lap has an actor. */
export function lapsToCsv(laps: ExportLap[]): string {
  const withActor = laps.some((l) => l.actor !== undefined);
  const header = withActor
    ? "lap,split,total,split_ms,total_ms,recorded_by"
    : "lap,split,total,split_ms,total_ms";
  const rows = laps.map((l) => {
    const base = [
      String(l.lap),
      fmtClock(l.splitMs),
      fmtClock(l.cumulativeMs),
      String(Math.round(l.splitMs)),
      String(Math.round(l.cumulativeMs)),
    ];
    if (withActor) base.push(csvField(l.actor ?? ""));
    return base.join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}

/** Laps (ascending lap order) → human-readable text for copy/share. */
export function lapsToText(
  title: string,
  totalMs: number | null,
  laps: ExportLap[]
): string {
  const bestMs = laps.length > 0 ? Math.min(...laps.map((l) => l.splitMs)) : null;
  const summary = [
    totalMs !== null ? `Total ${fmtClock(totalMs)}` : null,
    `${laps.length} lap${laps.length === 1 ? "" : "s"}`,
    bestMs !== null ? `Best ${fmtClock(bestMs)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = laps.map((l) => {
    const actor = l.actor ? `  by ${l.actor}` : "";
    return `Lap ${l.lap}  ${fmtClock(l.splitMs)}  (${fmtClock(l.cumulativeMs)})${actor}`;
  });
  return [`${title} — SplitSync Stopwatch`, summary, "", ...lines].join("\n");
}

/** Trigger a browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
