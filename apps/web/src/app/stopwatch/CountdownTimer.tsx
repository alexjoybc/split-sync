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
// `stopwatch/layout.tsx` also imports this module, but that file is a
// Server Component (it exports `metadata`), so its import only evaluates
// during SSR and never reaches the browser bundle — `@material/web`'s
// `customElements.define()` calls are guarded to no-op outside a DOM
// environment, so the elements never actually register client-side from
// that import alone. Re-importing it here (a "use client" module) is what
// makes the registration actually reach the browser for this screen.
import "./md3-components";
import {
  readActiveTimerState,
  writeActiveTimerState,
  clearActiveTimerState,
  readActiveTimerDurationMs,
  writeActiveTimerDurationMs,
  readActiveRepeatConfig,
  writeActiveRepeatConfig,
  DEFAULT_TIMER_DURATION_MS,
} from "./soloSessionStorage";

// ---------------------------------------------------------------------------
// MD3 web component JSX typings (#443)
//
// `@material/web` custom elements aren't known to TypeScript's JSX namespace
// out of the box. React 19 has first-class support for custom elements: it
// sets a prop as a DOM *property* when that property exists on the element
// instance (e.g. `value`, `selected`), otherwise falls back to a plain HTML
// attribute (e.g. `aria-label`, `data-testid`). Lowercase `on<event>` props
// (e.g. `onchange`, `oninput`, `onfocusout`) are wired up as native
// `addEventListener` calls with the *exact* event name — that's the
// supported mechanism for a custom element's non-standard events, distinct
// from React's camelCase synthetic `onChange`/`onInput` used on built-in
// form elements. See react-dom's `setPropOnCustomElement`.
//
// The interfaces below are intentionally permissive (index signature) since
// this is presentational markup, not domain logic — precise typing of every
// MD3 attribute isn't worth the churn here.
//
// `md-outlined-button` and `md-outlined-text-field` are NOT re-declared
// here: SoloSessionSwitcher.tsx (#444) already augments `JSX.IntrinsicElements`
// for both (widened with an index signature so this file's extra attributes
// — `type`, `inputMode`, `error`, `errorText`, `oninput`, `onfocusout`, etc.
// — type-check too). TypeScript's declaration merging requires every module
// augmentation of the same intrinsic element to agree on its exact type, so
// redeclaring either tag with a different (even if compatible-in-spirit)
// type here would fail the build with "Subsequent property declarations
// must have the same type."
// ---------------------------------------------------------------------------

type Md3ElementProps = React.DetailedHTMLProps<
  React.HTMLAttributes<HTMLElement>,
  HTMLElement
> & {
  [prop: string]: unknown;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "md-filled-tonal-button": Md3ElementProps;
      "md-switch": Md3ElementProps;
      "md-outlined-card": Md3ElementProps;
    }
  }
}

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

/**
 * Whether vibration is enabled for the countdown timer completion alert.
 * Defaults to true so existing users keep the current behaviour.
 */
function isVibrationEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(CUE_STORAGE_KEY);
    if (!raw) return true; // default on
    const parsed = JSON.parse(raw) as { vibrationEnabled?: unknown };
    // Explicit false opt-out; anything else (missing key, true) stays on.
    return parsed.vibrationEnabled !== false;
  } catch {
    return true;
  }
}

function setVibrationEnabled(enabled: boolean) {
  try {
    const raw = window.localStorage.getItem(CUE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(
      CUE_STORAGE_KEY,
      JSON.stringify({ ...parsed, vibrationEnabled: enabled })
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
  const [vibrationOn, setVibrationOn] = useState(true);
  /**
   * Fullscreen countdown overlay.
   * null  = hidden
   * number = show that second in the big overlay (5 → 1)
   * "GO"  = show "GO!" for ~1 s after reaching zero
   */
  const [countdownOverlay, setCountdownOverlay] = useState<number | "GO" | null>(null);
  /**
   * On-demand fullscreen mode — shows the current remaining time in a
   * full-screen high-contrast overlay, reachable at any point (not only
   * the terminal 5-second auto-overlay). The 5-second auto-overlay takes
   * visual precedence (higher z-index) when both are active.
   */
  const [manualFsMode, setManualFsMode] = useState(false);

  // ── Repeat / Pomodoro mode state (ADR 0025) ──────────────────────────────────
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [restDurationMs, setRestDurationMs] = useState(60_000); // 1 min default
  const [restInput, setRestInput] = useState("01:00");
  const [repeatCount, setRepeatCount] = useState<number | null>(null); // null = ∞
  const [repeatCountInput, setRepeatCountInput] = useState(""); // "" = ∞
  /**
   * Current repeat phase. Only meaningful when repeatEnabled is true and timer
   * is running/paused. Never persisted — resets to "work" on page reload.
   */
  const [currentPhase, setCurrentPhase] = useState<"work" | "rest">("work");
  /**
   * Number of fully-completed work+rest cycles in the current run.
   * Never persisted.
   */
  const [completedCycles, setCompletedCycles] = useState(0);

  // Repeat refs — mirror the corresponding state for use inside callbacks
  const repeatEnabledRef = useRef(false);
  const repeatCountRef = useRef<number | null>(null);
  const restDurationMsRef = useRef(60_000);
  const currentPhaseRef = useRef<"work" | "rest">("work");
  const completedCyclesRef = useRef(0);

  // Timing refs — wall-clock anchors, never accumulated intervals
  const endAtWallRef = useRef<number | null>(null); // Date.now() at zero, while running
  const remainingRef = useRef<number>(DEFAULT_DURATION_MS); // ms left, while paused/idle
  const durationRef = useRef<number>(DEFAULT_DURATION_MS);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmCountRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Ref to the latest startTick — lets complete() call startTick() without
  // creating a circular useCallback dependency.
  const startTickRef = useRef<() => void>(() => undefined);

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

  // ── On-demand fullscreen (available at any time) ──────────────────────
  const enterManualFs = useCallback(() => {
    setManualFsMode(true);
    enterFullscreen();
  }, [enterFullscreen]);

  const exitManualFs = useCallback(() => {
    setManualFsMode(false);
    exitFullscreen();
  }, [exitFullscreen]);

  const toggleManualFs = useCallback(() => {
    if (manualFsMode) {
      exitManualFs();
    } else {
      enterManualFs();
    }
  }, [manualFsMode, enterManualFs, exitManualFs]);

  // Sync when user presses Esc / browser exits fullscreen unilaterally
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && enteredFsRef.current) {
        enteredFsRef.current = false;
        setCountdownOverlay(null);
        setManualFsMode(false);
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
    // Vibrate only when the vibration setting is on (default).
    if (isVibrationEnabled()) {
      try {
        navigator.vibrate?.([200, 100, 200, 100, 400]);
      } catch {
        // Ignore.
      }
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
    const ctx = audioCtxRef.current;

    if (!repeatEnabledRef.current) {
      // ── Original single-shot behavior ──────────────────────────────────────
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
        setState("alerting");
        clearPersistedTimer();
        startAlarm();
      }, 1000);
      return;
    }

    // ── Repeat mode: transition based on current phase ─────────────────────
    if (currentPhaseRef.current === "work") {
      const newCycles = completedCyclesRef.current + 1;
      completedCyclesRef.current = newCycles;
      setCompletedCycles(newCycles);

      const isLastCycle =
        repeatCountRef.current !== null && newCycles >= repeatCountRef.current;

      if (isLastCycle) {
        // Final cycle complete — play GO tone, show overlay, then alert.
        if (ctx && isSoundEnabled()) {
          beepTone(ctx, 880, 300, 0.3);
        }
        setCountdownOverlay("GO");
        goTimerRef.current = setTimeout(() => {
          goTimerRef.current = null;
          setCountdownOverlay(null);
          exitFullscreen();
          // Reset cycle tracking for next run.
          currentPhaseRef.current = "work";
          setCurrentPhase("work");
          completedCyclesRef.current = 0;
          setCompletedCycles(0);
          remainingRef.current = durationRef.current;
          setRemainingMs(durationRef.current);
          setState("alerting");
          clearPersistedTimer();
          startAlarm();
        }, 1000);
      } else {
        // Work phase done — start rest phase automatically.
        const restMs = restDurationMsRef.current;
        if (restMs <= 0) {
          // No rest: immediately start next work phase.
          if (ctx && isSoundEnabled()) {
            beepTone(ctx, 880, 150, 0.2);
          }
          currentPhaseRef.current = "work";
          setCurrentPhase("work");
          endAtWallRef.current = Date.now() + durationRef.current;
          remainingRef.current = durationRef.current;
          setRemainingMs(durationRef.current);
          setState("running");
          startTickRef.current();
        } else {
          // Start rest phase.
          if (ctx && isSoundEnabled()) {
            beepTone(ctx, 660, 150, 0.2);
          }
          currentPhaseRef.current = "rest";
          setCurrentPhase("rest");
          endAtWallRef.current = Date.now() + restMs;
          remainingRef.current = restMs;
          setRemainingMs(restMs);
          setState("running");
          startTickRef.current();
        }
      }
    } else {
      // Rest phase done — start next work phase.
      if (ctx && isSoundEnabled()) {
        beepTone(ctx, 880, 150, 0.2);
      }
      currentPhaseRef.current = "work";
      setCurrentPhase("work");
      endAtWallRef.current = Date.now() + durationRef.current;
      remainingRef.current = durationRef.current;
      setRemainingMs(durationRef.current);
      setState("running");
      startTickRef.current();
    }
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

  // Keep the ref current so complete() can call startTick() without a circular dep.
  // This runs after every render — useEffect without deps — so startTickRef always
  // points to the latest startTick closure, avoiding stale ref issues.
  useEffect(() => {
    startTickRef.current = startTick;
  });

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
    setVibrationOn(isVibrationEnabled());

    // Last-used duration — read from the active session (falls back to default).
    const restoredDuration = readActiveTimerDurationMs();
    durationRef.current = restoredDuration;
    remainingRef.current = restoredDuration;
    setDurationMs(restoredDuration);
    setRemainingMs(restoredDuration);
    setDurationInput(formatDuration(restoredDuration));

    // Restore repeat config if one was saved for this session.
    const savedRepeat = readActiveRepeatConfig();
    if (savedRepeat) {
      setRepeatEnabled(true);
      repeatEnabledRef.current = true;
      setRestDurationMs(savedRepeat.restDurationMs);
      restDurationMsRef.current = savedRepeat.restDurationMs;
      setRestInput(formatDuration(savedRepeat.restDurationMs));
      setRepeatCount(savedRepeat.repeatCount);
      repeatCountRef.current = savedRepeat.repeatCount;
      setRepeatCountInput(
        savedRepeat.repeatCount === null ? "" : String(savedRepeat.repeatCount)
      );
    }

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
    // Reset cycle tracking when starting fresh from idle or alerting states.
    if (state === "idle" || state === "alerting") {
      currentPhaseRef.current = "work";
      setCurrentPhase("work");
      completedCyclesRef.current = 0;
      setCompletedCycles(0);
    }
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
    clearOverlay();
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
    clearOverlay();
    endAtWallRef.current = null;
    remainingRef.current = durationRef.current;
    setRemainingMs(durationRef.current);
    setState("idle");
    setFinishedWhileAway(false);
    clearPersistedTimer();
    // Reset repeat cycle tracking.
    currentPhaseRef.current = "work";
    setCurrentPhase("work");
    completedCyclesRef.current = 0;
    setCompletedCycles(0);
  }, [stopTick, stopAlarm, clearOverlay]);

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
      writeActiveTimerDurationMs(ms);
    } else {
      setInputError(true);
    }
  }, []);

  const handleSoundToggle = useCallback((enabled: boolean) => {
    setSoundOn(enabled);
    setSoundEnabled(enabled);
  }, []);

  const handleVibrationToggle = useCallback((enabled: boolean) => {
    setVibrationOn(enabled);
    setVibrationEnabled(enabled);
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

  // Repeat mode display helpers
  const showRepeatInfo = repeatEnabled && (isRunning || state === "paused");
  const currentCycleNum =
    currentPhase === "work" ? completedCycles + 1 : completedCycles;
  const repeatCycleLabel =
    currentPhase === "work"
      ? `Cycle ${currentCycleNum}${repeatCount !== null ? ` of ${repeatCount}` : ""}`
      : `Rest (after cycle ${completedCycles}${repeatCount !== null ? ` of ${repeatCount}` : ""})`;
  const repeatPhaseText = currentPhase === "work" ? "WORK" : "REST";

  return (
    <>
      {/* ── On-demand fullscreen overlay (lower z-index than 5-s auto overlay) */}
      {manualFsMode && countdownOverlay === null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={
            isAlerting
              ? "Time's up — fullscreen view"
              : `Timer fullscreen — ${display} remaining`
          }
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#000",
            color: "#fff",
            cursor: "pointer",
          }}
          onClick={exitManualFs}
          data-testid="timer-manual-fs-overlay"
        >
          <span
            aria-hidden="true"
            style={{
              fontFamily: "monospace",
              fontWeight: 900,
              fontSize: "clamp(64px, 22vw, 200px)",
              lineHeight: 1,
              letterSpacing: "-0.04em",
              color: isAlerting ? "var(--race-red)" : "#fff",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {display}
          </span>
          <span
            aria-hidden="true"
            style={{
              marginTop: "1.5rem",
              fontSize: "clamp(14px, 3vw, 24px)",
              fontWeight: 700,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: isAlerting ? "var(--race-red)" : "rgba(255,255,255,0.55)",
            }}
          >
            {isAlerting
              ? "Time's up"
              : isRunning
              ? "Counting down"
              : state === "paused"
              ? "Paused"
              : "Timer"}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); exitManualFs(); }}
            aria-label="Exit fullscreen"
            style={{
              marginTop: "3rem",
              padding: "0.5rem 1.5rem",
              background: "transparent",
              border: "2px solid rgba(255,255,255,0.35)",
              borderRadius: "4px",
              color: "rgba(255,255,255,0.55)",
              fontSize: "clamp(11px, 2vw, 14px)",
              fontWeight: 700,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
            data-testid="timer-fs-exit-btn"
          >
            Tap anywhere or press Esc to exit fullscreen
          </button>
        </div>
      )}

      {/* ── Fullscreen final-seconds overlay (auto, higher z-index) ────────── */}
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
              ? repeatEnabled
                ? `${repeatPhaseText} — Counting down`
                : "Counting down"
              : state === "paused"
              ? repeatEnabled
                ? `${repeatPhaseText} — Paused`
                : "Paused"
              : "Timer"}
          </span>
        </div>
      </div>

      {/* ── Repeat mode phase / cycle indicator ─────────────────────────── */}
      {showRepeatInfo && (
        <div className="mt-3 flex flex-col items-center gap-0.5">
          <span
            className="text-xs font-black uppercase tracking-widest"
            style={{ color: "var(--sw-digit-sub-color)" }}
            data-testid="repeat-phase-label"
            aria-label={`Phase: ${repeatPhaseText}`}
          >
            {repeatPhaseText}
          </span>
          <span
            className="text-[11px] font-semibold text-race-muted"
            data-testid="repeat-cycle-label"
            aria-label={repeatCycleLabel}
          >
            {repeatCycleLabel}
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

      {/* ── Duration / repeat settings (idle only) — MD3 chrome (#443) ──────
          The instrument dial/pushers above and below stay untouched; only
          this settings panel adopts @material/web components. */}
      {isIdle && (
        <md-outlined-card
          className="mt-6 block w-full"
          data-testid="timer-setup"
        >
          <div className="p-4">
            <div className="flex items-center gap-3">
              <md-outlined-text-field
                className="w-32"
                label="Duration (MM:SS or H:MM:SS)"
                type="text"
                inputMode="numeric"
                value={durationInput}
                error={inputError}
                errorText="Use MM:SS or H:MM:SS"
                placeholder="05:00"
                oninput={(e: Event) => {
                  handleDurationChange((e.target as HTMLInputElement).value);
                }}
                onfocusout={() => {
                  setDurationInput(formatDuration(durationMs));
                  setInputError(false);
                }}
                aria-label="Timer duration (minutes and seconds, or hours, minutes and seconds)"
                aria-invalid={inputError ? "true" : "false"}
                data-testid="timer-duration-input"
              />
            </div>

            {/* ── Repeat / Pomodoro mode (ADR 0025) ─────────────────────────── */}
            <div className="mt-4 border-t-2 border-race-ink pt-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-black uppercase tracking-wide">
                <md-switch
                  selected={repeatEnabled}
                  onchange={(e: Event) => {
                    const on = (e.target as HTMLInputElement & { selected: boolean })
                      .selected;
                    setRepeatEnabled(on);
                    repeatEnabledRef.current = on;
                    writeActiveRepeatConfig(
                      on ? { restDurationMs, repeatCount } : null
                    );
                  }}
                  data-testid="repeat-mode-toggle"
                  aria-label="Enable repeat / Pomodoro mode"
                />
                Repeat mode
                <span className="ml-0.5 font-semibold normal-case tracking-normal text-race-muted">
                  (Pomodoro / intervals)
                </span>
              </label>

              {repeatEnabled && (
                <div className="mt-3 space-y-3 pl-1">
                  <div className="flex items-center gap-3">
                    <label className="w-32 text-xs font-bold uppercase tracking-wide text-race-muted">
                      Rest duration
                      <span className="ml-1 font-semibold normal-case">
                        (MM:SS)
                      </span>
                    </label>
                    <md-outlined-text-field
                      className="w-28"
                      type="text"
                      inputMode="numeric"
                      value={restInput}
                      data-testid="repeat-rest-input"
                      placeholder="01:00"
                      oninput={(e: Event) => {
                        const value = (e.target as HTMLInputElement).value;
                        setRestInput(value);
                        const ms = parseDurationInput(value);
                        if (ms !== null) {
                          setRestDurationMs(ms);
                          restDurationMsRef.current = ms;
                          writeActiveRepeatConfig({ restDurationMs: ms, repeatCount });
                        }
                      }}
                      onfocusout={() => {
                        const ms = parseDurationInput(restInput);
                        setRestInput(formatDuration(ms !== null ? ms : restDurationMs));
                      }}
                      aria-label="Rest phase duration (minutes and seconds)"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="w-32 text-xs font-bold uppercase tracking-wide text-race-muted">
                      Repeat count
                      <span className="ml-1 font-semibold normal-case">
                        (blank = ∞)
                      </span>
                    </label>
                    <md-outlined-text-field
                      className="w-28"
                      type="text"
                      inputMode="numeric"
                      value={repeatCountInput}
                      data-testid="repeat-count-input"
                      placeholder="∞"
                      oninput={(e: Event) => {
                        const raw = (e.target as HTMLInputElement).value.replace(
                          /[^0-9]/g,
                          ""
                        );
                        setRepeatCountInput(raw);
                        const n =
                          raw === ""
                            ? null
                            : Math.max(1, Math.min(99, parseInt(raw, 10)));
                        setRepeatCount(n);
                        repeatCountRef.current = n;
                        writeActiveRepeatConfig({ restDurationMs, repeatCount: n });
                      }}
                      aria-label="Number of repeat cycles (blank for infinite)"
                    />
                  </div>
                  <p className="text-[11px] text-race-muted">
                    Work phase uses the duration above. Rest phase follows automatically.
                    Stop is always available to end the cycle.
                  </p>
                </div>
              )}
            </div>
          </div>
        </md-outlined-card>
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

      {/* ── On-demand fullscreen button (#422) — MD3 chrome (#443) ────────── */}
      {manualFsMode ? (
        <md-filled-tonal-button
          className="mt-4"
          onClick={toggleManualFs}
          aria-pressed={manualFsMode ? "true" : "false"}
          aria-label="Exit fullscreen timer"
          data-testid="timer-fullscreen-btn"
        >
          Exit fullscreen
        </md-filled-tonal-button>
      ) : (
        <md-outlined-button
          className="mt-4"
          onClick={toggleManualFs}
          aria-pressed={manualFsMode ? "true" : "false"}
          aria-label="Enter fullscreen timer"
          data-testid="timer-fullscreen-btn"
        >
          Fullscreen
        </md-outlined-button>
      )}

      {/* ── Alert settings (#227 / #420) — MD3 chrome (#443) ──────────────── */}
      <section
        className="mt-8 w-full border-t-2 border-race-ink pt-4"
        aria-label="Timer alert settings"
      >
        <p className="race-kicker mb-3">Alert</p>

        <label className="flex items-center justify-between gap-3 text-sm font-semibold">
          <span>Sound on completion</span>
          <md-switch
            selected={soundOn}
            onchange={(e: Event) =>
              handleSoundToggle(
                (e.target as HTMLInputElement & { selected: boolean }).selected
              )
            }
            data-testid="timer-sound-toggle"
            aria-label="Sound on completion"
          />
        </label>

        <label className="mt-3 flex items-center justify-between gap-3 text-sm font-semibold">
          <span>Vibration on completion</span>
          <md-switch
            selected={vibrationOn}
            onchange={(e: Event) =>
              handleVibrationToggle(
                (e.target as HTMLInputElement & { selected: boolean }).selected
              )
            }
            data-testid="timer-vibration-toggle"
            aria-label="Vibration on completion"
          />
        </label>

        <p className="mt-3 text-xs text-race-muted">
          The alert repeats a few times, then goes quiet on its own — one tap
          on Dismiss (or Start) silences it immediately.
          {!soundOn && !vibrationOn && (
            <strong className="ml-1 text-race-ink">
              Both sound and vibration are off — watch for the visual{" "}
              &ldquo;Time&apos;s up&rdquo; alert on screen.
            </strong>
          )}
        </p>
      </section>
    </div>
    </>
  );
}
