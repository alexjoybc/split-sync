import type { TimerState } from "./types";

/** Derive elapsed time from an immutable wall-clock anchor; interval ticks never accumulate time. */
export function getElapsedMs(timer: TimerState, now = Date.now()): number {
  if (timer.status !== "running" || timer.startedAt === null) return Math.max(0, timer.elapsedMs);
  const anchor = Date.parse(timer.startedAt);
  return Math.max(0, timer.elapsedMs + (Number.isNaN(anchor) ? 0 : now - anchor));
}

/** Remaining time for a countdown timer. Stopwatch timers intentionally have no remaining duration. */
export function getRemainingMs(timer: TimerState, now = Date.now()): number | null {
  if (timer.mode === "stopwatch") return null;
  const phaseDuration = timer.phase === "rest" ? timer.repeatConfig?.restDurationMs ?? 0 : timer.durationMs;
  return Math.max(0, phaseDuration - getElapsedMs(timer, now));
}
