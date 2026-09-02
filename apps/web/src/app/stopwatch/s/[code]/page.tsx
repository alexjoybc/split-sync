"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  formatTime as formatTimeBase,
  formatLapTime as formatLapTimeBase,
} from "@/lib/stopwatchFormat";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionStatus = "waiting" | "running" | "stopped";

interface Participant {
  id: string;
  display_name: string;
  is_owner: boolean;
}

interface SessionEvent {
  id: string;
  event_type: "start" | "lap" | "stop" | "reset";
  client_recorded_at: string;
  actor_participant_id: string;
  sequence: number;
  t0_server?: string | null;
}

interface SessionState {
  session_id: string;
  session_name: string | null;
  status: SessionStatus;
  t0_server: string | null;
  participants: Participant[];
  events: SessionEvent[];
}

interface SharedLap {
  n: number;
  lapMs: number;
  totalMs: number;
  actorName: string;
  recordedAt: string;
}

interface StoredParticipant {
  session_id: string;
  participant_id: string;
  client_id: string;
  display_name: string;
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

function storageKey(code: string): string {
  return `splitsync_stopwatch_${code}`;
}

function loadStoredParticipant(code: string): StoredParticipant | null {
  try {
    const raw = localStorage.getItem(storageKey(code));
    if (!raw) return null;
    return JSON.parse(raw) as StoredParticipant;
  } catch {
    return null;
  }
}

function saveStoredParticipant(code: string, data: StoredParticipant): void {
  try {
    localStorage.setItem(storageKey(code), JSON.stringify(data));
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

// Shared formatters (#246) — clamp negative ms, which can occur briefly while
// the synced server clock settles.
function formatTime(ms: number): { main: string; sub: string } {
  return formatTimeBase(Math.max(0, ms));
}

function formatLapTime(ms: number): string {
  return formatLapTimeBase(Math.max(0, ms));
}

/** Derive laps from event log */
function deriveLaps(
  events: SessionEvent[],
  participants: Participant[]
): SharedLap[] {
  const participantMap = new Map(participants.map((p) => [p.id, p.display_name]));
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);

  // Find the last reset or start index to scope lap derivation
  let startIdx = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].event_type === "reset") {
      startIdx = i + 1;
      break;
    }
  }

  const relevant = sorted.slice(startIdx);
  const laps: SharedLap[] = [];
  let lastLapAt: string | null = null;
  let lapN = 0;
  let cumulativeMs = 0;

  for (const evt of relevant) {
    if (evt.event_type === "start") {
      lastLapAt = evt.client_recorded_at;
    } else if (evt.event_type === "lap" && lastLapAt) {
      const lapMs =
        new Date(evt.client_recorded_at).getTime() -
        new Date(lastLapAt).getTime();
      cumulativeMs += lapMs;
      lapN++;
      laps.push({
        n: lapN,
        lapMs,
        totalMs: cumulativeMs,
        actorName:
          participantMap.get(evt.actor_participant_id) ?? "Unknown",
        recordedAt: evt.client_recorded_at,
      });
      lastLapAt = evt.client_recorded_at;
    }
  }

  return laps;
}

// ---------------------------------------------------------------------------
// Join form
// ---------------------------------------------------------------------------

interface JoinFormProps {
  code: string;
  sessionName: string | null;
  onJoined: (stored: StoredParticipant) => void;
}

function JoinForm({ code, sessionName, onJoined }: JoinFormProps) {
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    if (!displayName.trim()) return;
    setLoading(true);
    setError(null);
    const clientId = generateUUID();
    try {
      const { data, error: rpcError } = await supabase.rpc("join_casual_session", {
        p_code: code,
        p_display_name: displayName.trim(),
        p_client_id: clientId,
      });
      if (rpcError) throw rpcError;
      const result = data as {
        session_id: string;
        participant_id: string;
        session_name?: string;
      };
      const stored: StoredParticipant = {
        session_id: result.session_id,
        participant_id: result.participant_id,
        client_id: clientId,
        display_name: displayName.trim(),
      };
      saveStoredParticipant(code, stored);
      onJoined(stored);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("expired") || msg.includes("not found")) {
        setError("This session has expired or does not exist.");
      } else if (msg.includes("full") || msg.includes("cap")) {
        setError("This session is full.");
      } else if (msg.includes("stopped")) {
        setError("This session has already ended.");
      } else {
        setError(msg || "Failed to join session.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="race-page flex min-h-dvh flex-col">
      <div className="race-topline" />
      <header className="race-masthead">
        <div className="mx-auto flex max-w-lg items-end justify-between gap-4">
          <div>
            <p className="race-kicker">Shared stopwatch</p>
            <h1 className="race-title">{sessionName ?? "Join session"}</h1>
          </div>
          <Link href="/stopwatch" className="race-action race-action--outline text-sm">
            Solo
          </Link>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center px-4 pt-12 pb-12 sm:px-6">
        <div className="w-full border-2 border-race-ink bg-race-panel p-6">
          <p className="text-sm font-bold text-race-ink mb-4">
            Enter your name to join this timing session.
          </p>
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
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            autoFocus
          />
          {error && (
            <p className="mt-3 text-sm font-bold text-race-red">{error}</p>
          )}
          <button
            type="button"
            className="race-action mt-4 w-full disabled:opacity-50"
            disabled={!displayName.trim() || loading}
            onClick={handleJoin}
          >
            {loading ? "Joining…" : "Join session"}
          </button>
          <Link
            href={`/stopwatch/s/${code}/live`}
            className="race-action race-action--outline mt-3 block w-full text-center"
          >
            Join as viewer
          </Link>
        </div>
        <p className="mt-4 text-xs text-race-muted text-center">
          Session code:{" "}
          <span className="font-black tracking-widest text-race-ink">{code}</span>
        </p>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Shared session view
// ---------------------------------------------------------------------------

interface SharedSessionViewProps {
  code: string;
  stored: StoredParticipant;
  initialState: SessionState | null;
}

function SharedSessionView({ code, stored, initialState }: SharedSessionViewProps) {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>(
    initialState?.status ?? "waiting"
  );
  const [sessionName, setSessionName] = useState<string | null>(
    initialState?.session_name ?? null
  );
  const [t0Server, setT0Server] = useState<Date | null>(
    initialState?.t0_server ? new Date(initialState.t0_server) : null
  );
  const [participants, setParticipants] = useState<Participant[]>(
    initialState?.participants ?? []
  );
  const [events, setEvents] = useState<SessionEvent[]>(
    initialState?.events ?? []
  );
  const [displayMs, setDisplayMs] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const rafRef = useRef<number | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSequenceRef = useRef(0);

  // Clock offset estimation (simplified NTP)
  const clockOffsetRef = useRef(0);

  const isOwner = participants.find((p) => p.id === stored.participant_id)?.is_owner ?? false;
  const laps = deriveLaps(events, participants);
  const bestLapMs = laps.length > 0 ? Math.min(...laps.map((l) => l.lapMs)) : null;

  const shareUrl = `https://splitsync.org/stopwatch/s/${code}`;

  // ── RAF display loop ────────────────────────────────────────────────────

  const startDisplayLoop = useCallback(() => {
    const tick = () => {
      if (t0Server) {
        const elapsed = Date.now() + clockOffsetRef.current - t0Server.getTime();
        setDisplayMs(elapsed);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [t0Server]);

  const stopDisplayLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === "running" && t0Server) {
      startDisplayLoop();
    } else {
      stopDisplayLoop();
    }
    return stopDisplayLoop;
  }, [sessionStatus, t0Server, startDisplayLoop, stopDisplayLoop]);

  // ── Apply incoming event ─────────────────────────────────────────────────

  const applyEvent = useCallback((evt: SessionEvent) => {
    setEvents((prev) => {
      if (prev.some((e) => e.id === evt.id)) return prev;
      return [...prev, evt];
    });
    if (evt.sequence > lastSequenceRef.current) {
      lastSequenceRef.current = evt.sequence;
    }
    if (evt.event_type === "start") {
      setSessionStatus("running");
      if (evt.t0_server) setT0Server(new Date(evt.t0_server));
    } else if (evt.event_type === "stop") {
      setSessionStatus("stopped");
      stopDisplayLoop();
    } else if (evt.event_type === "reset") {
      setSessionStatus("waiting");
      setT0Server(null);
      setDisplayMs(0);
      stopDisplayLoop();
    }
  }, [stopDisplayLoop]);

  // ── Realtime channel ─────────────────────────────────────────────────────

  useEffect(() => {
    const channel = supabase.channel(`stopwatch:${code}`);
    channelRef.current = channel;

    channel
      .on("broadcast", { event: "session_event" }, ({ payload }) => {
        const evt = payload as SessionEvent & { t0_server?: string | null };
        applyEvent(evt);
      })
      .on("broadcast", { event: "participant_joined" }, ({ payload }) => {
        const p = payload as Participant;
        setParticipants((prev) => {
          if (prev.some((existing) => existing.id === p.id)) return prev;
          return [...prev, p];
        });
      })
      .on("broadcast", { event: "participant_left" }, ({ payload }) => {
        const { participant_id } = payload as { participant_id: string };
        setParticipants((prev) => prev.filter((p) => p.id !== participant_id));
      })
      .on("broadcast", { event: "sync_response" }, ({ payload }) => {
        const { events: catchUpEvents } = payload as { events: SessionEvent[] };
        for (const evt of catchUpEvents) applyEvent(evt);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Announce join
          channel.send({
            type: "broadcast",
            event: "participant_joined",
            payload: {
              id: stored.participant_id,
              display_name: stored.display_name,
              is_owner: isOwner,
            },
          });

          // Request catch-up if we have missed events
          if (lastSequenceRef.current > 0) {
            channel.send({
              type: "broadcast",
              event: "sync_request",
              payload: { last_sequence: lastSequenceRef.current },
            });
          }
        }
      });

    // Respond to sync requests
    channel.on("broadcast", { event: "sync_request" }, ({ payload }) => {
      const { last_sequence } = payload as { last_sequence: number };
      const missedEvents = events.filter((e) => e.sequence > last_sequence);
      if (missedEvents.length > 0) {
        channel.send({
          type: "broadcast",
          event: "sync_response",
          payload: { events: missedEvents },
        });
      }
    });

    return () => {
      channel.send({
        type: "broadcast",
        event: "participant_left",
        payload: { participant_id: stored.participant_id },
      });
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, stored.participant_id]);

  // ── Refresh state on reconnect ───────────────────────────────────────────

  const refreshState = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("get_session_state", {
        p_session_id: stored.session_id,
        p_participant_id: stored.participant_id,
      });
      if (data) {
        const s = data as SessionState;
        setSessionStatus(s.status);
        setSessionName(s.session_name);
        if (s.t0_server) setT0Server(new Date(s.t0_server));
        setParticipants(s.participants ?? []);
        for (const evt of s.events ?? []) applyEvent(evt);
      }
    } catch {
      // Best effort — ignore failures
    }
  }, [stored.session_id, stored.participant_id, applyEvent]);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  // ── Record a session event ───────────────────────────────────────────────

  const recordEvent = useCallback(
    async (eventType: "start" | "lap" | "stop" | "reset") => {
      setActionError(null);
      const clientId = generateUUID();
      const clientRecordedAt = new Date(
        Date.now() + clockOffsetRef.current
      ).toISOString();
      try {
        const { data, error: rpcError } = await supabase.rpc(
          "record_session_event",
          {
            p_session_id: stored.session_id,
            p_participant_id: stored.participant_id,
            p_event_type: eventType,
            p_client_recorded_at: clientRecordedAt,
            p_client_id: clientId,
          }
        );
        if (rpcError) throw rpcError;
        const accepted = data as SessionEvent & { t0_server?: string | null };
        applyEvent(accepted);
        // Broadcast to peers
        channelRef.current?.send({
          type: "broadcast",
          event: "session_event",
          payload: accepted,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ALREADY_RUNNING")) {
          await refreshState();
        } else if (msg.includes("NOT_RUNNING")) {
          setActionError("Session is not running.");
        } else if (msg.includes("ALREADY_STOPPED")) {
          setActionError("Session already stopped.");
        } else {
          // Unrecognized failure — log full details so a broken RPC (bad
          // params, missing function, etc.) is loud in dev/CI rather than
          // silently swallowed behind a vague message.
          const code =
            typeof err === "object" && err !== null && "code" in err
              ? String((err as { code?: unknown }).code)
              : undefined;
          const details =
            typeof err === "object" && err !== null && "details" in err
              ? (err as { details?: unknown }).details
              : undefined;
          const hint =
            typeof err === "object" && err !== null && "hint" in err
              ? (err as { hint?: unknown }).hint
              : undefined;
          console.error("record_session_event failed", {
            eventType,
            code,
            message: msg,
            details,
            hint,
          });
          setActionError(
            `Action failed${code ? ` (${code})` : ""}. Please try again or refresh the page.`
          );
        }
      }
    },
    [stored, applyEvent, refreshState]
  );

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const { main, sub } = formatTime(
    sessionStatus === "stopped" && t0Server
      ? (() => {
          const stopEvt = [...events]
            .sort((a, b) => b.sequence - a.sequence)
            .find((e) => e.event_type === "stop");
          if (stopEvt && t0Server) {
            return (
              new Date(stopEvt.client_recorded_at).getTime() - t0Server.getTime()
            );
          }
          return displayMs;
        })()
      : displayMs
  );

  const statusBadge =
    sessionStatus === "running" ? (
      <span className="race-kicker text-race-red">● Live</span>
    ) : sessionStatus === "waiting" ? (
      <span className="race-kicker text-race-muted">Waiting</span>
    ) : (
      <span className="race-kicker text-race-ink">Stopped</span>
    );

  return (
    <main className="race-page flex min-h-dvh flex-col">
      <div className="race-topline" />

      <header className="race-masthead no-print">
        <div className="mx-auto flex max-w-lg items-end justify-between gap-4">
          <div>
            {statusBadge}
            <h1 className="race-title">{sessionName ?? `Session ${code}`}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="race-action race-action--outline text-xs px-2 py-1"
              onClick={handleCopy}
              aria-label="Copy share link"
            >
              {copied ? "Copied!" : "Share"}
            </button>
            <Link
              href="/stopwatch"
              className="race-action race-action--outline text-sm"
            >
              Solo
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center px-4 pt-8 pb-12 sm:px-6">

        {/* ── Dial ──────────────────────────────────────────────────────── */}
        <div
          className="sw-dial"
          role="timer"
          aria-label={`Elapsed time: ${main}${sub}`}
          aria-live="off"
        >
          <div className="sw-digits flex flex-col items-center">
            <span
              className="block"
              style={{ fontSize: "clamp(44px, 12vw, 64px)" }}
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

        {/* ── Pushers ───────────────────────────────────────────────────── */}
        {sessionStatus !== "stopped" && (
          <div
            className="mt-10 flex items-center justify-center"
            style={{ gap: "var(--sw-pusher-gap)" }}
          >
            <button
              type="button"
              className={`sw-pusher ${
                sessionStatus === "running"
                  ? "sw-pusher--secondary"
                  : "sw-pusher--secondary-idle"
              }`}
              onClick={() => {
                if (sessionStatus === "running") recordEvent("lap");
                else if (sessionStatus === "waiting" && isOwner) recordEvent("reset");
              }}
              disabled={
                sessionStatus === "waiting" ||
                (sessionStatus !== "running")
              }
              aria-label="Record lap"
            >
              Lap
            </button>
            <button
              type="button"
              className="sw-pusher sw-pusher--primary"
              onClick={() =>
                recordEvent(sessionStatus === "running" ? "stop" : "start")
              }
              aria-label={
                sessionStatus === "running" ? "Stop session" : "Start session"
              }
            >
              {sessionStatus === "running" ? "Stop" : "Start"}
            </button>
          </div>
        )}

        {actionError && (
          <p className="mt-3 text-sm font-bold text-race-red">{actionError}</p>
        )}

        {/* ── Participants ───────────────────────────────────────────────── */}
        <section className="mt-8 w-full" aria-label="Participants">
          <p className="race-kicker mb-2">Participants</p>
          <div className="flex flex-wrap gap-2">
            {participants.map((p) => (
              <span
                key={p.id}
                className={`inline-flex items-center gap-1 border px-2 py-1 text-xs font-bold ${
                  p.id === stored.participant_id
                    ? "border-race-ink bg-race-ink text-white"
                    : "border-race-line text-race-ink"
                }`}
              >
                {p.display_name}
                {p.is_owner && (
                  <span className="text-[9px] font-black uppercase tracking-widest opacity-70">
                    owner
                  </span>
                )}
                {p.id === stored.participant_id && (
                  <span className="text-[9px] font-black uppercase tracking-widest opacity-70">
                    you
                  </span>
                )}
              </span>
            ))}
            {participants.length === 0 && (
              <span className="text-xs text-race-muted">Connecting…</span>
            )}
          </div>
        </section>

        {/* ── Lap table ─────────────────────────────────────────────────── */}
        {laps.length > 0 && (
          <section
            className="mt-8 w-full border-t-2 border-race-ink pt-4"
            aria-label="Shared lap times"
          >
            <p className="race-kicker mb-3">Laps</p>
            <table className="sw-lap-table w-full" aria-label="Shared lap times table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Lap</th>
                  <th scope="col">Total</th>
                  <th scope="col" className="text-left text-[10px]">By</th>
                </tr>
              </thead>
              <tbody>
                {[...laps].reverse().map((lap) => {
                  const isBest = lap.lapMs === bestLapMs;
                  return (
                    <tr
                      key={lap.n}
                      className={isBest ? "sw-lap-row--best" : undefined}
                    >
                      <td>
                        {isBest && (
                          <span className="mr-1 text-[10px] font-black" aria-hidden="true">
                            ★
                          </span>
                        )}
                        {lap.n}
                      </td>
                      <td>{formatLapTime(lap.lapMs)}</td>
                      <td>{formatLapTime(lap.totalMs)}</td>
                      <td className="text-left text-[10px] text-race-muted">
                        {lap.actorName}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {/* ── Post-session CTA ──────────────────────────────────────────── */}
        {sessionStatus === "stopped" && (
          <div className="mt-10 w-full border-t-2 border-race-ink pt-6 text-center">
            <p className="text-sm font-bold text-race-ink mb-1">
              Great session!
            </p>
            <p className="text-xs text-race-muted mb-4">
              Timing a real race with bibs and standings?
            </p>
            <Link href="/new" className="race-action inline-block">
              Create a SplitSync event →
            </Link>
          </div>
        )}

        {/* ── Reset (owner only, stopped) ────────────────────────────────── */}
        {sessionStatus === "stopped" && isOwner && (
          <div className="mt-4 text-center">
            <button
              type="button"
              className="race-action race-action--outline text-xs"
              onClick={() => recordEvent("reset")}
            >
              Reset &amp; start again
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Page entry — resolve params, load initial state
// ---------------------------------------------------------------------------

type PageProps = {
  params: Promise<{ code: string }>;
};

export default function SharedSessionPage({ params }: PageProps) {
  const { code } = use(params);
  const upperCode = code.toUpperCase();

  const [phase, setPhase] = useState<"loading" | "join" | "session" | "error">(
    "loading"
  );
  const [stored, setStored] = useState<StoredParticipant | null>(null);
  const [initialState, setInitialState] = useState<SessionState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sessionNameForJoin, setSessionNameForJoin] = useState<string | null>(null);

  useEffect(() => {
    const existing = loadStoredParticipant(upperCode);
    if (existing) {
      // Verify stored participant is still valid
      supabase
        .rpc("get_session_state", {
          p_session_id: existing.session_id,
          p_participant_id: existing.participant_id,
        })
        .then(({ data, error }) => {
          if (error || !data) {
            // Stored participant invalid — show join form
            setPhase("join");
            return;
          }
          const state = data as SessionState;
          setInitialState(state);
          setStored(existing);
          setPhase("session");
        });
    } else {
      // No stored participant — show join form directly.
      // Session name is surfaced after joining via join_casual_session response.
      setPhase("join");
    }
  }, [upperCode]);

  const handleJoined = (newStored: StoredParticipant) => {
    setStored(newStored);
    setPhase("session");
  };

  if (phase === "loading") {
    return (
      <main className="race-page flex min-h-dvh items-center justify-center">
        <p className="text-sm font-black uppercase tracking-wide text-race-muted">
          Loading…
        </p>
      </main>
    );
  }

  if (phase === "error") {
    return (
      <main className="race-page flex min-h-dvh flex-col items-center justify-center px-4">
        <p className="race-kicker mb-2">Session unavailable</p>
        <p className="text-sm font-bold text-race-ink mb-6">
          {errorMsg ?? "This session has expired, is full, or does not exist."}
        </p>
        <Link href="/stopwatch" className="race-action">
          Back to stopwatch
        </Link>
      </main>
    );
  }

  if (phase === "join") {
    return (
      <JoinForm
        code={upperCode}
        sessionName={sessionNameForJoin}
        onJoined={handleJoined}
      />
    );
  }

  if (!stored) return null;

  return (
    <SharedSessionView
      code={upperCode}
      stored={stored}
      initialState={initialState}
    />
  );
}
