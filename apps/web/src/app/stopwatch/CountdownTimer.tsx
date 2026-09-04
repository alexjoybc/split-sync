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

// ---------------------------------------------------------------------------
// Wall-clock readout helpers (#421)
// ---------------------------------------------------------------------------

/** Format a wall-clock epoch ms as a short locale time string, e.g. "2:14 PM". */
function fmtWallTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Format elapsed ms as "Xs ago" or "Xm ago" for the time-since-alarm readout. */
function fmtTimeSince(elapsedMs: number): string {
  const secs = Math.floor(elapsedMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}
import { useWakeLock } from "./useWakeLock";
import {
  readActiveTimerState,
  writeActiveTimerState,
  clearActiveTimerState,
  readActiveTimerDurationMs,
  writeActiveTimerDurationMs,
  DEFAULT_TIMER_DURATION_MS,
} from "./soloSessionStorage";

// ---------------------------------------------------------------------------
// Persistence (#224 pattern — wall-clock anchor survives refresh/close)
// ---------------------------------------------------------------------------
//
// Storage is delegated to the multi-session layer (soloSessionStorage.ts).
// These thin wrappers keep the rest of the file unchanged.

function readPersistedTimer() {
  return readActiveTimerState();
}

function writePersistedTimer(data: {
  state: "running" | "paused";
  durationMs: number;
  endAtWall: number | null;
  remainingMs: number | null;
}) {
  writeActiveTimerState(data);
}

function clearPersistedTimer() {
  clearActiveTimerState();
}

const DEFAULT_DURATION_MS = DEFAULT_TIMER_DURATION_MS;

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

// ---------------------------------------------------------------------------
// Countdown beep — square-wave oscillator (same design as page.tsx)
// ---------------------------------------------------------------------------

/**
 * Play a short square-wave beep. Safe to call with a null ctx (no-op).
 * @param freq   Frequency in Hz
 * @param dur    Duration in ms
 * @param peak   Peak gain (0–1)
 */
function beepTone(
  ctx: AudioContext,
  freq: number,
  dur: number,
  peak = 0.2
) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(peak, ctx.currentTime + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + dur / 1000);
  } catch {
    // Ignore — audio context may have been closed.
  }
}

/** Seconds that receive an individual beep cue during countdown. */
const BEEP_SECONDS = new Set([10, 5, 4, 3, 2, 1]);

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
  /**
   * Fullscreen countdown overlay.
   * null  = hidden
   * number = show that second in the big overlay (5 → 1)
   * "GO"  = show "GO!" for ~1 s after reaching zero
   */
  const [countdownOverlay, setCountdownOverlay] = useState<number | "GO" | null>(null);

  // Wall-clock readouts (#421): start time, ETA, time-since-alarm
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [etaMs, setEtaMs] = useState<number | null>(null);
  const [alarmFiredAtMs, setAlarmFiredAtMs] = useState<number | null>(null);
  const [timeSinceAlarmMs, setTimeSinceAlarmMs] = useState(0);
  const alarmTickRef2 = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timing refs — wall-clock anchors, never accumulated intervals
  const endAtWallRef = useRef<number | null>(null); // Date.now() at zero, while running
  const remainingRef = useRef<number>(DEFAULT_DURATION_MS); // ms left, while paused/idle
  const durationRef = useRef<number>(DEFAULT_DURATION_MS);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmCountRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Fullscreen tracking
  const enteredFsRef = useRef(false);
  /** Dedup beep: store the last second that triggered a beep. */
  const lastBeepedSecRef = useRef<number>(-1);
  /** Timer ID for the "GO" overlay auto-dismiss. */
  const goTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the display on while counting down (same as the running stopwatch)
  useWakeLock(state === "running");

  // -------------------------------------------------------------------------
  // Fullscreen helpers
  // -------------------------------------------------------------------------

  const enterFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (typeof el.requestFullscreen === "function" && !document.fullscreenElement) {
      el.requestFullscreen().then(() => {
        enteredFsRef.current = true;
      }).catch(() => undefined);
    }
  }, []);

  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement && enteredFsRef.current) {
      enteredFsRef.current = false;
      document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  const clearOverlay = useCallback(() => {
    if (goTimerRef.current !== null) {
      clearTimeout(goTimerRef.current);
      goTimerRef.current = null;
    }
    setCountdownOverlay(null);
    exitFullscreen();
  }, [exitFullscreen]);

  // Sync when user presses Esc / browser exits fullscreen unilaterally
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && enteredFsRef.current) {
        enteredFsRef.current = false;
        setCountdownOverlay(null);
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

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
    // Play GO beep — longer and louder than the tick beeps.
    const ctx = audioCtxRef.current;
    if (ctx && isSoundEnabled()) {
      beepTone(ctx, 880, 300, 0.3);
    }
    // Show "GO!" overlay for 1 s then exit fullscreen and proceed to alert.
    setCountdownOverlay("GO");
    goTimerRef.current = setTimeout(() => {
      goTimerRef.current = null;
      setCountdownOverlay(null);
      exitFullscreen();
      // Auto-reset to the ORIGINAL duration — ready to restart with one tap.
      remainingRef.current = durationRef.current;
      setRemainingMs(durationRef.current);
      // Record the moment the alarm fired for the time-since-alarm readout (#421).
      setAlarmFiredAtMs(Date.now());
      setState("alerting");
      clearPersistedTimer();
      startAlarm();
    }, 1000);
  }, [stopTick, startAlarm, exitFullscreen]);

  const startTick = useCallback(() => {
    stopTick();
    lastBeepedSecRef.current = -1;
    tickRef.current = setInterval(() => {
      if (endAtWallRef.current === null) return;
      const remaining = endAtWallRef.current - Date.now();
      if (remaining <= 0) {
        setRemainingMs(0);
        complete();
      } else {
        setRemainingMs(remaining);
        const secs = Math.ceil(remaining / 1000);

        // Per-second dedup: only fire once per displayed second.
        if (secs !== lastBeepedSecRef.current) {
          lastBeepedSecRef.current = secs;

          // Beep cue: at 10 s (single warning) and at 5→1 s.
          const ctx = audioCtxRef.current;
          if (ctx && isSoundEnabled() && BEEP_SECONDS.has(secs)) {
            beepTone(ctx, 660, 80, 0.18);
          }

          // Auto-enter fullscreen and show big overlay at 5 s.
          if (secs === 5) {
            enterFullscreen();
          }

          // Update overlay when we're in the final 5 seconds.
          if (secs <= 5) {
            setCountdownOverlay(secs);
          }
        }
      }
    }, 100);
  }, [stopTick, complete, enterFullscreen]);

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
  // Live time-since-alarm counter (#421) — updates every second while alerting
  // -------------------------------------------------------------------------

  useEffect(() => {
    const alerting = state === "alerting";
    if (!alerting || alarmFiredAtMs === null) {
      if (alarmTickRef2.current !== null) {
        clearInterval(alarmTickRef2.current);
        alarmTickRef2.current = null;
      }
      return;
    }
    const fired = alarmFiredAtMs;
    setTimeSinceAlarmMs(Date.now() - fired);
    alarmTickRef2.current = setInterval(() => {
      setTimeSinceAlarmMs(Date.now() - fired);
    }, 1000);
    return () => {
      if (alarmTickRef2.current !== null) {
        clearInterval(alarmTickRef2.current);
        alarmTickRef2.current = null;
      }
    };
  }, [state, alarmFiredAtMs]);

  // -------------------------------------------------------------------------
  // Restore persisted state on mount (#224 pattern)
  // -------------------------------------------------------------------------

  useEffect(() => {
    setSoundOn(isSoundEnabled());

    // Last-used duration — read from the active session (falls back to default).
    const restoredDuration = readActiveTimerDurationMs();
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
      if (goTimerRef.current !== null) clearTimeout(goTimerRef.current);
      if (alarmTickRef2.current !== null) clearInterval(alarmTickRef2.current);
    },
    [stopTick, stopAlarm]
  );

  // -------------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------------

  const handleStart = useCallback(() => {
    // User gesture — safe to unlock the AudioContext for the completion alarm.
    // Always ensure the ctx so beep cues work even when the sound setting was
    // turned on after the page loaded.
    ensureAudioCtx();
    setFinishedWhileAway(false);
    stopAlarm();
    // Record start time when starting a fresh round (not resuming a pause).
    // Also clear any stale alarm data from a prior completed round (#421).
    const now = Date.now();
    if (state !== "paused") {
      setStartedAtMs(now);
    }
    setAlarmFiredAtMs(null);
    setTimeSinceAlarmMs(0);
    const startFrom =
      state === "paused" ? remainingRef.current : durationRef.current;
    if (startFrom <= 0) return;
    endAtWallRef.current = now + startFrom;
    // Store ETA as state so it's readable during render without ref access (#421).
    setEtaMs(now + startFrom);
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
    const now = Date.now();
    remainingRef.current = Math.max(0, endAtWallRef.current - now);
    endAtWallRef.current = null;
    clearOverlay();
    stopTick();
    setRemainingMs(remainingRef.current);
    // Update ETA to reflect remaining time from now (#421).
    setEtaMs(now + remainingRef.current);
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
    clearOverlay();
    endAtWallRef.current = null;
    remainingRef.current = durationRef.current;
    setRemainingMs(durationRef.current);
    setState("idle");
    setFinishedWhileAway(false);
    clearPersistedTimer();
    // Clear wall-clock readouts (#421).
    setStartedAtMs(null);
    setEtaMs(null);
    setAlarmFiredAtMs(null);
    setTimeSinceAlarmMs(0);
  }, [stopTick, stopAlarm, clearOverlay]);

  /** Single tap silences the completion alert without restarting. */
  const handleDismissAlert = useCallback(() => {
    stopAlarm();
    setState("idle");
    // Clear alarm readouts — user dismissed, back to idle (#421).
    setAlarmFiredAtMs(null);
    setEtaMs(null);
    setTimeSinceAlarmMs(0);
    setStartedAtMs(null);
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
      writeActiveTimerDurationMs(ms);
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
    <>
      {/* ── Fullscreen final-seconds overlay ─────────────────────────────── */}
      {countdownOverlay !== null && (
        <div
          role="status"
          aria-live="assertive"
          aria-label={
            countdownOverlay === "GO"
              ? "Go!"
              : `${countdownOverlay} seconds`
          }
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#000",
            color: "#fff",
          }}
          data-testid="timer-countdown-overlay"
        >
          <span
            aria-hidden="true"
            style={{
              fontFamily: "monospace",
              fontWeight: 900,
              fontSize: "clamp(160px, 40vw, 320px)",
              lineHeight: 1,
              letterSpacing: "-0.04em",
              color: countdownOverlay === "GO" ? "#22c55e" : "#fff",
            }}
          >
            {countdownOverlay === "GO" ? "GO!" : countdownOverlay}
          </span>
          {countdownOverlay !== "GO" && (
            <span
              aria-hidden="true"
              style={{
                marginTop: "1rem",
                fontSize: "clamp(18px, 4vw, 32px)",
                fontWeight: 700,
                letterSpacing: "0.25em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.55)",
              }}
            >
              seconds
            </span>
          )}
        </div>
      )}

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

      {/* ── Wall-clock readouts: start time + ETA (#421) ────────────────── */}
      {(isRunning || state === "paused") && startedAtMs !== null && etaMs !== null && (
        <div
          className="mt-3 flex flex-col items-center gap-0.5 text-xs font-semibold text-race-muted"
          data-testid="timer-readouts"
        >
          <span data-testid="timer-start-time">
            Started {fmtWallTime(startedAtMs)}
          </span>
          <span data-testid="timer-eta">
            Finishes at {fmtWallTime(etaMs)}
          </span>
        </div>
      )}

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

      {/* ── Time-since-alarm readout (#421) — live counter while alerting ── */}
      {isAlerting && alarmFiredAtMs !== null && (
        <p
          className="mt-1 text-center text-xs font-semibold text-race-muted"
          aria-live="polite"
          data-testid="timer-since-alarm"
        >
          Rang {fmtTimeSince(timeSinceAlarmMs)}
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
    </>
  );
}
