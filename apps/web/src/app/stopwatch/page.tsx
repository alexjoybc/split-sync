"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import { formatTime, formatLapTime } from "@/lib/stopwatchFormat";
import { useWakeLock } from "./useWakeLock";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StopwatchState = "idle" | "running" | "stopped";

interface Lap {
  n: number;
  lapMs: number;      // this lap's duration
  totalMs: number;    // cumulative time at end of this lap
}

interface CasualSession {
  id: string;
  code: string;
  name: string | null;
  status: "waiting" | "running" | "stopped";
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Create-session modal
// ---------------------------------------------------------------------------

interface CreateSessionModalProps {
  user: User;
  onClose: () => void;
  onCreated: (code: string) => void;
}

function CreateSessionModal({ user, onClose, onCreated }: CreateSessionModalProps) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState(
    (user.user_metadata?.full_name as string | undefined) ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  const shareUrl = shareCode
    ? `https://splitsync.org/stopwatch/s/${shareCode}`
    : null;

  const handleCreate = async () => {
    if (!name.trim() || !displayName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("create_casual_session", {
        p_name: name.trim(),
        p_display_name: displayName.trim(),
      });
      if (rpcError) throw rpcError;
      const code = (data as { code: string }).code;
      setShareCode(code);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create session.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleJoin = () => {
    if (shareCode) {
      onCreated(shareCode);
      router.push(`/stopwatch/s/${shareCode}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-race-ink/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-session-title"
    >
      <div className="w-full max-w-sm border-2 border-race-ink bg-race-paper p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="race-kicker">Shared stopwatch</p>
            <h2 id="create-session-title" className="race-title text-xl">
              Time together
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-race-muted hover:text-race-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!shareCode ? (
          <div className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-black uppercase tracking-wide">
                Session name
              </label>
              <input
                type="text"
                className="race-input mt-1"
                placeholder="e.g. Saturday hill climb"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-black uppercase tracking-wide">
                Your display name
              </label>
              <input
                type="text"
                className="race-input mt-1"
                placeholder="e.g. Alex"
                maxLength={30}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-sm font-bold text-race-red">{error}</p>
            )}
            <button
              type="button"
              className="race-action w-full disabled:opacity-50"
              disabled={!name.trim() || !displayName.trim() || loading}
              onClick={handleCreate}
            >
              {loading ? "Creating…" : "Create session"}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <p className="text-sm font-bold text-race-ink">
              Session created! Share this link:
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl ?? ""}
                className="race-input flex-1 text-xs"
              />
              <button
                type="button"
                className="race-action shrink-0 text-xs"
                onClick={handleCopy}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-race-muted">
              Code:{" "}
              <span className="font-black tracking-widest text-race-ink">
                {shareCode}
              </span>
            </p>
            <button
              type="button"
              className="race-action w-full"
              onClick={handleJoin}
            >
              Open session →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session history
// ---------------------------------------------------------------------------

interface SessionHistoryProps {
  sessions: CasualSession[];
  loading: boolean;
}

function SessionHistory({ sessions, loading }: SessionHistoryProps) {
  if (loading) {
    return (
      <section className="mt-10 w-full">
        <p className="race-kicker mb-3">My Sessions</p>
        <p className="text-xs text-race-muted">Loading…</p>
      </section>
    );
  }

  if (sessions.length === 0) {
    return (
      <section className="mt-10 w-full">
        <p className="race-kicker mb-3">My Sessions</p>
        <p className="text-xs text-race-muted">
          No sessions yet. Click &ldquo;Time together&rdquo; to start one.
        </p>
      </section>
    );
  }

  const statusLabel = (s: CasualSession["status"]) => {
    if (s === "running") return <span className="font-black uppercase text-race-red text-[10px] tracking-widest">Running</span>;
    if (s === "waiting") return <span className="font-black uppercase text-race-muted text-[10px] tracking-widest">Waiting</span>;
    return <span className="font-black uppercase text-race-ink text-[10px] tracking-widest">Stopped</span>;
  };

  return (
    <section
      className="mt-10 w-full border-t-2 border-race-ink pt-4"
      aria-label="My timing sessions"
    >
      <p className="race-kicker mb-3">My Sessions</p>
      <div className="divide-y divide-race-line">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between gap-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-race-ink">
                {s.name ?? "(unnamed)"}
              </p>
              <div className="mt-0.5 flex items-center gap-2">
                {statusLabel(s.status)}
                <span className="text-[10px] text-race-muted">
                  {s.status === "running" ? "" : timeAgo(s.created_at)}
                </span>
                <span className="text-[10px] font-semibold text-race-muted">
                  code: {s.code}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/stopwatch/s/${s.code}`}
                className="race-action text-xs px-2 py-1"
              >
                {s.status === "stopped" ? "View" : "Join"}
              </Link>
              {s.status !== "stopped" && (
                <button
                  type="button"
                  className="race-action race-action--outline text-xs px-2 py-1"
                  onClick={async () => {
                    const url = `https://splitsync.org/stopwatch/s/${s.code}`;
                    await navigator.clipboard.writeText(url);
                  }}
                  aria-label={`Copy share link for session ${s.name ?? s.code}`}
                >
                  Share
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
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

  // Auth state (#182 — shared sessions require sign-in to create)
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Session history state (#182)
  const [sessions, setSessions] = useState<CasualSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Create-session modal (#182)
  const [showModal, setShowModal] = useState(false);

  const router = useRouter();

  // Timing refs — not React state so they don't trigger re-renders in the RAF
  const startRef = useRef<number>(0);      // performance.now() at last resume
  const accRef = useRef<number>(0);        // ms accumulated before last pause
  const rafRef = useRef<number | null>(null);

  // Screen wake lock (#230/#238) — keep display on while running.
  // Feature-detected, race-condition-safe, re-acquires on tab foreground;
  // degrades silently where unsupported (Firefox, older Safari).
  useWakeLock(state === "running");

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
  // Auth check on mount (#182)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // ---------------------------------------------------------------------------
  // Load session history when signed in (#182)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!user) {
      setSessions([]);
      return;
    }
    setSessionsLoading(true);
    supabase
      .from("casual_sessions")
      .select("id, code, name, status, created_at")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (!error && data) {
          setSessions(data as CasualSession[]);
        }
        setSessionsLoading(false);
      });

    // Real-time subscription for live status updates
    const channel = supabase
      .channel("casual_sessions_owner")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "casual_sessions",
        },
        () => {
          supabase
            .from("casual_sessions")
            .select("id, code, name, status, created_at")
            .order("created_at", { ascending: false })
            .limit(20)
            .then(({ data, error }) => {
              if (!error && data) setSessions(data as CasualSession[]);
            });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

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
        // Tab foregrounded: reset start anchor, restart RAF
        // (useWakeLock re-acquires the wake lock on its own)
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

  // Cleanup RAF on unmount (useWakeLock releases the wake lock itself)
  useEffect(() => () => stopLoop(), [stopLoop]);

  // ---------------------------------------------------------------------------
  // "Time together" button handler (#182)
  // ---------------------------------------------------------------------------

  const handleTimeTogether = useCallback(() => {
    if (authLoading) return;
    if (!user) {
      router.push("/login?next=/stopwatch");
      return;
    }
    setShowModal(true);
  }, [authLoading, user, router]);

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

  const togetherLabel = authLoading
    ? "Time together"
    : user
    ? "Time together"
    : "Sign in to share";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {showModal && user && (
        <CreateSessionModal
          user={user}
          onClose={() => setShowModal(false)}
          onCreated={() => setShowModal(false)}
        />
      )}

      <main
        className="race-page flex min-h-dvh flex-col"
        data-wake-lock-active={state === "running" ? "true" : undefined}
      >
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

          {/* ── "Time together" (#182) — hidden in large-display mode ──────── */}
          <div className={largeMode ? "hidden" : "mt-10 text-center"}>
            <button
              type="button"
              className="sw-together-btn"
              style={{
                cursor: "pointer",
                opacity: 1,
                color: "var(--race-ink)",
                borderColor: "var(--race-ink)",
              }}
              onClick={handleTimeTogether}
              aria-label={
                user
                  ? "Time together — create a shared session"
                  : "Sign in to share a timing session"
              }
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
              {togetherLabel}
            </button>
            <p className="mt-2 text-[11px] font-semibold text-race-muted">
              {user
                ? "Create a shared session — anyone with the link can join."
                : "Sign in to create a shared session with a sharable link."}
            </p>
          </div>

          {/* ── Session history (signed-in only, #182) ─────────────────────── */}
          {user && !largeMode && (
            <div className="w-full">
              <SessionHistory sessions={sessions} loading={sessionsLoading} />
            </div>
          )}

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
    </>
  );
}
