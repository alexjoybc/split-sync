"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import { formatTime, formatLapTime } from "@/lib/stopwatchFormat";
import { useWakeLock } from "./useWakeLock";
import { downloadCsv, lapsToCsv, lapsToText } from "@/lib/stopwatchExport";
import CountdownTimer from "./CountdownTimer";
import { TrashIcon } from "@heroicons/react/20/solid";
import {
  runMigrationIfNeeded,
  getOrCreateActiveSession,
  readActiveStopwatchState,
  writeActiveStopwatchState,
  clearActiveStopwatchState,
  readActiveMode,
  writeActiveMode,
  type SoloMode,
  type Lap as SessionLap,
} from "./soloSessionStorage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StopwatchState = "idle" | "countdown" | "running" | "stopped";

// Solo mode: stopwatch (count up) or a single countdown timer (#232).
// One timer only — multi-timer boards are a deliberate no-go (ADR 0018).
// SoloMode is imported from soloSessionStorage (shared with the storage layer).

type DelayOption = 0 | 3 | 5 | 10;
const DELAY_OPTIONS: DelayOption[] = [0, 3, 5, 10];
const DELAY_LABELS: Record<DelayOption, string> = { 0: "OFF", 3: "3s", 5: "5s", 10: "10s" };
const DELAY_STORAGE_KEY = "sw_delay_seconds";

// Lap type is re-exported from soloSessionStorage.
type Lap = SessionLap;

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

function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Mirrors the storage shape/key used by the shared-session page
// (apps/web/src/app/stopwatch/s/[code]/page.tsx) so the creator's own
// browser recognizes them as the existing owner participant instead of
// falling through to JoinForm (#332). `client_id` is not returned by
// create_casual_session (the owner row's client_id is generated
// server-side and is not needed for local matching — isOwner is derived
// from participant_id), so a fresh local UUID is stored as a placeholder.
interface StoredParticipant {
  session_id: string;
  participant_id: string;
  client_id: string;
  display_name: string;
}

function storageKey(code: string): string {
  return `splitsync_stopwatch_${code}`;
}

function saveStoredParticipant(code: string, data: StoredParticipant): void {
  try {
    localStorage.setItem(storageKey(code), JSON.stringify(data));
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

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
      const result = data as {
        session_id: string;
        participant_id: string;
        code: string;
      };
      // Persist the creator's own participant identity so /stopwatch/s/[code]
      // recognizes them as the owner instead of routing them through
      // JoinForm and creating a second, non-owner participant row (#332).
      saveStoredParticipant(result.code, {
        session_id: result.session_id,
        participant_id: result.participant_id,
        client_id: generateUUID(),
        display_name: displayName.trim(),
      });
      setShareCode(result.code);
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
  // confirmingDeleteId: the session currently showing the inline confirmation prompt
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  // deletingId: the session currently being deleted (RPC in-flight)
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // deleteError: per-session inline error message
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});

  async function handleDelete(sessionId: string) {
    setDeletingId(sessionId);
    setConfirmingDeleteId(null);
    setDeleteError((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    try {
      const { error } = await supabase.rpc("delete_casual_session", {
        p_session_id: sessionId,
      });
      if (error) throw error;
      // Row disappears via the real-time subscription that re-renders the list.
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Could not delete session.";
      setDeleteError((prev) => ({ ...prev, [sessionId]: msg }));
    } finally {
      setDeletingId(null);
    }
  }

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
            className="flex flex-col gap-1 py-3"
            data-testid={`session-row-${s.id}`}
          >
            <div className="flex items-center justify-between gap-4">
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
                {/* Delete button — shows inline confirmation before proceeding */}
                {confirmingDeleteId === s.id ? (
                  <span className="flex items-center gap-1">
                    <span className="text-[10px] text-race-ink">Delete?</span>
                    <button
                      type="button"
                      className="race-action text-xs px-2 py-1"
                      disabled={deletingId === s.id}
                      onClick={() => handleDelete(s.id)}
                      aria-label={`Confirm delete session ${s.name ?? s.code}`}
                      data-testid={`confirm-delete-${s.id}`}
                    >
                      {deletingId === s.id ? "…" : "Yes"}
                    </button>
                    <button
                      type="button"
                      className="race-action race-action--outline text-xs px-2 py-1"
                      onClick={() => setConfirmingDeleteId(null)}
                      aria-label="Cancel delete"
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded border border-race-line p-1 text-race-muted transition-colors hover:border-race-red hover:text-race-red focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0B6FB3]"
                    disabled={deletingId === s.id}
                    onClick={() => {
                      setDeleteError((prev) => {
                        const next = { ...prev };
                        delete next[s.id];
                        return next;
                      });
                      setConfirmingDeleteId(s.id);
                    }}
                    aria-label={`Delete session ${s.name ?? s.code}`}
                    data-testid={`delete-btn-${s.id}`}
                  >
                    {deletingId === s.id ? (
                      <span className="size-4 animate-spin rounded-full border-2 border-race-muted border-t-transparent" aria-hidden="true" />
                    ) : (
                      <TrashIcon className="size-4" aria-hidden="true" />
                    )}
                    <span className="sr-only">Delete session</span>
                  </button>
                )}
              </div>
            </div>
            {/* Inline error */}
            {deleteError[s.id] && (
              <p
                role="alert"
                className="text-[10px] text-race-red"
                data-testid={`delete-error-${s.id}`}
              >
                {deleteError[s.id]}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Persistence (solo state survives page refresh)
// ---------------------------------------------------------------------------
//
// The persistence helpers below delegate to the multi-session storage layer
// (soloSessionStorage.ts) which manages up to SESSION_CAP local sessions.
// readPersisted / writePersisted / clearPersisted are thin wrappers kept so
// the rest of this file does not need to know the session id.
//
// The one-time migration from the legacy single-blob keys
// (splitsync_stopwatch_solo_v1 / splitsync_stopwatch_mode_v1) runs in the
// first useEffect below (runMigrationIfNeeded) before any read occurs.

function readPersisted() {
  return readActiveStopwatchState();
}

function writePersisted(data: {
  state: "running" | "stopped";
  accMs: number;
  startedAtWall: number | null;
  laps: Lap[];
}) {
  writeActiveStopwatchState(data);
}

function clearPersisted() {
  clearActiveStopwatchState();
}

// ---------------------------------------------------------------------------
// Countdown beep helper (#292) — square-wave oscillator, same pattern as
// the time-trial scorer. Called independently of the soundEnabled preference
// because countdown audio is integral to the countdown UX, not the generic
// start/stop/lap cue system.
// ---------------------------------------------------------------------------

/** Play a short Web Audio beep (square wave, 2ms attack). freq: Hz, dur: ms */
function beep(audioCtx: AudioContext, freq: number, dur: number, gainPeak = 0.2) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = freq;
  // 2ms linear attack to avoid click/pop of square wave at full amplitude
  gain.gain.setValueAtTime(0, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(gainPeak, audioCtx.currentTime + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur / 1000);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + dur / 1000);
}

// ---------------------------------------------------------------------------
// Sound cues (#227) — WebAudio oscillator beeps, no audio assets.
// Optional and OFF by default; settings persist in localStorage.
// ---------------------------------------------------------------------------

interface CueSettings {
  /** Beeps on start / stop / lap. */
  soundEnabled: boolean;
  /** Single distinct beep when elapsed time crosses the target. */
  targetEnabled: boolean;
  /** Target time in ms (mm:ss granularity in the UI). */
  targetMs: number;
}

const DEFAULT_CUE_SETTINGS: CueSettings = {
  soundEnabled: false,
  targetEnabled: false,
  targetMs: 60_000,
};

const CUE_STORAGE_KEY = "splitsync.stopwatch.cues.v1";

function loadCueSettings(): CueSettings {
  try {
    const raw = window.localStorage.getItem(CUE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CUE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<CueSettings>;
    return {
      soundEnabled: parsed.soundEnabled === true,
      targetEnabled: parsed.targetEnabled === true,
      targetMs:
        typeof parsed.targetMs === "number" && parsed.targetMs > 0
          ? parsed.targetMs
          : DEFAULT_CUE_SETTINGS.targetMs,
    };
  } catch {
    return { ...DEFAULT_CUE_SETTINGS };
  }
}

function saveCueSettings(settings: CueSettings) {
  try {
    window.localStorage.setItem(CUE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Non-fatal: settings simply won't persist.
  }
}

type CueType = "start" | "stop" | "lap" | "target";

interface ToneSegment {
  freq: number; // Hz; 0 = silence
  durationMs: number;
}

const CUE_SEGMENTS: Record<CueType, ToneSegment[]> = {
  start: [{ freq: 880, durationMs: 130 }],
  stop: [
    { freq: 440, durationMs: 110 },
    { freq: 0, durationMs: 40 },
    { freq: 440, durationMs: 110 },
  ],
  lap: [{ freq: 660, durationMs: 90 }],
  // Distinct rising two-tone so the target marker can't be confused with a lap.
  target: [
    { freq: 988, durationMs: 140 },
    { freq: 0, durationMs: 30 },
    { freq: 1319, durationMs: 220 },
  ],
};

/** Parse "M:SS" / "MM:SS" → ms, or null when invalid. */
function parseTargetInput(value: string): number | null {
  const m = value.trim().match(/^(\d{1,3}):([0-5]?\d)$/);
  if (!m) return null;
  const ms = parseInt(m[1], 10) * 60_000 + parseInt(m[2], 10) * 1_000;
  return ms > 0 ? ms : null;
}

/** Format ms → "MM:SS" for the target input. */
function formatTargetInput(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(
    totalSeconds % 60
  ).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Stopwatch component
// ---------------------------------------------------------------------------

export default function StopwatchPage() {
  const [state, setState] = useState<StopwatchState>("idle");
  // Countdown timer mode (#232) — solo surface only; shared sessions unaffected
  const [mode, setMode] = useState<SoloMode>("stopwatch");
  const [displayMs, setDisplayMs] = useState(0);
  const [laps, setLaps] = useState<Lap[]>([]);
  const [copied, setCopied] = useState(false);

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

  // Delayed start
  const [delaySeconds, setDelaySeconds] = useState<DelayOption>(0);
  const [countdownSec, setCountdownSec] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownEndRef = useRef<number>(0); // target Date.now() when countdown ends
  // Tracks the last second we played a countdown beep to avoid firing twice
  // for the same displayed value (100ms tick granularity).
  const lastBeepedSecRef = useRef<number>(-1);

  // Lock state (#235) — local to this device, never broadcast
  const [isLocked, setIsLocked] = useState(false);
  const [showLockHint, setShowLockHint] = useState(false);
  // When the user taps Stop while locked we capture the elapsed ms at that
  // instant and ask for confirmation. If they confirm we stop at that time
  // (not at the dismiss time). null means no pending confirmation.
  const [pendingStopMs, setPendingStopMs] = useState<number | null>(null);

  // Timing refs — not React state so they don't trigger re-renders in the RAF
  const startRef = useRef<number>(0);      // performance.now() at last resume
  const accRef = useRef<number>(0);        // ms accumulated before last pause
  const wallStartRef = useRef<number | null>(null); // Date.now() at last resume
  const lapsRef = useRef<Lap[]>([]);       // mirror of laps for persistence
  const rafRef = useRef<number | null>(null);

  // Screen wake lock (#230/#238) — keep display on while running.
  // Feature-detected, race-condition-safe, re-acquires on tab foreground;
  // degrades silently where unsupported (Firefox, older Safari).
  useWakeLock(state === "running");

  // Lock-related refs
  const lockHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlockPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True right after a successful hold-to-unlock, so the click fired on
  // release does not immediately re-lock the controls.
  const justUnlockedRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Multi-session storage: migration + active-session bootstrap
  // ---------------------------------------------------------------------------
  //
  // This MUST be the first useEffect in the component so it runs before any
  // other effect that reads from the session storage (mode restore, state
  // restore, etc.).  runMigrationIfNeeded() is idempotent — it checks for the
  // index key and is a no-op after the first run.

  useEffect(() => {
    runMigrationIfNeeded();
    getOrCreateActiveSession(); // ensure there is always a valid active session
  }, []);

  // ---------------------------------------------------------------------------
  // Persist delay preference
  // ---------------------------------------------------------------------------

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DELAY_STORAGE_KEY);
      if (stored !== null) {
        const v = Number(stored) as DelayOption;
        if (DELAY_OPTIONS.includes(v)) setDelaySeconds(v);
      }
    } catch {
      // localStorage unavailable (SSR, private mode) — ignore
    }
  }, []);

  const handleSelectDelay = useCallback((opt: DelayOption) => {
    setDelaySeconds(opt);
    try {
      localStorage.setItem(DELAY_STORAGE_KEY, String(opt));
    } catch {
      // ignore
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Derived elapsed ms from refs
  // ---------------------------------------------------------------------------

  const getElapsed = useCallback(() => {
    return accRef.current + (performance.now() - startRef.current);
  }, []);

  // ---------------------------------------------------------------------------
  // Sound cues (#227)
  // ---------------------------------------------------------------------------

  const [cues, setCues] = useState<CueSettings>(DEFAULT_CUE_SETTINGS);
  const [targetInput, setTargetInput] = useState(
    formatTargetInput(DEFAULT_CUE_SETTINGS.targetMs)
  );
  const cuesRef = useRef<CueSettings>(cues);
  const targetFiredRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Load persisted settings after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    const loaded = loadCueSettings();
    cuesRef.current = loaded;
    setCues(loaded);
    setTargetInput(formatTargetInput(loaded.targetMs));
  }, []);

  const updateCues = useCallback((patch: Partial<CueSettings>) => {
    setCues((prev) => {
      const next = { ...prev, ...patch };
      cuesRef.current = next;
      saveCueSettings(next);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Mode toggle (#232) — stopwatch vs single countdown timer
  // ---------------------------------------------------------------------------

  // Restore the last-used mode from the active session.
  // This runs after the migration effect (React effects run in definition order),
  // so by the time this executes, readActiveMode() already reflects any migrated
  // legacy data.
  useEffect(() => {
    const stored = readActiveMode();
    setMode(stored);
  }, []);

  const handleSelectMode = useCallback((next: SoloMode) => {
    setMode(next);
    writeActiveMode(next);
    if (next === "stopwatch") {
      // The timer view can toggle the shared soundEnabled flag (#227) —
      // reload so the stopwatch Sound section reflects it.
      const loaded = loadCueSettings();
      cuesRef.current = loaded;
      setCues(loaded);
      setTargetInput(formatTargetInput(loaded.targetMs));
    }
  }, []);

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

  const playCue = useCallback(
    (type: CueType) => {
      const ctx = ensureAudioCtx();
      if (!ctx) return;
      let at = ctx.currentTime;
      for (const seg of CUE_SEGMENTS[type]) {
        const duration = seg.durationMs / 1000;
        if (seg.freq > 0) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = seg.freq;
          // Short attack/release envelope to avoid clicks
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(0.4, at + 0.005);
          gain.gain.setValueAtTime(0.4, at + duration - 0.01);
          gain.gain.linearRampToValueAtTime(0, at + duration);
          osc.connect(gain).connect(ctx.destination);
          osc.start(at);
          osc.stop(at + duration);
        }
        at += duration;
      }
    },
    [ensureAudioCtx]
  );

  // Fire the target cue once when elapsed time crosses the target
  const checkTarget = useCallback(
    (elapsed: number) => {
      const cfg = cuesRef.current;
      if (!cfg.targetEnabled || targetFiredRef.current) return;
      if (elapsed >= cfg.targetMs) {
        targetFiredRef.current = true;
        playCue("target");
      }
    },
    [playCue]
  );

  // ---------------------------------------------------------------------------
  // RAF loop
  // ---------------------------------------------------------------------------

  const startLoop = useCallback(() => {
    const tick = () => {
      const elapsed = getElapsed();
      setDisplayMs(elapsed);
      checkTarget(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [getElapsed, checkTarget]);

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
  // Persistence — restore on load, save on every state transition / lap
  // ---------------------------------------------------------------------------

  // "countdown" is never persisted — it is a transient pre-start state.
  const persist = useCallback((next: "idle" | "running" | "stopped") => {
    if (next === "idle") {
      clearPersisted();
      return;
    }
    writePersisted({
      state: next,
      accMs: accRef.current,
      startedAtWall: next === "running" ? wallStartRef.current : null,
      laps: lapsRef.current,
    });
  }, []);

  // Restore persisted solo state on mount (client-only, after hydration).
  useEffect(() => {
    const saved = readPersisted();
    if (!saved) return;

    accRef.current = saved.accMs;
    lapsRef.current = saved.laps;
    setLaps(saved.laps);

    if (saved.state === "running" && saved.startedAtWall !== null) {
      // Recompute elapsed from the wall-clock anchor (drift-free across
      // refresh), then re-anchor on performance.now() for the live loop.
      accRef.current = saved.accMs + Math.max(0, Date.now() - saved.startedAtWall);
      wallStartRef.current = Date.now();
      startRef.current = performance.now();
      setState("running");
      setDisplayMs(accRef.current);
      startLoop();
      // Re-anchor the persisted record so a second refresh stays accurate.
      writePersisted({
        state: "running",
        accMs: accRef.current,
        startedAtWall: wallStartRef.current,
        laps: saved.laps,
      });
    } else {
      setState("stopped");
      setDisplayMs(saved.accMs);
    }
    // Restoring is not a user action: never beep on mount. If the restored
    // elapsed time already crossed the target, mark it fired so the RAF loop
    // doesn't play the target cue retroactively.
    if (accRef.current >= cuesRef.current.targetMs) {
      targetFiredRef.current = true;
    }
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Countdown helpers
  // ---------------------------------------------------------------------------

  const clearCountdown = useCallback(() => {
    if (countdownRef.current !== null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  // Called when countdown ticks reach zero — start the actual stopwatch
  // (useWakeLock acquires the wake lock when state becomes "running")
  const commitStart = useCallback(() => {
    // Do NOT reset accRef here: "stopped" is a pause, so Start resumes with
    // accumulated time intact. Only handleReset zeroes it.
    if (cuesRef.current.soundEnabled) playCue("start");
    startRef.current = performance.now();
    wallStartRef.current = Date.now();
    setState("running");
    startLoop();
    persist("running");
  }, [startLoop, persist, playCue]);

  const beginCountdown = useCallback((seconds: number) => {
    const endsAt = Date.now() + seconds * 1000;
    countdownEndRef.current = endsAt;
    setCountdownSec(seconds);
    setState("countdown");

    // Play the first beep immediately for the initial countdown display (#292).
    // ensureAudioCtx is safe to call here because beginCountdown is always
    // triggered by a user gesture (the Start button click).
    const ctxInit = ensureAudioCtx();
    if (ctxInit) {
      beep(ctxInit, 660, 80, 0.18);
      lastBeepedSecRef.current = seconds;
    }

    countdownRef.current = setInterval(() => {
      const remaining = Math.ceil((countdownEndRef.current - Date.now()) / 1000);
      if (remaining <= 0) {
        clearCountdown();
        setCountdownSec(0);
        // Final GO beep — longer and louder to distinguish it from the tick beeps
        const ctxFinal = ensureAudioCtx();
        if (ctxFinal) beep(ctxFinal, 880, 200, 0.25);
        commitStart();
      } else {
        // Only beep once per displayed second (interval runs at 100ms)
        if (remaining !== lastBeepedSecRef.current) {
          lastBeepedSecRef.current = remaining;
          const ctxTick = ensureAudioCtx();
          if (ctxTick) beep(ctxTick, 660, 80, 0.18);
        }
        setCountdownSec(remaining);
      }
    }, 100); // 100ms granularity so we catch the transition exactly
  }, [clearCountdown, commitStart, ensureAudioCtx]);

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
        wallStartRef.current = Date.now();
        stopLoop();
      } else {
        // Tab foregrounded: reset start anchors, restart RAF
        // (useWakeLock re-acquires the wake lock on its own)
        startRef.current = performance.now();
        wallStartRef.current = Date.now();
        startLoop();
      }
      // Keep the persisted wall-clock anchor in sync with the new anchors.
      persist("running");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [state, getElapsed, startLoop, stopLoop, persist]);

  // Cleanup RAF and countdown on unmount (useWakeLock releases the wake lock itself)
  useEffect(
    () => () => {
      stopLoop();
      clearCountdown();
    },
    [stopLoop, clearCountdown]
  );

  // ---------------------------------------------------------------------------
  // Lock helpers
  // ---------------------------------------------------------------------------

  const triggerLockHint = useCallback(() => {
    setShowLockHint(true);
    if (lockHintTimerRef.current) clearTimeout(lockHintTimerRef.current);
    lockHintTimerRef.current = setTimeout(() => setShowLockHint(false), 2000);
  }, []);

  const handleLockBtnPointerDown = useCallback(() => {
    // A new press always starts fresh
    justUnlockedRef.current = false;
    if (!isLocked) return;
    // Start a 1.5 s countdown — releasing early cancels it
    unlockPressRef.current = setTimeout(() => {
      justUnlockedRef.current = true;
      setIsLocked(false);
      setShowLockHint(false);
    }, 1500);
  }, [isLocked]);

  const handleLockBtnPointerCancel = useCallback(() => {
    if (unlockPressRef.current) {
      clearTimeout(unlockPressRef.current);
      unlockPressRef.current = null;
    }
  }, []);

  // Confirm the pending locked-stop using the time captured at click.
  const handleConfirmLockedStop = useCallback(() => {
    const ms = pendingStopMs;
    setPendingStopMs(null);
    if (ms === null || state !== "running") return;
    if (cuesRef.current.soundEnabled) playCue("stop");
    accRef.current = ms;
    wallStartRef.current = null;
    stopLoop();
    setState("stopped");
    setDisplayMs(ms);
    persist("stopped");
  }, [pendingStopMs, state, cuesRef, playCue, stopLoop, persist]);

  const handleCancelLockedStop = useCallback(() => {
    setPendingStopMs(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  const handleStartStop = useCallback(() => {
    if (state === "idle" || state === "stopped") {
      // Start / Resume — always allowed even when locked.
      // This is a user gesture, so unlock the AudioContext here
      // even when only the target beep is enabled.
      if (cuesRef.current.targetEnabled) ensureAudioCtx();
      if (delaySeconds > 0) {
        // Enter countdown
        beginCountdown(delaySeconds);
      } else {
        // Instant start / resume (accRef preserved so stopped time resumes)
        commitStart();
      }
    } else if (state === "running") {
      // Stop / Pause — when locked, capture the time and ask for confirmation
      // so the user doesn't lose the split they intended to record.
      if (isLocked) {
        setPendingStopMs(getElapsed());
        return;
      }
      if (cuesRef.current.soundEnabled) playCue("stop");
      accRef.current = getElapsed();
      wallStartRef.current = null;
      stopLoop();
      setState("stopped");
      setDisplayMs(accRef.current);
      persist("stopped");
    }
    // During countdown: do nothing (cancel button handles it separately)
  }, [state, delaySeconds, beginCountdown, commitStart, isLocked, getElapsed, stopLoop, persist, playCue, ensureAudioCtx]);

  const handleCancelCountdown = useCallback(() => {
    clearCountdown();
    setCountdownSec(0);
    // Return to the pre-countdown state: a delayed *resume* (accumulated time
    // present) goes back to "stopped" so Reset stays reachable; a delayed
    // fresh start goes back to "idle".
    setState(accRef.current > 0 ? "stopped" : "idle");
  }, [clearCountdown]);

  const handleLap = useCallback(() => {
    if (state !== "running") return;
    if (cuesRef.current.soundEnabled) playCue("lap");
    const totalMs = getElapsed();
    setLaps((prev) => {
      const prevTotal = prev.length > 0 ? prev[prev.length - 1].totalMs : 0;
      const next = [
        ...prev,
        {
          n: prev.length + 1,
          lapMs: totalMs - prevTotal,
          totalMs,
        },
      ];
      lapsRef.current = next;
      persist("running");
      return next;
    });
  }, [state, getElapsed, persist, playCue]);

  const handleReset = useCallback(() => {
    if (isLocked) {
      triggerLockHint();
      return;
    }
    clearCountdown();
    setCountdownSec(0);
    stopLoop();
    accRef.current = 0;
    startRef.current = 0;
    wallStartRef.current = null;
    lapsRef.current = [];
    targetFiredRef.current = false;
    setState("idle");
    setDisplayMs(0);
    setLaps([]);
    clearPersisted();
  }, [isLocked, triggerLockHint, stopLoop, clearCountdown]);

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

  // Changing the target re-arms the cue (unless the new target already passed)
  const handleTargetSettingsChange = useCallback(
    (patch: Partial<CueSettings>) => {
      updateCues(patch);
      const next = { ...cuesRef.current, ...patch };
      const elapsedNow =
        state === "running" ? getElapsed() : accRef.current;
      targetFiredRef.current = elapsedNow >= next.targetMs;
    },
    [updateCues, state, getElapsed]
  );

  // ---------------------------------------------------------------------------
  // Export (copy / CSV) — #226
  // ---------------------------------------------------------------------------

  const exportLaps = useCallback(
    () => laps.map((l) => ({ lap: l.n, splitMs: l.lapMs, cumulativeMs: l.totalMs })),
    [laps]
  );

  const handleCopyLaps = useCallback(async () => {
    if (laps.length === 0) return;
    const totalMs = laps[laps.length - 1].totalMs;
    await navigator.clipboard.writeText(
      lapsToText("Solo stopwatch", totalMs, exportLaps())
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [laps, exportLaps]);

  const handleDownloadCsv = useCallback(() => {
    if (laps.length === 0) return;
    downloadCsv("stopwatch-laps.csv", lapsToCsv(exportLaps()));
  }, [laps, exportLaps]);

  // Secondary pusher: lap when running, reset when stopped/idle
  const handleSecondary = useCallback(() => {
    if (state === "running") {
      handleLap(); // Lap is always allowed, even when locked
    } else if (state === "countdown") {
      handleCancelCountdown();
    } else {
      handleReset();
    }
  }, [state, handleLap, handleReset, handleCancelCountdown]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Stopwatch shortcuts only apply in stopwatch mode (#232)
      if (mode !== "stopwatch") return;
      // Ignore when focus is in an input/button (avoid accidental triggers)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.code === "Space") {
        e.preventDefault();
        if (state === "countdown") {
          handleCancelCountdown();
        } else {
          handleStartStop();
        }
      } else if (e.code === "KeyL") {
        e.preventDefault();
        handleSecondary();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, state, handleStartStop, handleSecondary, handleCancelCountdown]);

  // Cleanup RAF and lock timers on unmount (useWakeLock releases the wake
  // lock itself)
  useEffect(
    () => () => {
      stopLoop();
      if (lockHintTimerRef.current) clearTimeout(lockHintTimerRef.current);
      if (unlockPressRef.current) clearTimeout(unlockPressRef.current);
    },
    [stopLoop]
  );

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

  // Stats strip — only shown when >= 2 laps (invariant: never persisted, always derived)
  const showStats = laps.length >= 2;
  const worstLapMs = showStats ? Math.max(...laps.map((l) => l.lapMs)) : null;
  const avgLapMs = showStats
    ? laps.reduce((sum, l) => sum + l.lapMs, 0) / laps.length
    : null;
  const maxLapMs = worstLapMs; // alias for chart scaling (worst = longest)

  const isCountdown = state === "countdown";
  const isRunning   = state === "running";
  const isIdle      = state === "idle";

  const secondaryLabel =
    isCountdown ? "Cancel"
    : isRunning ? "Lap"
    : "Reset";

  const primaryLabel =
    isCountdown ? countdownSec.toString()
    : isRunning ? "Stop"
    : "Start";

  const togetherLabel = authLoading
    ? "Time together"
    : user
    ? "Time together"
    : "Sign in to share";

  // Whether Stop/Reset should appear visually locked (#235)
  const stopLocked = isLocked && state === "running";
  // Countdown cancel is not Stop/Reset — never dimmed by the lock
  const resetLocked = isLocked && !isRunning && !isCountdown;

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
            <div className="mx-auto max-w-lg">
              <p className="race-kicker">Solo timer</p>
              <h1 className="race-title">Stopwatch</h1>
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

          {/* ── Mode toggle (#232) — stopwatch vs single countdown timer ──── */}
          {!largeMode && (
            <div
              className="sw-delay-selector mb-8"
              role="group"
              aria-label="Timing mode"
              data-testid="sw-mode-toggle"
            >
              <span className="sw-delay-label">MODE</span>
              <button
                type="button"
                className={`sw-delay-option${mode === "stopwatch" ? " sw-delay-option--active" : ""}`}
                onClick={() => handleSelectMode("stopwatch")}
                aria-pressed={mode === "stopwatch"}
                aria-label="Stopwatch mode"
                data-testid="sw-mode-stopwatch"
              >
                STOPWATCH
              </button>
              <button
                type="button"
                className={`sw-delay-option${mode === "timer" ? " sw-delay-option--active" : ""}`}
                onClick={() => handleSelectMode("timer")}
                aria-pressed={mode === "timer"}
                aria-label="Countdown timer mode"
                data-testid="sw-mode-timer"
              >
                TIMER
              </button>
            </div>
          )}

          {mode === "timer" ? (
            <CountdownTimer />
          ) : (
          <>
          {/* ── Dial ───────────────────────────────────────────────────────── */}
          <div
            className={`sw-dial${largeMode ? " sw-dial--large" : ""}${isCountdown ? " sw-dial--countdown" : ""}`}
            role="timer"
            aria-label={
              isCountdown
                ? `Countdown: ${countdownSec}`
                : `Elapsed time: ${main}${sub}`
            }
            aria-live="off"
          >
            {isCountdown ? (
              /* Countdown overlay: large pulsing number */
              <div className="sw-digits sw-countdown-digits" aria-hidden="true">
                {/* key forces remount each second, retriggering the pulse animation */}
                <span
                  key={countdownSec}
                  className="sw-countdown-number"
                  data-testid="sw-countdown-number"
                >
                  {countdownSec}
                </span>
                <span className="sw-countdown-label">GET READY</span>
              </div>
            ) : (
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
            )}
          </div>

          {/* ── Target marker (#227) — stays visible in large-display mode ── */}
          {cues.targetEnabled &&
            (displayMs >= cues.targetMs ? (
              <p
                className="mt-4 text-center text-sm font-black uppercase tracking-wider text-race-red"
                role="status"
                data-testid="target-overrun"
              >
                Target {formatTargetInput(cues.targetMs)} · +
                {formatLapTime(displayMs - cues.targetMs)}
              </p>
            ) : (
              <p
                className="mt-4 text-center text-xs font-semibold text-race-muted"
                data-testid="target-pending"
              >
                Target {formatTargetInput(cues.targetMs)}
              </p>
            ))}

          {/* ── Delay selector ─────────────────────────────────────────────── */}
          {(isIdle || state === "stopped") && (
            <div
              className="sw-delay-selector"
              role="group"
              aria-label="Delayed start"
              data-testid="sw-delay-selector"
            >
              <span className="sw-delay-label">DELAY</span>
              {DELAY_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`sw-delay-option${delaySeconds === opt ? " sw-delay-option--active" : ""}`}
                  onClick={() => handleSelectDelay(opt)}
                  aria-pressed={delaySeconds === opt}
                  aria-label={`Delayed start ${DELAY_LABELS[opt]}`}
                  data-testid={`sw-delay-${opt}`}
                >
                  {DELAY_LABELS[opt]}
                </button>
              ))}
            </div>
          )}

          {/* ── Pushers ────────────────────────────────────────────────────── */}
          <div
            className="mt-10 flex items-center justify-center"
            style={{ gap: "var(--sw-pusher-gap)" }}
          >
            {/* Secondary: lap / cancel / reset */}
            <button
              type="button"
              className={`sw-pusher ${
                isIdle
                  ? "sw-pusher--secondary-idle"
                  : "sw-pusher--secondary"
              }${resetLocked ? " sw-pusher--dimmed" : ""}`}
              onClick={handleSecondary}
              aria-label={
                isCountdown
                  ? "Cancel countdown"
                  : isRunning
                  ? "Record lap (keyboard: L)"
                  : "Reset stopwatch (keyboard: L)"
              }
              disabled={isIdle}
              data-testid="sw-secondary-btn"
            >
              {secondaryLabel}
            </button>

            {/* Primary: start / stop; during countdown shows the number */}
            <button
              type="button"
              className={`sw-pusher ${
                isCountdown ? "sw-pusher--countdown" : "sw-pusher--primary"
              }${stopLocked ? " sw-pusher--dimmed" : ""}`}
              onClick={isCountdown ? handleCancelCountdown : handleStartStop}
              aria-label={
                isCountdown
                  ? `Countdown: ${countdownSec} — tap to cancel`
                  : isRunning
                  ? "Stop stopwatch (keyboard: Space)"
                  : "Start stopwatch (keyboard: Space)"
              }
              data-testid="sw-primary-btn"
            >
              {isCountdown ? (
                <span
                  key={countdownSec}
                  className="sw-pusher-countdown-num"
                  aria-hidden="true"
                >
                  {countdownSec}
                </span>
              ) : (
                primaryLabel
              )}
            </button>
          </div>

          {/* ── Lock toggle + keyboard hint (#235) ─────────────────────────── */}
          <div className="mt-4 flex items-center justify-center gap-3">
            {/* Keyboard hint — hidden in large-display mode */}
            {!largeMode && (
              <p className="text-center text-xs font-semibold text-race-muted">
                {isCountdown ? (
                  <>tap or <span className="sw-kbd">Space</span> to cancel</>
                ) : (
                  <>
                    <span className="sw-kbd">Space</span> start/stop
                    {" · "}
                    <span className="sw-kbd">L</span> lap
                  </>
                )}
              </p>
            )}

            {/* Lock button — red pill when locked, muted outline when unlocked */}
            <button
              type="button"
              className={`sw-lock-btn${isLocked ? " sw-lock-btn--locked" : ""}`}
              aria-label={
                isLocked
                  ? "Controls locked — hold to unlock"
                  : "Lock controls"
              }
              aria-pressed={isLocked}
              title={isLocked ? "Hold 1.5 s to unlock" : "Lock Stop & Reset"}
              onClick={() => {
                // A hold-to-unlock ends with a click on release; ignore it so
                // it doesn't instantly re-lock the controls.
                if (justUnlockedRef.current) {
                  justUnlockedRef.current = false;
                  return;
                }
                if (!isLocked) setIsLocked(true);
              }}
              onPointerDown={handleLockBtnPointerDown}
              onPointerUp={handleLockBtnPointerCancel}
              onPointerLeave={handleLockBtnPointerCancel}
              onPointerCancel={handleLockBtnPointerCancel}
            >
              {isLocked ? "🔒 LOCKED" : "🔓 LOCK"}
            </button>
          </div>

          {/* Lock hint — shown briefly when a locked button is tapped */}
          {showLockHint && (
            <p
              className="mt-1 text-center sw-lock-hint"
              role="alert"
              aria-live="assertive"
            >
              Controls locked — hold LOCKED to unlock
            </p>
          )}

          {/* Stop-while-locked confirmation (#340) — shown when user taps Stop
              while locked; uses the time captured at the tap, not the dismiss time */}
          {pendingStopMs !== null && (
            <div className="sw-stop-confirm" role="alertdialog" aria-label="Confirm stop">
              <span className="sw-stop-confirm__label">
                Stop at {formatLapTime(pendingStopMs)}?
              </span>
              <button
                type="button"
                className="sw-stop-confirm__btn sw-stop-confirm__btn--confirm"
                onClick={handleConfirmLockedStop}
                autoFocus
              >
                Stop
              </button>
              <button
                type="button"
                className="sw-stop-confirm__btn sw-stop-confirm__btn--cancel"
                onClick={handleCancelLockedStop}
              >
                Keep running
              </button>
            </div>
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

          {/* ── Sound settings (#227) — hidden in large-display mode ───────── */}
          {!largeMode && (
            <section
              className="mt-8 w-full border-t-2 border-race-ink pt-4"
              aria-label="Sound settings"
            >
              <p className="race-kicker mb-3">Sound</p>
              <div className="flex flex-col gap-3 text-sm font-semibold">
                <label className="flex items-center justify-between gap-3">
                  <span>Beep on start / stop / lap</span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--race-red)]"
                    checked={cues.soundEnabled}
                    onChange={(e) => updateCues({ soundEnabled: e.target.checked })}
                    data-testid="sound-cues-toggle"
                  />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span>
                    Target-time beep
                    <span className="ml-1 text-xs font-semibold text-race-muted">
                      (stopwatch keeps running)
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--race-red)]"
                    checked={cues.targetEnabled}
                    onChange={(e) =>
                      handleTargetSettingsChange({ targetEnabled: e.target.checked })
                    }
                    data-testid="target-toggle"
                  />
                </label>
                {cues.targetEnabled && (
                  <label className="flex items-center justify-between gap-3">
                    <span>Target (MM:SS)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={targetInput}
                      onChange={(e) => {
                        setTargetInput(e.target.value);
                        const ms = parseTargetInput(e.target.value);
                        if (ms !== null) {
                          handleTargetSettingsChange({ targetMs: ms });
                        }
                      }}
                      onBlur={() => setTargetInput(formatTargetInput(cues.targetMs))}
                      className="w-20 border-2 border-race-ink bg-white px-2 py-1 text-center font-black tabular-nums"
                      aria-label="Target time in minutes and seconds"
                      placeholder="01:00"
                      data-testid="target-time-input"
                    />
                  </label>
                )}
              </div>
            </section>
          )}

          {/* ── Lap list ───────────────────────────────────────────────────── */}
          {laps.length > 0 && (
            <section
              className="mt-8 w-full border-t-2 border-race-ink pt-4"
              aria-label="Lap times"
            >
              <p className="race-kicker mb-3">Laps</p>

              {/* Stats strip — visible only when >= 2 laps */}
              {showStats && (
                <div className="sw-stats-strip" aria-label="Lap statistics">
                  <div className="sw-stat-cell sw-stat-cell--best" aria-label={`Best lap: ${formatLapTime(bestLapMs!)}`}>
                    <span className="sw-stat-label">Best</span>
                    <span className="sw-stat-value">{formatLapTime(bestLapMs!)}</span>
                  </div>
                  <div className="sw-stat-cell sw-stat-cell--worst" aria-label={`Worst lap: ${formatLapTime(worstLapMs!)}`}>
                    <span className="sw-stat-label">Worst</span>
                    <span className="sw-stat-value">{formatLapTime(worstLapMs!)}</span>
                  </div>
                  <div className="sw-stat-cell" aria-label={`Average lap: ${formatLapTime(Math.round(avgLapMs!))}`}>
                    <span className="sw-stat-label">Avg</span>
                    <span className="sw-stat-value">{formatLapTime(Math.round(avgLapMs!))}</span>
                  </div>
                </div>
              )}

              {/* Lap trend chart — bar per lap, best=yellow, worst=race-red */}
              {showStats && (
                <div className="sw-trend-chart" aria-label="Lap trend chart">
                  {laps.map((lap) => {
                    const isBest = lap.lapMs === bestLapMs;
                    const isWorst = lap.lapMs === worstLapMs;
                    const pct = maxLapMs ? Math.round((lap.lapMs / maxLapMs) * 100) : 100;
                    const fillClass = isBest
                      ? "sw-trend-fill sw-trend-fill--best"
                      : isWorst
                      ? "sw-trend-fill sw-trend-fill--worst"
                      : "sw-trend-fill";
                    return (
                      <div key={lap.n} className="sw-trend-row">
                        <span className="sw-trend-lap-num">{lap.n}</span>
                        <div className="sw-trend-track">
                          <div className={fillClass} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="sw-trend-time">{formatLapTime(lap.lapMs)}</span>
                      </div>
                    );
                  })}
                </div>
              )}

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

              {/* Export actions — #226 */}
              <div className="mt-4 flex justify-center gap-3 no-print">
                <button
                  type="button"
                  className="race-action race-action--outline text-sm"
                  onClick={handleCopyLaps}
                >
                  {copied ? "Copied ✓" : "Copy laps"}
                </button>
                <button
                  type="button"
                  className="race-action race-action--outline text-sm"
                  onClick={handleDownloadCsv}
                >
                  Download CSV
                </button>
              </div>
            </section>
          )}
          </>
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

          {/* ── SplitSync wordmark — relocated from masthead (#290) ──────────── */}
          {!largeMode && (
            <div className="mt-6 text-center no-print" data-testid="sw-brand-footer">
              <Link
                href="/"
                className="sw-brand-footer"
                aria-label="SplitSync home"
              >
                SplitSync
              </Link>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
