"use client";

/**
 * Shared-session results permalink (#226).
 *
 * Read-only, spectator-style view of a finished casual stopwatch session.
 * Anyone holding the 6-char code can open it — no sign-in, no participant
 * token — via the anon-callable `get_casual_session_results` RPC. Results
 * survive the 4-hour join expiry (see ADR 0022). No session controls here.
 */

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  downloadCsv,
  fmtClock,
  lapsToCsv,
  lapsToText,
  type ExportLap,
} from "@/lib/stopwatchExport";

interface ResultsSession {
  name: string;
  code: string;
  status: string;
  created_at: string;
  t0_server: string | null;
}

interface ResultsParticipant {
  display_name: string;
  is_owner: boolean;
}

interface ResultsEvent {
  event_type: "start" | "lap" | "stop" | "reset";
  client_recorded_at: string;
  actor_name: string;
  sequence: number;
}

interface ResultsPayload {
  session: ResultsSession;
  participants: ResultsParticipant[];
  events: ResultsEvent[];
}

interface DerivedResults {
  laps: ExportLap[];
  totalMs: number | null;
  stoppedAt: string | null;
}

/** Replay the event log into laps + total time. Mirrors the native derivation. */
function deriveResults(events: ResultsEvent[]): DerivedResults {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  let baseAt: Date | null = null;
  let prevAt: Date | null = null;
  let totalMs: number | null = null;
  let stoppedAt: string | null = null;
  let laps: ExportLap[] = [];

  for (const ev of sorted) {
    if (ev.event_type === "reset") {
      baseAt = null;
      prevAt = null;
      totalMs = null;
      stoppedAt = null;
      laps = [];
    } else if (ev.event_type === "start") {
      baseAt = new Date(ev.client_recorded_at);
      prevAt = baseAt;
    } else if (ev.event_type === "lap" && baseAt && prevAt) {
      const at = new Date(ev.client_recorded_at);
      laps.push({
        lap: laps.length + 1,
        splitMs: at.getTime() - prevAt.getTime(),
        cumulativeMs: at.getTime() - baseAt.getTime(),
        actor: ev.actor_name,
      });
      prevAt = at;
    } else if (ev.event_type === "stop" && baseAt) {
      totalMs = new Date(ev.client_recorded_at).getTime() - baseAt.getTime();
      stoppedAt = ev.client_recorded_at;
    }
  }

  // Expired-while-running session: fall back to the last lap's cumulative time.
  if (totalMs === null && laps.length > 0) {
    totalMs = laps[laps.length - 1].cumulativeMs;
  }

  return { laps, totalMs, stoppedAt };
}

export default function SessionResultsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const [payload, setPayload] = useState<ResultsPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading"
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc("get_casual_session_results", { p_code: code })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setState("unavailable");
          return;
        }
        setPayload(data as unknown as ResultsPayload);
        setState("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const derived = useMemo(
    () => (payload ? deriveResults(payload.events) : null),
    [payload]
  );

  const bestMs =
    derived && derived.laps.length > 0
      ? Math.min(...derived.laps.map((l) => l.splitMs))
      : null;

  const handleCopy = useCallback(async () => {
    if (!payload || !derived) return;
    const text = lapsToText(payload.session.name, derived.totalMs, derived.laps);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [payload, derived]);

  const handleCsv = useCallback(() => {
    if (!payload || !derived) return;
    downloadCsv(
      `stopwatch-${payload.session.code}-results.csv`,
      lapsToCsv(derived.laps)
    );
  }, [payload, derived]);

  return (
    <main className="race-page flex min-h-dvh flex-col">
      <div className="race-topline" />

      <header className="race-masthead no-print">
        <div className="mx-auto flex max-w-lg items-end justify-between gap-4">
          <div>
            <p className="race-kicker">Session results</p>
            <h1 className="race-title">
              {state === "ready" && payload ? payload.session.name : "Stopwatch"}
            </h1>
          </div>
          <Link href="/stopwatch" className="race-action race-action--outline text-sm">
            Stopwatch
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-lg flex-1 px-4 pt-8 pb-12 sm:px-6">
        {state === "loading" && (
          <p className="text-center text-sm font-semibold text-race-muted">
            Loading results…
          </p>
        )}

        {state === "unavailable" && (
          <section
            className="border-2 border-race-ink bg-white p-6 text-center"
            aria-label="Results not available"
          >
            <p className="race-kicker mb-2">No results</p>
            <p className="text-sm font-semibold text-zinc-700">
              Results are not available for this code. The session may still be
              in progress, or the code may be wrong.
            </p>
            <Link
              href="/stopwatch"
              className="race-action mt-6 inline-block text-sm"
            >
              Open the stopwatch
            </Link>
          </section>
        )}

        {state === "ready" && payload && derived && (
          <>
            {/* Summary strip */}
            <section
              className="border-2 border-race-ink bg-white"
              aria-label="Session summary"
            >
              <div className="flex items-stretch divide-x-2 divide-race-ink text-center">
                <div className="flex-1 px-2 py-3">
                  <p className="race-kicker--muted text-[10px]">Total</p>
                  <p className="text-xl font-black tabular-nums">
                    {derived.totalMs !== null ? fmtClock(derived.totalMs) : "—"}
                  </p>
                </div>
                <div className="flex-1 px-2 py-3">
                  <p className="race-kicker--muted text-[10px]">Laps</p>
                  <p className="text-xl font-black tabular-nums">
                    {derived.laps.length}
                  </p>
                </div>
                <div className="flex-1 px-2 py-3">
                  <p className="race-kicker--muted text-[10px]">Best lap</p>
                  <p className="text-xl font-black tabular-nums">
                    {bestMs !== null ? fmtClock(bestMs) : "—"}
                  </p>
                </div>
              </div>
              <div className="border-t-2 border-race-ink px-3 py-2 text-center">
                <p className="text-[11px] font-semibold text-race-muted">
                  Code <strong>{payload.session.code}</strong>
                  {derived.stoppedAt && (
                    <>
                      {" · stopped "}
                      {new Date(derived.stoppedAt).toLocaleString()}
                    </>
                  )}
                </p>
              </div>
            </section>

            {/* Export actions */}
            <div className="mt-4 flex justify-center gap-3 no-print">
              <button
                type="button"
                className="race-action race-action--outline text-sm"
                onClick={handleCopy}
                disabled={derived.laps.length === 0}
              >
                {copied ? "Copied ✓" : "Copy laps"}
              </button>
              <button
                type="button"
                className="race-action text-sm"
                onClick={handleCsv}
                disabled={derived.laps.length === 0}
              >
                Download CSV
              </button>
            </div>

            {/* Lap table */}
            {derived.laps.length > 0 ? (
              <section
                className="mt-6 w-full border-t-2 border-race-ink pt-4"
                aria-label="Lap times"
              >
                <p className="race-kicker mb-3">Laps</p>
                <table className="sw-lap-table" aria-label="Lap times table">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Split</th>
                      <th scope="col">Total</th>
                      <th scope="col">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {derived.laps.map((lap) => {
                      const isBest = lap.splitMs === bestMs;
                      return (
                        <tr
                          key={lap.lap}
                          className={isBest ? "sw-lap-row--best" : undefined}
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
                            {lap.lap}
                          </td>
                          <td>{fmtClock(lap.splitMs)}</td>
                          <td>{fmtClock(lap.cumulativeMs)}</td>
                          <td>{lap.actor}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            ) : (
              <p className="mt-8 text-center text-sm font-semibold text-race-muted">
                No laps were recorded in this session.
              </p>
            )}

            {/* Who was there */}
            {payload.participants.length > 0 && (
              <p className="mt-6 text-center text-[11px] font-semibold text-race-muted">
                Timed by{" "}
                {payload.participants
                  .map((p) => `${p.display_name}${p.is_owner ? " ★" : ""}`)
                  .join(", ")}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
