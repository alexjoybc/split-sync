// ---------------------------------------------------------------------------
// Stopwatch time formatting (pure functions, unit-tested)
// ---------------------------------------------------------------------------

function p2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Format milliseconds for the main stopwatch dial.
 * - Under 1 hour: `MM:SS` + `.hh`
 * - 1 hour and beyond: `H:MM:SS` + `.hh` (#225)
 */
export function formatTime(ms: number): { main: string; sub: string } {
  const hundredths = Math.floor(ms / 10) % 100;
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const main =
    hours > 0
      ? `${hours}:${p2(minutes)}:${p2(seconds)}`
      : `${p2(minutes)}:${p2(seconds)}`;
  return { main, sub: `.${p2(hundredths)}` };
}

/**
 * Format a lap split / cumulative duration.
 * - Under 1 minute: `S.hh`
 * - Under 1 hour: `M:SS.hh`
 * - 1 hour and beyond: `H:MM:SS.hh` (#225)
 */
export function formatLapTime(ms: number): string {
  const hundredths = Math.floor((ms % 1000) / 10);
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}:${p2(minutes)}:${p2(seconds)}.${p2(hundredths)}`;
  }
  if (minutes > 0) {
    return `${minutes}:${p2(seconds)}.${p2(hundredths)}`;
  }
  return `${seconds}.${p2(hundredths)}`;
}
