import { getElapsedMs } from "./elapsed";
import type { SessionEvent, SessionStateJSON, TimerState } from "./types";

function timestamp(event: SessionEvent): string {
  return Number.isNaN(Date.parse(event.clientRecordedAt)) ? "1970-01-01T00:00:00.000Z" : event.clientRecordedAt;
}

function updated(state: SessionStateJSON, event: SessionEvent): SessionStateJSON {
  return { ...state, updatedAt: timestamp(event), appliedEventIds: [...(state.appliedEventIds ?? []), event.id] };
}

function timerFor(state: SessionStateJSON, timerId: string | null): TimerState | null {
  return timerId === null ? null : state.timers[timerId] ?? null;
}

function replaceTimer(state: SessionStateJSON, timer: TimerState): SessionStateJSON {
  return { ...state, timers: { ...state.timers, [timer.id]: timer } };
}

/**
 * Pure event reducer. Events are applied in the canonical log order supplied by
 * the caller (server sequence for shared sessions). Invalid/stale events are no-ops.
 */
export function applyEvent(state: SessionStateJSON, event: SessionEvent): SessionStateJSON {
  if (event.sessionId !== state.id || (state.appliedEventIds ?? []).includes(event.id)) return state;
  let next = updated(state, event);
  const now = Date.parse(timestamp(event));

  if (event.type === "session_renamed") return { ...next, name: event.payload.name };
  if (event.type === "timers_reordered") {
    const requested = event.payload.timerOrder.filter((id, index, all) => id in state.timers && all.indexOf(id) === index);
    return { ...next, timerOrder: [...requested, ...state.timerOrder.filter((id) => !requested.includes(id) && id in state.timers)] };
  }
  if (event.type === "timer_added") {
    const timer = event.payload.timer;
    if (timer.id in state.timers) return state;
    return { ...next, timers: { ...state.timers, [timer.id]: timer }, timerOrder: [...state.timerOrder, timer.id] };
  }
  if (event.type === "timer_removed") {
    if (!event.timerId || !(event.timerId in state.timers)) return state;
    const { [event.timerId]: _, ...timers } = state.timers;
    return { ...next, timers, timerOrder: state.timerOrder.filter((id) => id !== event.timerId) };
  }

  const timer = timerFor(state, event.timerId);
  if (!timer) return state;
  if (event.type === "timer_renamed") return replaceTimer(next, { ...timer, name: event.payload.name });
  if (event.type === "repeat_config_set") {
    return timer.mode === "timer" ? replaceTimer(next, { ...timer, repeatConfig: event.payload.config }) : state;
  }
  if (event.type === "start") {
    if (timer.status === "running" || timer.status === "completed") return state;
    return replaceTimer(next, { ...timer, status: "running", startedAt: timestamp(event) });
  }
  if (event.type === "pause") {
    if (timer.status !== "running") return state;
    return replaceTimer(next, { ...timer, status: "paused", elapsedMs: getElapsedMs(timer, now), startedAt: null });
  }
  if (event.type === "reset") {
    return replaceTimer(next, timer.mode === "stopwatch"
      ? { ...timer, status: "idle", elapsedMs: 0, startedAt: null, laps: [] }
      : { ...timer, status: "idle", elapsedMs: 0, startedAt: null, phase: "work", repsDone: 0 });
  }
  if (event.type === "lap") {
    if (timer.mode !== "stopwatch" || timer.status !== "running") return state;
    const elapsedMs = Math.max(0, event.payload.elapsedMs ?? getElapsedMs(timer, now));
    return replaceTimer(next, { ...timer, laps: [...timer.laps, { recordedAt: timestamp(event), elapsedMs }] });
  }
  if (event.type === "complete") {
    if (timer.mode !== "timer" || timer.status !== "running") return state;
    const completedWork = timer.phase === "work" ? timer.repsDone + 1 : timer.repsDone;
    const repeatConfig = timer.repeatConfig;
    const hasMore = repeatConfig !== null && (repeatConfig.repeatCount === null || completedWork < repeatConfig.repeatCount);
    if (hasMore && repeatConfig !== null && timer.phase === "work" && repeatConfig.restDurationMs > 0) {
      return replaceTimer(next, { ...timer, status: "running", phase: "rest", repsDone: completedWork, elapsedMs: 0, startedAt: timestamp(event) });
    }
    if (hasMore && (timer.phase === "rest" || repeatConfig?.restDurationMs === 0)) {
      return replaceTimer(next, { ...timer, status: "running", phase: "work", repsDone: completedWork, elapsedMs: 0, startedAt: timestamp(event) });
    }
    return replaceTimer(next, { ...timer, status: "completed", elapsedMs: timer.phase === "work" ? timer.durationMs : repeatConfig?.restDurationMs ?? 0, startedAt: null, repsDone: completedWork });
  }
  return state;
}
