"use client";

/**
 * Countdown timer mode for the solo stopwatch surface (issue #232).
 *
 * A SINGLE countdown timer alongside the stopwatch — deliberately not a
 * multi-timer widget board (see ADR 0018, stopwatch-multi-timer-parity-no-go).
 *
 * Behavior:
 * - Set a duration (MM:SS or H:MM:SS). Start counts down to zero.
 * - On completion the timer auto-resets to the ORIGINAL duration, ready to
 *   restart with one tap (rest-interval workflow).
 * - The completion alert is finite (a few repeats, then silence) and stops
 *   with a single tap — never a looping alarm that can't be dismissed.
 * - The audible cue respects the shared #227 sound settings (soundEnabled);
 *   with sound off the completion is vibrate/visual only.
 * - Survives tab background/refresh via a wall-clock anchor persisted to
 *   localStorage (the #224 persistence pattern).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useWakeLock } from "./useWakeLock";

// ---------------------------------------------------------------------------
// Persistence (#224 pattern — wall-clock anchor survives refresh/close)
// ---------------------------------------------------------------------------

const TIMER_STORAGE_KEY = "splitsync_timer_solo_v1";

interface PersistedTimer {
  /** Only running/paused are persisted; idle clears storage. */
  state: "running" | "paused";
  /** The originally set duration — completion resets back to this. */
  durationMs: number;
  /** Wall-clock (Date.now()) when the countdown reaches zero; null when paused. */
  endAtWall: number | null;
  /** Remaining ms when paused; null when running. */
  remainingMs: number | null;
}

function readPersistedTimer(): PersistedTimer | null {
  try {
    const raw = window.localStorage.getItem(TIMER_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedTimer;
    if (
      (data.state !== "running" && data.state !== "paused") ||
      typeof data.durationMs !== "number" ||
      data.durationMs <= 0
    ) {
      return null;
    }
    if (data.state === "running" && typeof data.endAtWall !== "number") return null;
    if (data.state === "paused" && typeof data.remainingMs !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

function writePersistedTimer(data: PersistedTimer) {
  try {
    window.localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable — timer still works in-memory.
  }
}

function clearPersistedTimer() {
  try {
    window.localStorage.removeItem(TIMER_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

/** Last-used duration so the timer comes back pre-set. */
const DURATION_STORAGE_KEY = "splitsync_timer_duration_v1";
const DEFAULT_DURATION_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Sound (#227) — completion alarm respects the shared cue settings.
// The soundEnabled flag is read fresh from the same localStorage key the
// stopwatch Sound section writes, so both modes always agree.
// ---------------------------------------------------------------------------

const CUE_STORAGE_KEY = "splitsync.stopwatch.cues.v1";

function isSoundEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(CUE_STORAGE_KEY);
    if (!raw) return false;
    return (JSON.parse(raw) as { soundEnabled?: unknown }).soundEnabled === true;
  } catch {
    return false;
  }
}

function setSoundEnabled(enabled: boolean) {
  try {
    const raw = window.localStorage.getItem(CUE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(
      CUE_STORAGE_KEY,
      JSON.stringify({ ...parsed, soundEnabled: enabled })
    );
  } catch {
    // Non-fatal.
  }
}

/** Three rising tones — clearly distinct from the stopwatch's short cues. */
const ALARM_SEGMENTS = [
  { freq: 880, durationMs: 160 },
  { freq: 0, durationMs: 40 },
  { freq: 1175, durationMs: 160 },
  { freq: 0, durationMs: 40 },
  { freq: 1568, durationMs: 260 },
];

/** Finite alert: the alarm repeats at most this many times, then goes quiet. */
const ALARM_MAX_REPEATS = 6;
const ALARM_REPEAT_MS = 1_400;

// ---------------------------------------------------------------------------
// Duration input parsing/formatting
// ---------------------------------------------------------------------------

/** Parse "MM:SS", "M:SS", or "H:MM:SS" → ms, or null when invalid. */
export function parseDurationInput(value: string): number | null {
  const m = value.trim().match(/^(?:(\d{1,2}):)?(\d{1,3}):([0-5]?\d)$/);
  if (!m) return null;
  const hours = m[1] ? parseInt(m[1], 10) : 0;
  const ms =
    hours * 3_600_000 + parseInt(m[2], 10) * 60_000 + parseInt(m[3], 10) * 1_000;
  return ms > 0 ? ms : null;
}

/** Format ms → "MM:SS" or "H:MM:SS" for the input and the dial. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const mnt = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p2(mnt)}:${p2(s)}` : `${p2(mnt)}:${p2(s)}`;
}

/** Remaining time shown on the dial — ceiling so "0:00" only appears at zero. */
function formatRemaining(ms: number): string {
  return formatDuration(Math.ceil(Math.max(0, ms) / 1000) * 1000);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type TimerState = "idle" | "running" | "paused" | "alerting";

export default function CountdownTimer() {
  const [state, setState] = useState<TimerState>("idle");
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);
  const [remainingMs, setRemainingMs] = useState(DEFAULT_DURATION_MS);
  const [durationInput, setDurationInput] = useState(
    formatDuration(DEFAULT_DURATION_MS)
  );
  const [inputError, setInputError] = useState(false);
  /** Set when a persisted running timer finished while the page was closed. */
  const [finishedWhileAway, setFinishedWhileAway] = useState(false);
  const [soundOn, setSoundOn] = useState(false);

  // Timing refs — wall-clock anchors, never accumulated intervals
  const endAtWallRef = useRef<number | null>(null); // Date.now() at zero, while running
  const remainingRef = useRef<number>(DEFAULT_DURATION_MS); // ms left, while paused/idle
  const durationRef = useRef<number>(DEFAULT_DURATION_MS);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmCountRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Keep the display on while counting down (same as the running stopwatch)
  useWakeLock(state === "running");

  // -------------------------------------------------------------------------
  // Audio
  // -------------------------------------------------------------------------

  /** Create/resume the AudioContext. Must be called from a user gesture. */
  const ensureAudioCtx = useCallback((): AudioContext | null => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === "suspended") {
        void audioCtxRef.current.resume();
      }
      return audioCtxRef.current;
    } catch {
      return null;
    }
  }, []);

  const playAlarmOnce = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    let at = ctx.currentTime;
    for (const seg of ALARM_SEGMENTS) {
      const duration = seg.durationMs / 1000;
      if (seg.freq > 0) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = seg.freq;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.5, at + 0.005);
        gain.gain.setValueAtTime(0.5, at + duration - 0.01);
        gain.gain.linearRampToValueAtTime(0, at + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + duration);
      }
      at += duration;
    }
  }, []);

  const stopAlarm = useCallback(() => {
    if (alarmTimerRef.current !== null) {
      clearInterval(alarmTimerRef.current);
      alarmTimerRef.current = null;
    }
    alarmCountRef.current = 0;
  }, []);

  const startAlarm = useCallback(() => {
    // Vibrate where supported, regardless of the sound setting (vibrate-only
    // is the completion signal when sound cues are off).
    try {
      navigator.vibrate?.([200, 100, 200, 100, 400]);
    } catch {
      // Ignore.
    }
    if (!isSoundEnabled()) return;
    playAlarmOnce();
    alarmCountRef.current = 1;
    alarmTimerRef.current = setInterval(() => {
      if (alarmCountRef.current >= ALARM_MAX_REPEATS) {
        stopAlarm();
        return;
      }
      alarmCountRef.current += 1;
      playAlarmOnce();
    }, ALARM_REPEAT_MS);
  }, [playAlarmOnce, stopAlarm]);

  // -------------------------------------------------------------------------
  // Tick loop — remaining is always derived from the wall-clock anchor
  // -------------------------------------------------------------------------

  const stopTick = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const complete = useCallback(() => {
    stopTick();
    endAtWallRef.current = null;
    // Auto-reset to the ORIGINAL duration — ready to restart with one tap.
    remainingRef.current = durationRef.current;
    setRemainingMs(durationRef.current);
    setState("alerting");
    clearPersistedTimer();
    startAlarm();
  }, [stopTick, startAlarm]);

  const startTick = useCallback(() => {
    stopTick();
    tickRef.current = setInterval(() => {
      if (endAtWallRef.current === null) return;
      const remaining = endAtWallRef.current - Date.now();
      if (remaining <= 0) {
        setRemainingMs(0);
        complete();
      } else {
        setRemainingMs(remaining);
      }
    }, 100);
  }, [stopTick, complete]);

  // Snap immediately when the tab is foregrounded (intervals are throttled
  // while hidden; the wall-clock anchor keeps the value drift-free).
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden || endAtWallRef.current === null) return;
      const remaining = endAtWallRef.current - Date.now();
      if (remaining <= 0) {
        setRemainingMs(0);
        complete();
      } else {
        setRemainingMs(remaining);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [complete]);

  // -------------------------------------------------------------------------
  // Restore persisted state on mount (#224 pattern)
  // -------------------------------------------------------------------------

  useEffect(() => {
    setSoundOn(isSoundEnabled());

    // Last-used duration
    let restoredDuration = DEFAULT_DURATION_MS;
    try {
      const rawDuration = window.localStorage.getItem(DURATION_STORAGE_KEY);
      const parsed = rawDuration !== null ? Number(rawDuration) : NaN;
      if (Number.isFinite(parsed) && parsed > 0) restoredDuration = parsed;
    } catch {
      // Ignore.
    }
    durationRef.current = restoredDuration;
    remainingRef.current = restoredDuration;
    setDurationMs(restoredDuration);
    setRemainingMs(restoredDuration);
    setDurationInput(formatDuration(restoredDuration));

    const saved = readPersistedTimer();
    if (!saved) return;

    durationRef.current = saved.durationMs;
    setDurationMs(saved.durationMs);
    setDurationInput(formatDuration(saved.durationMs));

    if (saved.state === "running" && saved.endAtWall !== null) {
      const remaining = saved.endAtWall - Date.now();
      if (remaining > 0) {
        endAtWallRef.current = saved.endAtWall;
        setRemainingMs(remaining);
        setState("running");
        startTick();
      } else {
        // Finished while the page was closed. Restoring is not a user
        // action: never alarm on mount — reset quietly and say so.
        remainingRef.current = saved.durationMs;
        setRemainingMs(saved.durationMs);
        setState("idle");
        setFinishedWhileAway(true);
        clearPersistedTimer();
      }
    } else if (saved.state === "paused" && saved.remainingMs !== null) {
      remainingRef.current = saved.remainingMs;
      setRemainingMs(saved.remainingMs);
      setState("paused");
    }
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount
  useEffect(
    () => () => {
      stopTick();
      stopAlarm();
    },
    [stopTick, stopAlarm]
  );

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  const handleStart = useCallback(() => {
    // User gesture — safe to unlock the AudioContext for the completion alarm.
    if (isSoundEnabled()) ensureAudioCtx();
    setFinishedWhileAway(false);
    stopAlarm();
    const startFrom =
      state === "paused" ? remainingRef.current : durationRef.current;
    if (startFrom <= 0) return;
    endAtWallRef.current = Date.now() + startFrom;
    setRemainingMs(startFrom);
    setState("running");
    startTick();
    writePersistedTimer({
      state: "running",
      durationMs: durationRef.current,
      endAtWall: endAtWallRef.current,
      remainingMs: null,
    });
  }, [state, startTick, stopAlarm, ensureAudioCtx]);

  const handlePause = useCallback(() => {
    if (endAtWallRef.current === null) return;
    remainingRef.current = Math.max(0, endAtWallRef.current - Date.now());
    endAtWallRef.current = null;
    stopTick();
    setRemainingMs(remainingRef.current);
    setState("paused");
    writePersistedTimer({
      state: "paused",
      durationMs: durationRef.current,
      endAtWall: null,
      remainingMs: remainingRef.current,
    });
  }, [stopTick]);

  const handleReset = useCallback(() => {
    stopTick();
    stopAlarm();
    endAtWallRef.current = null;
    remainingRef.current = durationRef.current;
    setRemainingMs(durationRef.current);
    setState("idle");
    setFinishedWhileAway(false);
    clearPersistedTimer();
  }, [stopTick, stopAlarm]);

  /** Single tap silences the completion alert without restarting. */
  const handleDismissAlert = useCallback(() => {
    stopAlarm();
    setState("idle");
  }, [stopAlarm]);

  const handleDurationChange = useCallback((value: string) => {
    setDurationInput(value);
    const ms = parseDurationInput(value);
    if (ms !== null) {
      setInputError(false);
      durationRef.current = ms;
      remainingRef.current = ms;
      setDurationMs(ms);
      setRemainingMs(ms);
      try {
        window.localStorage.setItem(DURATION_STORAGE_KEY, String(ms));
      } catch {
        // Ignore.
      }
    } else {
      setInputError(true);
    }
  }, []);

  const handleSoundToggle = useCallback((enabled: boolean) => {
    setSoundOn(enabled);
    setSoundEnabled(enabled);
  }, []);

  const handlePrimary = useCallback(() => {
    if (state === "running") {
      handlePause();
    } else {
      // idle / paused / alerting → Start (an alerting tap both silences the
      // alarm and starts the next round — the rest-interval workflow).
      handleStart();
    }
  }, [state, handlePause, handleStart]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const isRunning = state === "running";
  const isAlerting = state === "alerting";
  const isIdle = state === "idle";
  const display = formatRemaining(remainingMs);
  const showsHours = display.length > 5;

  const primaryLabel = isRunning ? "Pause" : "Start";
  const secondaryLabel = isAlerting ? "Dismiss" : "Reset";

  return (
    <div className="flex w-full flex-col items-center" data-testid="timer-mode">
      {/* ── Dial ─────────────────────────────────────────────────────────── */}
      <div
        className={`sw-dial${isAlerting ? " sw-dial--countdown" : ""}`}
        role="timer"
        aria-label={
          isAlerting ? "Time's up" : `Time remaining: ${display}`
        }
        aria-live="off"
        data-testid="timer-dial"
      >
        <div className="sw-digits flex flex-col items-center">
          <span
            className="block"
            style={{
              fontSize: showsHours
                ? "clamp(30px, 8.5vw, 46px)"
                : "clamp(44px, 12vw, 64px)",
            }}
            aria-hidden="true"
            data-testid="timer-display"
          >
            {display}
          </span>
          <span
            className="mt-1 block text-[11px] font-black uppercase tracking-widest"
            style={{ color: "var(--sw-digit-sub-color)" }}
            aria-hidden="true"
          >
            {isAlerting
              ? "Time's up"
              : isRunning
              ? "Counting down"
              : state === "paused"
              ? "Paused"
              : "Timer"}
          </span>
        </div>
      </div>

      {/* ── Completion alert ─────────────────────────────────────────────── */}
      {isAlerting && (
        <p
          className="mt-4 text-center text-sm font-black uppercase tracking-wider text-race-red"
          role="alert"
          data-testid="timer-complete"
        >
          Time&apos;s up — reset to {formatDuration(durationMs)}. Tap Start to
          go again or Dismiss to silence.
        </p>
      )}

      {finishedWhileAway && (
        <p
          className="mt-4 text-center text-xs font-semibold text-race-muted"
          role="status"
          data-testid="timer-finished-while-away"
        >
          Timer finished while this page was closed — reset to{" "}
          {formatDuration(durationMs)}.
        </p>
      )}

      {/* ── Duration input (idle only) ───────────────────────────────────── */}
      {isIdle && (
        <div className="mt-6 flex items-center gap-3" data-testid="timer-setup">
          <label className="text-xs font-black uppercase tracking-wide">
            Duration
            <span className="ml-1 font-semibold normal-case tracking-normal text-race-muted">
              (MM:SS or H:MM:SS)
            </span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={durationInput}
            onChange={(e) => handleDurationChange(e.target.value)}
            onBlur={() => {
              setDurationInput(formatDuration(durationMs));
              setInputError(false);
            }}
            className={`w-24 border-2 bg-white px-2 py-1 text-center font-black tabular-nums ${
              inputError ? "border-race-red" : "border-race-ink"
            }`}
            aria-label="Timer duration (minutes and seconds, or hours, minutes and seconds)"
            aria-invalid={inputError}
            placeholder="05:00"
            data-testid="timer-duration-input"
          />
        </div>
      )}

      {/* ── Pushers ──────────────────────────────────────────────────────── */}
      <div
        className="mt-10 flex items-center justify-center"
        style={{ gap: "var(--sw-pusher-gap)" }}
      >
        <button
          type="button"
          className={`sw-pusher ${
            isIdle && !isAlerting
              ? "sw-pusher--secondary-idle"
              : "sw-pusher--secondary"
          }`}
          onClick={isAlerting ? handleDismissAlert : handleReset}
          aria-label={
            isAlerting ? "Dismiss alert" : "Reset timer to set duration"
          }
          disabled={isIdle && remainingMs === durationMs && !finishedWhileAway}
          data-testid="timer-secondary-btn"
        >
          {secondaryLabel}
        </button>

        <button
          type="button"
          className="sw-pusher sw-pusher--primary"
          onClick={handlePrimary}
          aria-label={isRunning ? "Pause timer" : "Start timer"}
          data-testid="timer-primary-btn"
        >
          {primaryLabel}
        </button>
      </div>

      {/* ── Sound setting (#227 — same flag as the stopwatch cues) ───────── */}
      <section
        className="mt-8 w-full border-t-2 border-race-ink pt-4"
        aria-label="Timer sound settings"
      >
        <p className="race-kicker mb-3">Sound</p>
        <label className="flex items-center justify-between gap-3 text-sm font-semibold">
          <span>
            Sound on completion
            <span className="ml-1 text-xs font-semibold text-race-muted">
              (off = vibrate/visual only)
            </span>
          </span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--race-red)]"
            checked={soundOn}
            onChange={(e) => handleSoundToggle(e.target.checked)}
            data-testid="timer-sound-toggle"
          />
        </label>
        <p className="mt-2 text-xs text-race-muted">
          The alert repeats a few times, then goes quiet on its own — one tap
          on Dismiss (or Start) silences it immediately.
        </p>
      </section>
    </div>
  );
}
