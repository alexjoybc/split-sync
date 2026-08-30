"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatTime, formatLapTime } from "@/lib/stopwatchFormat";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StopwatchState = "idle" | "running" | "stopped";

interface Lap {
  n: number;
  lapMs: number;      // this lap's duration
  totalMs: number;    // cumulative time at end of this lap
}

// ---------------------------------------------------------------------------
// Stopwatch component
// ---------------------------------------------------------------------------

export default function StopwatchPage() {
  const [state, setState] = useState<StopwatchState>("idle");
  const [displayMs, setDisplayMs] = useState(0);
  const [laps, setLaps] = useState<Lap[]>([]);

  // Large-display mode (#230) — enlarged timer, best-effort browser fullscreen
  const [largeMode, setLargeMode] = useState(false);
  const enteredFullscreenRef = useRef(false);

  // Timing refs — not React state so they don't trigger re-renders in the RAF
  const startRef = useRef<number>(0);      // performance.now() at last resume
  const accRef = useRef<number>(0);        // ms accumulated before last pause
  const rafRef = useRef<number | null>(null);

  // Screen wake lock (#230) — keep display on while running; feature-detected,
  // degrades silently where unsupported (Firefox, older Safari)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const acquireWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      // Unsupported, denied, or page not visible — degrade silently.
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
  }, []);

  // Derived elapsed ms from refs
  const getElapsed = useCallback(() => {
    return accRef.current + (performance.now() - startRef.current);
  }, []);

  // ---------------------------------------------------------------------------
  // RAF loop
  // ---------------------------------------------------------------------------

  const startLoop = useCallback(() => {
    const tick = () => {
      setDisplayMs(getElapsed());
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [getElapsed]);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Visibility change — pause/resume RAF without losing accumulated time
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleVisibility = () => {
      if (state !== "running") return;
      if (document.hidden) {
        // Tab backgrounded: accumulate what we have, stop RAF
        // (the browser auto-releases the wake lock on visibility loss)
        accRef.current = getElapsed();
        stopLoop();
      } else {
        // Tab foregrounded: reset start anchor, restart RAF, re-acquire wake lock
        startRef.current = performance.now();
        startLoop();
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [state, getElapsed, startLoop, stopLoop, acquireWakeLock]);

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  const handleStartStop = useCallback(() => {
    if (state === "idle" || state === "stopped") {
      // Start / Resume
      startRef.current = performance.now();
      setState("running");
      startLoop();
      void acquireWakeLock();
    } else {
      // Stop / Pause
      accRef.current = getElapsed();
      stopLoop();
      setState("stopped");
      setDisplayMs(accRef.current);
      releaseWakeLock();
    }
  }, [state, getElapsed, startLoop, stopLoop, acquireWakeLock, releaseWakeLock]);

  const handleLap = useCallback(() => {
    if (state !== "running") return;
    const totalMs = getElapsed();
    setLaps((prev) => {
      const prevTotal = prev.length > 0 ? prev[prev.length - 1].totalMs : 0;
      return [
        ...prev,
        {
          n: prev.length + 1,
          lapMs: totalMs - prevTotal,
          totalMs,
        },
      ];
    });
  }, [state, getElapsed]);

  const handleReset = useCallback(() => {
    stopLoop();
    releaseWakeLock();
    accRef.current = 0;
    startRef.current = 0;
    setState("idle");
    setDisplayMs(0);
    setLaps([]);
  }, [stopLoop, releaseWakeLock]);

  // ---------------------------------------------------------------------------
  // Large-display mode (#230)
  // ---------------------------------------------------------------------------

  const toggleLargeMode = useCallback(() => {
    setLargeMode((prev) => {
      const next = !prev;
      if (next) {
        // Best-effort fullscreen; large layout applies regardless of outcome
        const el = document.documentElement;
        if (typeof el.requestFullscreen === "function") {
          el.requestFullscreen()
            .then(() => {
              enteredFullscreenRef.current = true;
            })
            .catch(() => undefined);
        }
      } else if (document.fullscreenElement) {
        enteredFullscreenRef.current = false;
        document.exitFullscreen().catch(() => undefined);
      }
      return next;
    });
  }, []);

  // Leaving browser fullscreen (Esc / system UI) also exits large mode
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && enteredFullscreenRef.current) {
        enteredFullscreenRef.current = false;
        setLargeMode(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Secondary pusher: lap when running, reset when stopped/idle
  const handleSecondary = useCallback(() => {
    if (state === "running") {
      handleLap();
    } else {
      handleReset();
    }
  }, [state, handleLap, handleReset]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when focus is in an input/button (avoid accidental triggers)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.code === "Space") {
        e.preventDefault();
        handleStartStop();
      } else if (e.code === "KeyL") {
        e.preventDefault();
        handleSecondary();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleStartStop, handleSecondary]);

  // Cleanup RAF + wake lock on unmount
  useEffect(
    () => () => {
      stopLoop();
      releaseWakeLock();
    },
    [stopLoop, releaseWakeLock]
  );

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------

  const { main, sub } = formatTime(displayMs);
  // Past 1 hour the main readout grows from "MM:SS" to "H:MM:SS" — shrink the
  // digits so the dial still fits on small screens (#225).
  const showsHours = main.length > 5;

  const bestLapMs = laps.length > 0 ? Math.min(...laps.map((l) => l.lapMs)) : null;

  const secondaryLabel =
    state === "running" ? "Lap" : state === "stopped" ? "Reset" : "Reset";

  const primaryLabel = state === "running" ? "Stop" : "Start";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="race-page flex min-h-dvh flex-col">
      {/* Red topline — spectator surface */}
      <div className="race-topline" />

      {/* Masthead — hidden in large-display mode to maximise the timer */}
      {!largeMode && (
        <header className="race-masthead no-print">
          <div className="mx-auto flex max-w-lg items-end justify-between gap-4">
            <div>
              <p className="race-kicker">Solo timer</p>
              <h1 className="race-title">Stopwatch</h1>
            </div>
            <Link href="/" className="race-action race-action--outline text-sm">
              SplitSync
            </Link>
          </div>
        </header>
      )}

      {/* Main content */}
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center px-4 pt-8 pb-12 sm:px-6">

        {/* ── Positioning strip ──────────────────────────────────────────── */}
        <p
          className="mb-8 text-center text-[11px] font-black uppercase tracking-widest text-race-muted"
          aria-label="Free. No ads. No subscription. No account needed."
        >
          Free
          <span className="mx-2 text-race-red" aria-hidden="true">·</span>
          No ads
          <span className="mx-2 text-race-red" aria-hidden="true">·</span>
          No subscription
          <span className="mx-2 text-race-red" aria-hidden="true">·</span>
          No account
        </p>

        {/* ── Dial ───────────────────────────────────────────────────────── */}
        <div
          className={largeMode ? "sw-dial sw-dial--large" : "sw-dial"}
          role="timer"
          aria-label={`Elapsed time: ${main}${sub}`}
          aria-live="off"
        >
          <div className="sw-digits flex flex-col items-center">
            <span
              className="block"
              style={{
                fontSize: largeMode
                  ? showsHours
                    ? "clamp(48px, 16vmin, 132px)"
                    : "clamp(64px, 22vmin, 180px)"
                  : showsHours
                    ? "clamp(30px, 8.5vw, 46px)"
                    : "clamp(44px, 12vw, 64px)",
              }}
              aria-hidden="true"
            >
              {main}
            </span>
            <span
              className="block"
              style={{
                fontSize: largeMode
                  ? "clamp(36px, 12vmin, 100px)"
                  : "clamp(28px, 7vw, 38px)",
                color: "var(--sw-digit-sub-color)",
              }}
              aria-hidden="true"
            >
              {sub}
            </span>
          </div>
        </div>

        {/* ── Pushers ────────────────────────────────────────────────────── */}
        <div
          className="mt-10 flex items-center justify-center"
          style={{ gap: "var(--sw-pusher-gap)" }}
        >
          {/* Secondary: lap / reset */}
          <button
            type="button"
            className={`sw-pusher ${
              state === "idle"
                ? "sw-pusher--secondary-idle"
                : "sw-pusher--secondary"
            }`}
            onClick={handleSecondary}
            aria-label={
              state === "running"
                ? "Record lap (keyboard: L)"
                : "Reset stopwatch (keyboard: L)"
            }
            disabled={state === "idle"}
          >
            {secondaryLabel}
          </button>

          {/* Primary: start / stop */}
          <button
            type="button"
            className="sw-pusher sw-pusher--primary"
            onClick={handleStartStop}
            aria-label={
              state === "running"
                ? "Stop stopwatch (keyboard: Space)"
                : "Start stopwatch (keyboard: Space)"
            }
          >
            {primaryLabel}
          </button>
        </div>

        {/* Keyboard hint */}
        {!largeMode && (
          <p className="mt-4 text-center text-xs font-semibold text-race-muted">
            <span className="sw-kbd">Space</span> start/stop
            {" · "}
            <span className="sw-kbd">L</span> lap
          </p>
        )}

        {/* Large-display / fullscreen toggle (#230) */}
        <button
          type="button"
          className="race-action race-action--outline mt-4 text-xs"
          onClick={toggleLargeMode}
          aria-pressed={largeMode}
          aria-label={
            largeMode ? "Exit large display mode" : "Enter large display mode"
          }
        >
          {largeMode ? "Exit large display" : "Large display"}
        </button>

        {/* ── Lap list ───────────────────────────────────────────────────── */}
        {laps.length > 0 && (
          <section
            className="mt-8 w-full border-t-2 border-race-ink pt-4"
            aria-label="Lap times"
          >
            <p className="race-kicker mb-3">Laps</p>
            <table className="sw-lap-table" aria-label="Lap times table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Lap</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {/* Show newest laps first */}
                {[...laps].reverse().map((lap) => {
                  const isBest = lap.lapMs === bestLapMs;
                  return (
                    <tr
                      key={lap.n}
                      className={isBest ? "sw-lap-row--best" : undefined}
                      aria-label={
                        isBest
                          ? `Lap ${lap.n} — best lap: ${formatLapTime(lap.lapMs)}`
                          : `Lap ${lap.n}: ${formatLapTime(lap.lapMs)}`
                      }
                    >
                      <td>
                        {isBest && (
                          <span
                            className="mr-1 text-[10px] font-black uppercase tracking-wider"
                            aria-hidden="true"
                          >
                            ★
                          </span>
                        )}
                        {lap.n}
                      </td>
                      <td>{formatLapTime(lap.lapMs)}</td>
                      <td>{formatLapTime(lap.totalMs)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {/* ── "Time together" stub — hidden in large-display mode ────────── */}
        <div className={largeMode ? "hidden" : "mt-10 text-center"}>
          <span
            className="sw-together-btn"
            title="Shared sessions coming soon (#182)"
            aria-label="Time together — shared sessions not yet available"
            aria-disabled="true"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            >
              <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="9" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M1 12c0-2.2 1.8-4 4-4M9 8c2.2 0 4 1.8 4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Time together
            <span className="text-[9px] font-black uppercase tracking-widest opacity-60">
              (coming soon)
            </span>
          </span>
          <p className="mt-2 text-[11px] font-semibold text-race-muted">
            Share a session and time together in real time.
          </p>
        </div>

        {/* ── The promise, spelled out ───────────────────────────────────── */}
        <section
          className="mt-10 w-full border-t-2 border-race-ink pt-4 text-center"
          aria-label="Why SplitSync Stopwatch is free"
        >
          <p className="race-kicker mb-2">The deal</p>
          <p className="text-sm font-semibold text-zinc-700">
            This stopwatch is free. No ads interrupting your timing, no
            subscription, and no account needed to time solo. Joining a shared
            session asks only for a display name — never a sign-up.
          </p>
        </section>
      </div>
    </main>
  );
}
