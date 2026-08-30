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

  // Timing refs — not React state so they don't trigger re-renders in the RAF
  const startRef = useRef<number>(0);      // performance.now() at last resume
  const accRef = useRef<number>(0);        // ms accumulated before last pause
  const rafRef = useRef<number | null>(null);

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
        accRef.current = getElapsed();
        stopLoop();
      } else {
        // Tab foregrounded: reset start anchor, restart RAF
        startRef.current = performance.now();
        startLoop();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [state, getElapsed, startLoop, stopLoop]);

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  const handleStartStop = useCallback(() => {
    if (state === "idle" || state === "stopped") {
      // Start / Resume
      startRef.current = performance.now();
      setState("running");
      startLoop();
    } else {
      // Stop / Pause
      accRef.current = getElapsed();
      stopLoop();
      setState("stopped");
      setDisplayMs(accRef.current);
    }
  }, [state, getElapsed, startLoop, stopLoop]);

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
    accRef.current = 0;
    startRef.current = 0;
    setState("idle");
    setDisplayMs(0);
    setLaps([]);
  }, [stopLoop]);

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

  // Cleanup RAF on unmount
  useEffect(() => () => stopLoop(), [stopLoop]);

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

      {/* Masthead */}
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

      {/* Main content */}
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center px-4 pt-8 pb-12 sm:px-6">

        {/* ── Dial ───────────────────────────────────────────────────────── */}
        <div
          className="sw-dial"
          role="timer"
          aria-label={`Elapsed time: ${main}${sub}`}
          aria-live="off"
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
            >
              {main}
            </span>
            <span
              className="block"
              style={{
                fontSize: "clamp(28px, 7vw, 38px)",
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
        <p className="mt-4 text-center text-xs font-semibold text-race-muted">
          <span className="sw-kbd">Space</span> start/stop
          {" · "}
          <span className="sw-kbd">L</span> lap
        </p>

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

        {/* ── "Time together" stub ───────────────────────────────────────── */}
        <div className="mt-10 text-center">
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
      </div>
    </main>
  );
}
