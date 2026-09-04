import { describe, expect, it } from "vitest";
import { getElapsedMs, getRemainingMs } from "./elapsed";
import { applyEvent } from "./reducer";
import type { SessionEvent, SessionStateJSON, TimerState } from "./types";

const at = "2026-09-04T12:00:00.000Z";
const stopwatch: TimerState = { id: "sw", name: "Clock", mode: "stopwatch", status: "idle", elapsedMs: 0, startedAt: null, laps: [] };
const timer: TimerState = { id: "tm", name: "Intervals", mode: "timer", status: "idle", elapsedMs: 0, startedAt: null, durationMs: 60_000, phase: "work", repeatConfig: null, repsDone: 0 };
const state = (): SessionStateJSON => ({ schemaVersion: 1, id: "session", name: "Training", kind: "local", shared: null, createdAt: at, updatedAt: at, timerOrder: ["sw", "tm"], timers: { sw: stopwatch, tm: timer } });
const event = <T extends SessionEvent>(value: Omit<T, "sessionId" | "clientRecordedAt" | "sequence">): T => ({ ...value, sessionId: "session", clientRecordedAt: at, sequence: 1 }) as T;

describe("applyEvent", () => {
  it("keeps concurrent-looking timer interleavings independent", () => {
    const startedStopwatch = applyEvent(state(), event({ id: "1", type: "start", timerId: "sw", payload: {} }));
    const bothRunning = applyEvent(startedStopwatch, event({ id: "2", type: "start", timerId: "tm", payload: {} }));
    const pausedStopwatch = applyEvent(bothRunning, event({ id: "3", type: "pause", timerId: "sw", payload: {} }));
    expect(pausedStopwatch.timers.sw.status).toBe("paused");
    expect(pausedStopwatch.timers.tm.status).toBe("running");
  });

  it("renames and reorders timers without dropping omitted timers", () => {
    const renamed = applyEvent(state(), event({ id: "4", type: "timer_renamed", timerId: "tm", payload: { name: "Warmup" } }));
    const reordered = applyEvent(renamed, event({ id: "5", type: "timers_reordered", timerId: null, payload: { timerOrder: ["tm"] } }));
    expect(reordered.timers.tm.name).toBe("Warmup");
    expect(reordered.timerOrder).toEqual(["tm", "sw"]);
  });

  it("advances Pomodoro work/rest phases and counts work repetitions", () => {
    const configured = applyEvent(state(), event({ id: "6", type: "repeat_config_set", timerId: "tm", payload: { config: { repeatCount: 2, restDurationMs: 10_000 } } }));
    const running = applyEvent(configured, event({ id: "7", type: "start", timerId: "tm", payload: {} }));
    const resting = applyEvent(running, event({ id: "8", type: "complete", timerId: "tm", payload: {} }));
    const nextWork = applyEvent(resting, event({ id: "9", type: "complete", timerId: "tm", payload: {} }));
    expect(resting.timers.tm).toMatchObject({ phase: "rest", repsDone: 1, status: "running" });
    expect(nextWork.timers.tm).toMatchObject({ phase: "work", repsDone: 1, status: "running" });
  });

  it("makes an event replay a strict no-op", () => {
    const start = event({ id: "same", type: "start", timerId: "sw", payload: {} });
    const once = applyEvent(state(), start);
    expect(applyEvent(once, start)).toBe(once);
  });

  it("derives elapsed and countdown remaining from wall-clock anchors", () => {
    const running: TimerState = { ...timer, status: "running", startedAt: at, elapsedMs: 2_000 };
    expect(getElapsedMs(running, Date.parse(at) + 5_000)).toBe(7_000);
    expect(getRemainingMs(running, Date.parse(at) + 5_000)).toBe(53_000);
  });

  it("reset clears repsDone accumulated during a Pomodoro run", () => {
    const configured = applyEvent(state(), event({ id: "r1", type: "repeat_config_set", timerId: "tm", payload: { config: { repeatCount: 3, restDurationMs: 0 } } }));
    const running = applyEvent(configured, event({ id: "r2", type: "start", timerId: "tm", payload: {} }));
    const afterRep = applyEvent(running, event({ id: "r3", type: "complete", timerId: "tm", payload: {} }));
    expect(afterRep.timers.tm.mode === "timer" && afterRep.timers.tm.repsDone).toBeGreaterThan(0);
    const reset = applyEvent(afterRep, event({ id: "r4", type: "reset", timerId: "tm", payload: {} }));
    expect(reset.timers.tm.mode === "timer" && reset.timers.tm.repsDone).toBe(0);
    expect(reset.timers.tm.status).toBe("idle");
  });

  it("timer_added + timer_removed round-trip cleans up timerOrder", () => {
    const newTimer: TimerState = { id: "extra", name: "Extra", mode: "stopwatch", status: "idle", elapsedMs: 0, startedAt: null, laps: [] };
    const added = applyEvent(state(), event({ id: "a1", type: "timer_added", timerId: "extra", payload: { timer: newTimer } }));
    expect(added.timerOrder).toContain("extra");
    expect("extra" in added.timers).toBe(true);
    const removed = applyEvent(added, event({ id: "a2", type: "timer_removed", timerId: "extra", payload: {} }));
    expect(removed.timerOrder).not.toContain("extra");
    expect("extra" in removed.timers).toBe(false);
    // Original timers are preserved
    expect(removed.timerOrder).toEqual(["sw", "tm"]);
  });
});
