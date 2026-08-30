"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import { supabase } from "@/lib/supabase";
import { useRaceData } from "@/lib/useRaceData";
import { recordCrossing, flushQueue, pendingCount } from "@/lib/crossingQueue";
import { useAuth } from "@/lib/useAuth";
import { canManageEvent, canManagePenalties, canScore, useEventAccess } from "@/lib/useEventAccess";
import { RaceNav } from "@/components/RaceNav";
import type { Entry, EntryStatus, PenaltyType, Race, Crossing } from "@/lib/types";
import { computeTimeTrialQueue, computeTimeTrialResults, getProgress, type TimeTrialRow } from "@/lib/timeTrial";

const STATUS_OPTIONS: { value: EntryStatus; label: string }[] = [
  { value: "ok", label: "OK" },
  { value: "dns", label: "DNS" },
  { value: "dnf", label: "DNF" },
  { value: "dsq", label: "DSQ" },
];

const PENALTY_TYPE_OPTIONS: { value: PenaltyType; label: string; needsValue: boolean }[] = [
  { value: "time_penalty", label: "Time penalty (s)", needsValue: true },
  { value: "lap_penalty", label: "Lap penalty", needsValue: true },
  { value: "relegation", label: "Relegation", needsValue: false },
  { value: "note", label: "Note only", needsValue: false },
];

const PENALTY_TYPE_LABEL: Record<PenaltyType, string> = {
  time_penalty: "Time penalty",
  lap_penalty: "Lap penalty",
  relegation: "Relegation",
  note: "Note",
};

function penaltySummary(type: PenaltyType, value: number | null): string {
  if (type === "time_penalty") return `+${value}s`;
  if (type === "lap_penalty") return `-${value} lap${value === 1 ? "" : "s"}`;
  return PENALTY_TYPE_LABEL[type];
}

interface PenaltyFormState {
  type: PenaltyType;
  value: string;
  reason: string;
  error: string | null;
}

// datetime-local inputs need "YYYY-MM-DDTHH:mm:ss.sss" in local time; round-trip
// through the input's own timezone rather than assuming UTC.
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

interface EditState {
  id: string;
  bib: string;
  time: string;
  reason: string;
  error: string | null;
}

interface RestoreState {
  id: string;
  reason: string;
  error: string | null;
}

// ─── Time trial scorer ───────────────────────────────────────────────────────

/** Format elapsed ms as M:SS.T or SS.Ts */
function fmtElapsedMs(ms: number): string {
  const totalTenths = Math.round(ms / 100);
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60);
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}.${tenths}`;
  return `${s}.${tenths}s`;
}

/** Play a short beep via Web Audio API. freq: Hz, dur: ms */
function beep(audioCtx: AudioContext, freq: number, dur: number, gainPeak = 0.2) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = freq;
  // 2ms linear attack to avoid the click/pop of square wave at full amplitude
  gain.gain.setValueAtTime(0, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(gainPeak, audioCtx.currentTime + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur / 1000);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + dur / 1000);
}

interface TimeTrialScorerProps {
  race: Race;
  entries: Entry[];
  crossings: Crossing[];
  onStart: (bib: string) => Promise<void>;
  onFinish: (bib: string) => Promise<void>;
  onUndo: (crossingId: string) => Promise<void>;
}

/** Per-runner card with its own independent elapsed timer. */
function RunnerCard({
  runner,
  fastestMs,
  results,
  onFinish,
}: {
  runner: TimeTrialRow;
  fastestMs: number | null;
  results: TimeTrialRow[];
  onFinish: (bib: string) => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { setNowMs(Date.now()); }, [runner.bib]);
  useEffect(() => {
    if (!runner.startedAt) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [runner.bib, runner.startedAt]);

  const elapsedMs = runner.startedAt != null ? nowMs - runner.startedAt : 0;
  const progress = getProgress(elapsedMs, fastestMs);
  const projectedPosition = results.filter(
    (r) => r.phase === "finished" && r.elapsedMs != null && r.elapsedMs < elapsedMs
  ).length + 1;
  const showRank = results.some((r) => r.phase === "finished");

  return (
    <div className="border-2 border-race-ink bg-race-panel p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-2xl font-black tabular-nums text-race-ink">#{runner.bib}</p>
          <p className="text-sm font-black uppercase text-race-ink">{runner.name}</p>
          <p className="mt-1 text-lg font-black tabular-nums text-race-muted">
            {fmtElapsedMs(elapsedMs)}
          </p>
          {showRank && (
            <p className="text-xs font-bold text-race-muted">
              Projected P{projectedPosition}
            </p>
          )}
          {progress.overtimeMs != null && (
            <p className="text-xs font-bold text-race-red">
              +{fmtElapsedMs(progress.overtimeMs)} over best
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onFinish(runner.bib)}
          className="race-action--muted race-action--yellow min-h-[44px]"
        >
          Finish
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-3 w-full border border-race-muted bg-zinc-100 overflow-hidden">
        {progress.indeterminate ? (
          <div className="h-full w-1/3 bg-race-yellow animate-pulse" />
        ) : (
          <div
            className={`h-full transition-all duration-1000 ${progress.overtimeMs != null ? "bg-race-red" : "bg-race-yellow"}`}
            style={{ width: `${progress.pct ?? 0}%` }}
          />
        )}
      </div>
    </div>
  );
}

function TimeTrialScorer({ race, entries, crossings, onStart, onFinish }: TimeTrialScorerProps) {
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Cleanup countdown interval on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const queue = useMemo(() => computeTimeTrialQueue(crossings, entries), [crossings, entries]);
  const results = useMemo(() => computeTimeTrialResults(crossings, entries), [crossings, entries]);

  // All entries currently on course (exactly 1 crossing each)
  const runningEntries: TimeTrialRow[] = useMemo(() => {
    const crossingCountByBib = new Map<string, number>();
    for (const c of crossings) {
      if (!c.deleted_at) crossingCountByBib.set(c.bib, (crossingCountByBib.get(c.bib) ?? 0) + 1);
    }
    return entries
      .filter((e) => e.status === "ok" && crossingCountByBib.get(e.bib) === 1)
      .map((e) => {
        const startCrossing = crossings
          .filter((c) => c.bib === e.bib && !c.deleted_at)
          .sort((a, b) => new Date(a.client_recorded_at).getTime() - new Date(b.client_recorded_at).getTime())[0];
        return {
          bib: e.bib,
          name: e.name,
          team: e.team ?? null,
          phase: "running" as const,
          startedAt: startCrossing ? new Date(startCrossing.client_recorded_at).getTime() : null,
          finishedAt: null,
          elapsedMs: null,
          position: null,
          gapText: "",
          status: "ok" as const,
        };
      });
  }, [crossings, entries]);

  const finished = useMemo(
    () =>
      results
        .filter((r) => r.phase === "finished" || r.phase === "needs-review")
        .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
    [results]
  );

  // Best finished time for progress bar reference
  const bestMs = useMemo(() => {
    const times = results
      .filter((r) => r.elapsedMs != null)
      .map((r) => r.elapsedMs as number);
    return times.length > 0 ? Math.min(...times) : null;
  }, [results]);

  const nextInQueue = queue[0] ?? null;

  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  function cancelCountdown() {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdown(null);
  }

  function startCountdown(bib: string, totalSeconds: number) {
    if (totalSeconds <= 0) {
      onStart(bib);
      return;
    }
    setCountdown(totalSeconds);
    let remaining = totalSeconds;
    const ctx = getAudioCtx();

    countdownRef.current = setInterval(async () => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining > 0) {
        beep(ctx, 660, 80, 0.18);
      } else {
        // Final beep + fire start
        beep(ctx, 880, 200, 0.25);
        clearInterval(countdownRef.current!);
        countdownRef.current = null;
        setCountdown(null);
        await onStart(bib);
      }
    }, 1000);
  }


  return (
    <div className="mt-6 space-y-4">
      {countdown !== null && nextInQueue ? (
        /* ── Countdown overlay (replaces queue + start buttons) ── */
        <section>
          <p className="race-kicker--muted mb-2">Starting…</p>
          <div className="flex flex-col items-center gap-3 border-2 border-race-ink bg-race-panel p-8">
            <p className="text-xs font-black uppercase tracking-wide text-race-muted">
              #{nextInQueue.bib} {nextInQueue.name}
            </p>
            <p className="text-7xl font-black tabular-nums text-race-ink">{countdown}</p>
            <button type="button" onClick={cancelCountdown} className="race-inline-action">
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <>
          {/* ── Queue block — reversed so next rider is at the bottom ── */}
          {queue.length > 0 && (
            <section>
              <p className="race-kicker--muted mb-2">Up next</p>
              {queue.length > 5 && (
                <p className="mb-1 text-[10px] font-bold text-race-muted">
                  +{queue.length - 5} more above
                </p>
              )}
              <ul className="divide-y divide-zinc-300 border-2 border-race-ink">
                {queue.slice(0, 5).reverse().map((row, idx, arr) => {
                  const isNext = idx === arr.length - 1;
                  return (
                    <li
                      key={row.bib}
                      className={`flex items-center gap-3 px-3 py-2 text-sm font-bold ${isNext ? "bg-race-panel" : "text-race-muted"}`}
                    >
                      {isNext && (
                        <span className="shrink-0 bg-race-ink px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                          NEXT
                        </span>
                      )}
                      <span className="tabular-nums">#{row.bib} {row.name}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-1 text-[10px] font-bold text-race-muted">
                {queue.length} rider{queue.length !== 1 ? "s" : ""} remaining
              </p>
            </section>
          )}

          {/* ── Start buttons — directly below queue, no section wrapper ── */}
          {nextInQueue && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onStart(nextInQueue.bib)}
                className="race-action--muted race-action--yellow min-h-[44px]"
              >
                Start now
              </button>
              {race.time_trial_countdown_seconds > 0 && (
                <button
                  type="button"
                  onClick={() => startCountdown(nextInQueue.bib, race.time_trial_countdown_seconds)}
                  className="race-action--muted min-h-[44px]"
                >
                  Countdown {race.time_trial_countdown_seconds}s
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Divider — only when there is something above and something below ── */}
      {(queue.length > 0 || runningEntries.length > 0) && (
        <hr className="border-race-ink/20" />
      )}

      {/* ── On Course ── */}
      {runningEntries.length > 0 && (
        <section>
          <p className="text-[10px] font-black uppercase tracking-wide text-race-muted mb-2">On course</p>
          <div className="space-y-3">
            {runningEntries.map((runner) => (
              <RunnerCard
                key={runner.bib}
                runner={runner}
                fastestMs={bestMs}
                results={results}
                onFinish={onFinish}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Finished ── */}
      {finished.length > 0 && (
        <section>
          <p className="race-kicker--muted mb-2">Finished</p>
          <ul className="divide-y divide-zinc-300 border-2 border-race-ink">
            {finished.map((row) => (
              <li key={row.bib} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-6 shrink-0 text-right font-black tabular-nums text-race-muted">
                  {row.position ?? "—"}
                </span>
                <span className="flex-1 font-bold text-race-ink">
                  #{row.bib} {row.name}
                  {row.phase === "needs-review" && (
                    <span className="ml-2 text-[10px] font-black uppercase bg-race-yellow px-1.5 py-0.5 text-race-ink">
                      review
                    </span>
                  )}
                </span>
                <span className="font-black tabular-nums text-race-ink">
                  {row.elapsedMs != null ? fmtElapsedMs(row.elapsedMs) : "—"}
                </span>
                {row.gapText && row.gapText !== "—" && (
                  <span className="text-xs font-bold text-race-muted">{row.gapText}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── Rider detail sheet ──────────────────────────────────────────────────────

interface RiderDetailSheetProps {
  entry: Entry;
  lapCount: number;
  penalties: { id: string; type: PenaltyType; value: number | null; reason: string }[];
  canManageStatus: boolean;
  canManagePenaltiesRole: boolean;
  onClose: () => void;
  onSetEntryStatus: (entry: Entry, status: EntryStatus) => Promise<void>;
  onRemovePenalty: (id: string) => Promise<void>;
  onAddPenalty: (form: PenaltyFormState) => Promise<void>;
}

function RiderDetailSheet({
  entry,
  lapCount,
  penalties,
  canManageStatus,
  canManagePenaltiesRole,
  onClose,
  onSetEntryStatus,
  onRemovePenalty,
  onAddPenalty,
}: RiderDetailSheetProps) {
  const [penaltyForm, setPenaltyForm] = useState<PenaltyFormState | null>(null);

  const handleSavePenalty = async () => {
    if (!penaltyForm) return;
    const opt = PENALTY_TYPE_OPTIONS.find((o) => o.value === penaltyForm.type)!;
    if (opt.needsValue && (!penaltyForm.value.trim() || Number(penaltyForm.value) <= 0)) {
      setPenaltyForm({ ...penaltyForm, error: `${opt.label} requires a positive value` });
      return;
    }
    if (!penaltyForm.reason.trim()) {
      setPenaltyForm({ ...penaltyForm, error: "A reason is required" });
      return;
    }
    try {
      await onAddPenalty(penaltyForm);
      setPenaltyForm(null);
    } catch (e) {
      setPenaltyForm({ ...penaltyForm, error: (e as Error).message });
    }
  };

  const statused = entry.status !== "ok";

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Sheet panel */}
      <div className="w-full max-w-lg border-2 border-race-ink bg-race-panel overflow-y-auto max-h-[85dvh] sm:max-h-[75dvh]">
        {/* Sheet header */}
        <div className="flex items-start justify-between border-b-2 border-race-ink p-4">
          <div>
            <p className="race-kicker--muted">Rider detail</p>
            <p className="mt-1 text-2xl font-black tabular-nums">#{entry.bib}</p>
            <p className="text-sm font-black uppercase">{entry.name}</p>
            <p className="mt-1 text-xs font-bold text-race-muted">
              {statused ? (
                <span className="inline-block border border-race-ink px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide">
                  {entry.status.toUpperCase()}
                  {entry.status_reason ? ` — ${entry.status_reason}` : ""}
                </span>
              ) : (
                `Lap ${lapCount}`
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 border-2 border-race-ink px-3 py-1.5 text-xs font-black uppercase tracking-wide text-race-ink hover:bg-race-ink hover:text-white"
            aria-label="Close rider detail"
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Status section */}
          {canManageStatus && (
            <div>
              <p className="race-kicker--muted mb-2">Status</p>
              <div className="flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onSetEntryStatus(entry, opt.value)}
                    aria-pressed={entry.status === opt.value}
                    aria-label={`Set status to ${opt.label} for #${entry.bib} ${entry.name}`}
                    className={`race-chip ${entry.status === opt.value ? "race-chip--on" : "race-chip--off"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Penalties section */}
          {(canManagePenaltiesRole || penalties.length > 0) && (
            <div>
              <p className="race-kicker--muted mb-2">Penalties &amp; adjustments</p>
              {penalties.length === 0 ? (
                <p className="text-xs text-race-muted font-semibold">No penalties applied.</p>
              ) : (
                <ul className="space-y-2">
                  {penalties.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-2 border-2 border-race-ink bg-race-yellow/30 px-3 py-2">
                      <div>
                        <p className="text-xs font-black uppercase tracking-wide text-race-ink">
                          {penaltySummary(p.type, p.value)}
                        </p>
                        <p className="mt-0.5 text-[10px] font-semibold text-race-muted">{p.reason}</p>
                      </div>
                      {canManagePenaltiesRole && (
                        <button
                          type="button"
                          onClick={() => onRemovePenalty(p.id)}
                          aria-label={`Remove ${penaltySummary(p.type, p.value)} penalty`}
                          className="race-inline-action shrink-0"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Add penalty form */}
              {canManagePenaltiesRole && !penaltyForm && (
                <button
                  type="button"
                  onClick={() =>
                    setPenaltyForm({ type: "time_penalty", value: "", reason: "", error: null })
                  }
                  className="mt-3 min-h-[44px] border-2 border-race-ink px-3 py-2 text-xs font-black uppercase tracking-wide text-race-ink hover:bg-race-ink hover:text-white"
                >
                  + Add penalty
                </button>
              )}

              {penaltyForm && (
                <div className="mt-3 border-2 border-race-ink bg-race-panel p-3 space-y-3">
                  <p className="race-kicker--muted">New penalty</p>

                  <label className="block text-xs font-bold uppercase tracking-wide text-race-muted">
                    Type
                    <select
                      value={penaltyForm.type}
                      onChange={(e) =>
                        setPenaltyForm({ ...penaltyForm, type: e.target.value as PenaltyType, error: null })
                      }
                      className="mt-1 w-full border-2 border-race-ink bg-white p-2 text-sm"
                    >
                      {PENALTY_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {PENALTY_TYPE_OPTIONS.find((o) => o.value === penaltyForm.type)?.needsValue && (
                    <label className="block text-xs font-bold uppercase tracking-wide text-race-muted">
                      Value
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={penaltyForm.value}
                        onChange={(e) =>
                          setPenaltyForm({ ...penaltyForm, value: e.target.value, error: null })
                        }
                        className="mt-1 w-full border-2 border-race-ink bg-white p-2 text-sm tabular-nums"
                      />
                    </label>
                  )}

                  <label className="block text-xs font-bold uppercase tracking-wide text-race-muted">
                    Reason (required)
                    <textarea
                      value={penaltyForm.reason}
                      onChange={(e) =>
                        setPenaltyForm({ ...penaltyForm, reason: e.target.value, error: null })
                      }
                      placeholder="Why is this penalty being applied?"
                      className="mt-1 w-full border-2 border-race-ink bg-white p-2 text-sm"
                      rows={2}
                    />
                  </label>

                  {penaltyForm.error && (
                    <p className="text-xs font-bold text-race-ink">{penaltyForm.error}</p>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={handleSavePenalty}
                      className="race-action--muted race-action--yellow min-h-[44px]"
                    >
                      Save penalty
                    </button>
                    <button
                      onClick={() => setPenaltyForm(null)}
                      className="min-h-[44px] text-xs font-black uppercase text-race-ink underline decoration-2 underline-offset-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main scorer page ────────────────────────────────────────────────────────

export default function Scorer({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = use(params);
  const { race, entries, crossings, deletedCrossings, penalties, loading, refetch } = useRaceData(raceId);
  const [pending, setPending] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const { user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading } = useEventAccess(race?.event_id, user);
  const canManagePenaltiesRole = canManagePenalties(role);
  const allowed = canScore(role) || canManagePenaltiesRole;
  const canManageStatus = canManageEvent(role);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EditState | null>(null);
  const [restoring, setRestoring] = useState<RestoreState | null>(null);

  // Detail sheet — which entry's sheet is open (null = none)
  const [sheetEntry, setSheetEntry] = useState<Entry | null>(null);

  const penaltiesByEntry = useMemo(() => {
    const m = new Map<string, typeof penalties>();
    for (const p of penalties) {
      const arr = m.get(p.entry_id);
      if (arr) arr.push(p);
      else m.set(p.entry_id, [p]);
    }
    return m;
  }, [penalties]);

  // Retry offline queue: on reconnect + every 5s
  useEffect(() => {
    const sync = async () => setPending(await flushQueue().then(() => pendingCount()));
    const interval = setInterval(sync, 5000);
    window.addEventListener("online", sync);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", sync);
    };
  }, []);

  // Close sheet on Escape
  useEffect(() => {
    if (!sheetEntry) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setSheetEntry(null); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [sheetEntry]);

  const submit = useCallback(
    async (value: string) => {
      if (!value) return;
      setFlash(value);
      setTimeout(() => setFlash(null), 600);
      // Haptic feedback where supported (e.g. Android Chrome, some iOS PWAs)
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(50);
      }
      await recordCrossing(raceId, value);
      setPending(pendingCount());
      refetch();
    },
    [raceId, refetch]
  );

  const lapsByBib = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of crossings) m.set(c.bib, (m.get(c.bib) ?? 0) + 1);
    return m;
  }, [crossings]);

  const recent = useMemo(() => [...crossings].reverse().slice(0, 8), [crossings]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.bib.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
    );
  }, [entries, search]);

  const undo = async (id: string) => {
    await supabase
      .from("crossings")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    refetch();
  };

  const startEdit = (c: { id: string; bib: string; client_recorded_at: string }) => {
    setEditing({ id: c.id, bib: c.bib, time: toDatetimeLocal(c.client_recorded_at), reason: "", error: null });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const { error } = await supabase.rpc("correct_crossing", {
      p_crossing_id: editing.id,
      p_bib: editing.bib,
      p_client_recorded_at: new Date(editing.time).toISOString(),
      p_reason: editing.reason,
    });
    if (error) return setEditing({ ...editing, error: error.message });
    setEditing(null);
    refetch();
  };

  const startRestore = (id: string) => setRestoring({ id, reason: "", error: null });

  const confirmRestore = async () => {
    if (!restoring) return;
    const { error } = await supabase.rpc("restore_crossing", {
      p_crossing_id: restoring.id,
      p_reason: restoring.reason,
    });
    if (error) return setRestoring({ ...restoring, error: error.message });
    setRestoring(null);
    refetch();
  };

  const setRaceStatus = async (status: "active" | "finished") => {
    // started_at/finished_at are set by the races_lifecycle_guard trigger.
    await supabase.from("races").update({ status }).eq("id", raceId);
    refetch();
  };

  const setEntryStatus = async (entry: Entry, status: EntryStatus) => {
    let reason: string | null = null;
    if (status !== "ok") {
      const input = window.prompt(`Reason for ${status.toUpperCase()} — #${entry.bib} ${entry.name} (optional):`, entry.status_reason ?? "");
      if (input === null) return; // cancelled
      reason = input.trim() === "" ? null : input.trim();
    }
    await supabase.from("entries").update({ status, status_reason: reason }).eq("id", entry.id);
    refetch();
    // Keep the sheet open but update the entry reference; refetch will cause re-render
  };

  const removePenalty = async (id: string) => {
    if (!window.confirm("Remove this penalty/adjustment?")) return;
    await supabase.from("race_entry_penalties").delete().eq("id", id);
    refetch();
  };

  const addPenalty = async (form: PenaltyFormState) => {
    if (!sheetEntry) return;
    const opt = PENALTY_TYPE_OPTIONS.find((o) => o.value === form.type)!;
    const { error } = await supabase.from("race_entry_penalties").insert({
      entry_id: sheetEntry.id,
      type: form.type,
      value: opt.needsValue ? Number(form.value) : null,
      reason: form.reason.trim(),
    });
    if (error) throw new Error(error.message);
    refetch();
  };

  const reopenRace = async () => {
    setReopenError(null);
    const { error } = await supabase.rpc("reopen_race", { p_race_id: raceId, p_reason: reopenReason });
    if (error) return setReopenError(error.message);
    setReopening(false);
    setReopenReason("");
    refetch();
  };

  if (loading || authLoading || roleLoading || !race) {
    return (
      <main className="race-page flex items-center justify-center text-race-muted">
        {loading ? "Loading…" : "Race not found"}
      </main>
    );
  }

  if (!user || !allowed) {
    return <main className="race-page"><div className="race-topline--muted" /><div className="mx-auto max-w-lg px-4 py-16"><div className="race-panel p-5"><p className="race-kicker--muted">Scorer access</p><h1 className="mt-1 text-2xl font-black uppercase">Sign-in required</h1><p className="mt-3 text-sm text-race-muted">Only the event owner or an invited organizer/scorer/official can access this race&apos;s scorer screen. Ask the organizer for an invite link.</p><Link href={`/login?next=${encodeURIComponent(`/score/${raceId}`)}`} className="race-action--muted mt-5 inline-block">Sign in</Link></div></div></main>;
  }

  // Keep sheetEntry in sync after refetch (entries array may be new objects)
  const sheetEntryLive = sheetEntry ? entries.find((e) => e.id === sheetEntry.id) ?? null : null;

  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <RaceNav links={[{ href: `/event/${race.event_id}`, label: "Event setup" }, { href: `/results/${race.event_id}`, label: "Spectator results" }]} showAuth />
      <div className="mx-auto flex min-h-[calc(100dvh-0.5rem)] max-w-lg flex-col px-4 py-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
            <p className="race-kicker--muted">Race control</p>
            <h1 className="mt-1 text-lg font-black uppercase">{race.name}</h1>
            <p className="mt-1 text-xs font-bold uppercase tracking-wide text-race-muted">
              Scorer station
            {pending > 0 && (
              <span className="ml-2 bg-race-yellow px-2 py-0.5 text-xs font-black text-race-ink">
                {pending} pending sync
              </span>
            )}
          </p>
        </div>
        {race.status === "upcoming" && (
          <button
            onClick={() => setRaceStatus("active")}
            className="race-action--muted race-action--yellow"
          >
            Start race
          </button>
        )}
        {race.status === "active" && (
          <button
            onClick={() => setRaceStatus("finished")}
            className="race-action--muted"
          >
            Finish
          </button>
        )}
        {race.status === "finished" && (
          <div className="flex items-center gap-4">
            <Link href={`/live/${raceId}`} className="text-sm font-black uppercase text-race-ink underline decoration-2 underline-offset-4">
              View results
            </Link>
            {race.results_published_at ? (
              <Link href={`/score/${raceId}/finalize`} className="text-sm font-black uppercase text-race-ink underline decoration-2 underline-offset-4">
                Published
              </Link>
            ) : (
              <Link href={`/score/${raceId}/finalize`} className="race-action--muted race-action--yellow">
                Review &amp; publish
              </Link>
            )}
            <button onClick={() => setReopening(true)} className="race-action--muted">
              Reopen race
            </button>
          </div>
        )}
      </div>

      {reopening && (
        <div className="race-panel mt-4 p-4">
          <p className="race-kicker--muted">Reopen race</p>
          <p className="mt-2 text-sm text-race-muted">
            Reopening returns this race to active and clears its finish time. If results were published, they are
            unpublished and flagged as under revision until you finalize again. A reason is required and is kept in
            the race&apos;s audit log.
          </p>
          <textarea
            value={reopenReason}
            onChange={(e) => setReopenReason(e.target.value)}
            placeholder="Why does this race need to reopen?"
            className="mt-3 w-full border-2 border-race-ink bg-white p-2 text-sm"
            rows={2}
          />
          {reopenError && <p className="mt-2 text-sm font-bold text-race-ink">{reopenError}</p>}
          <div className="mt-3 flex gap-3">
            <button
              onClick={reopenRace}
              disabled={!reopenReason.trim()}
              className="race-action--muted race-action--yellow disabled:opacity-40"
            >
              Confirm reopen
            </button>
            <button
              onClick={() => {
                setReopening(false);
                setReopenError(null);
              }}
              className="text-sm font-black uppercase text-race-ink underline decoration-2 underline-offset-4"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {race.is_time_trial ? (
        <TimeTrialScorer
          race={race}
          entries={entries}
          crossings={crossings}
          onStart={async (bib) => { await submit(bib); }}
          onFinish={async (bib) => { await submit(bib); }}
          onUndo={undo}
        />
      ) : (
        <>
          <p className="mt-6 text-center text-xs font-bold uppercase tracking-wide text-race-muted">
            {race.status === "active" ? "Tap a rider to record a crossing · tap ••• for status & penalties" : `${entries.length} rostered riders — set DNS before the start, tap Start race to enable crossing capture`}
          </p>
          <div className="relative mt-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find bib / rider"
              className="w-full border-2 border-race-ink bg-white py-2 pr-3 pl-9 text-sm font-bold outline-none placeholder:text-race-muted focus:border-race-ink"
            />
            <MagnifyingGlassIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-race-muted" />
          </div>
          {search.trim() && (
            <p className="mt-1 text-xs font-bold text-race-muted">
              {filteredEntries.length} of {entries.length} riders
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filteredEntries.map((entry) => {
              const statused = entry.status !== "ok";
              const canRecord = canScore(role) && race.status === "active" && !statused;
              const entryPenalties = penaltiesByEntry.get(entry.id) ?? [];
              const hasPenalties = entryPenalties.length > 0;
              const showDetailBtn = canManageStatus || canManagePenaltiesRole;
              return (
                <div
                  key={entry.id}
                  className={`relative min-h-28 border-2 p-3 text-left transition-colors ${flash === entry.bib ? "border-race-ink bg-race-ink text-white" : statused ? "border-race-muted bg-race-panel-alt text-race-muted" : "border-race-ink bg-race-panel text-race-ink"}`}
                >
                  {/* Primary lap-recording button — fills most of the tile */}
                  <button
                    type="button"
                    onClick={() => canRecord && submit(entry.bib)}
                    disabled={!canRecord}
                    aria-label={`Record crossing for #${entry.bib} ${entry.name}`}
                    className="block w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="block text-3xl font-black tabular-nums">#{entry.bib}</span>
                    <span className="mt-2 block truncate text-sm font-black uppercase">{entry.name}</span>
                    <span className={`mt-1 block text-xs font-bold ${flash === entry.bib ? "text-white" : "text-race-muted"}`}>
                      {statused
                        ? entry.status.toUpperCase()
                        : race.status === "active"
                        ? `Lap ${lapsByBib.get(entry.bib) ?? 0}`
                        : race.status === "upcoming"
                        ? "Race not started"
                        : "Race finished"}
                    </span>
                    {/* Penalty indicator badge */}
                    {hasPenalties && (
                      <span className="mt-1 inline-block bg-race-yellow px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-race-ink">
                        {entryPenalties.length} penalty{entryPenalties.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </button>

                  {/* Detail sheet trigger — corner button */}
                  {showDetailBtn && (
                    <button
                      type="button"
                      onClick={() => setSheetEntry(entry)}
                      aria-label={`Open detail for #${entry.bib} ${entry.name}`}
                      className={`absolute bottom-2 right-2 flex min-h-[36px] min-w-[36px] items-center justify-center border px-1.5 text-[11px] font-black uppercase tracking-widest transition-colors ${
                        flash === entry.bib
                          ? "border-white/40 text-white/70 hover:bg-white/10"
                          : statused
                          ? "border-race-muted text-race-muted hover:border-race-ink hover:text-race-ink"
                          : "border-race-muted text-race-muted hover:border-race-ink hover:text-race-ink"
                      }`}
                    >
                      •••
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Recent crossings with edit/undo */}
      <ul className="mt-4 border-y-2 border-race-ink divide-y divide-zinc-300">
        {recent.map((c) => (
          <li key={c.id} className="py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-race-ink">
                <span className="font-bold tabular-nums">#{c.bib}</span>
                <span className="ml-2 text-race-muted">
                  lap {lapsByBib.get(c.bib) ?? "?"} ·{" "}
                  {new Date(c.client_recorded_at).toLocaleTimeString()}
                </span>
              </span>
              <span className="flex items-center">
                <button
                  onClick={() => startEdit(c)}
                  aria-label={`Edit crossing for #${c.bib}`}
                  className="race-inline-action"
                >
                  Edit
                </button>
                <button
                  onClick={() => undo(c.id)}
                  aria-label={`Undo crossing for #${c.bib}`}
                  className="race-inline-action"
                >
                  Undo
                </button>
              </span>
            </div>

            {editing?.id === c.id && (
              <div className="race-panel mt-2 p-3">
                <label className="block text-xs font-bold uppercase tracking-wide text-race-muted">
                  Bib
                  <input
                    value={editing.bib}
                    onChange={(e) => setEditing({ ...editing, bib: e.target.value })}
                    className="mt-1 w-full border-2 border-race-ink bg-white p-2 text-sm tabular-nums"
                  />
                </label>
                <label className="mt-2 block text-xs font-bold uppercase tracking-wide text-race-muted">
                  Crossing time
                  <input
                    type="datetime-local"
                    step="0.001"
                    value={editing.time}
                    onChange={(e) => setEditing({ ...editing, time: e.target.value })}
                    className="mt-1 w-full border-2 border-race-ink bg-white p-2 text-sm tabular-nums"
                  />
                </label>
                <label className="mt-2 block text-xs font-bold uppercase tracking-wide text-race-muted">
                  Reason (required)
                  <textarea
                    value={editing.reason}
                    onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                    placeholder="Why is this crossing being corrected?"
                    className="mt-1 w-full border-2 border-race-ink bg-white p-2 text-sm"
                    rows={2}
                  />
                </label>
                {editing.error && <p className="mt-2 text-sm font-bold text-race-ink">{editing.error}</p>}
                <div className="mt-3 flex gap-3">
                  <button
                    onClick={saveEdit}
                    disabled={!editing.reason.trim() || !editing.bib.trim()}
                    className="race-action--muted race-action--yellow disabled:opacity-40"
                  >
                    Save correction
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    className="text-sm font-black uppercase text-race-ink underline decoration-2 underline-offset-4"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Recently removed crossings, restorable with a reason */}
      {deletedCrossings.length > 0 && (
        <div className="mt-4">
          <p className="race-kicker--muted">Recently removed</p>
          <ul className="mt-2 border-y-2 border-race-ink divide-y divide-zinc-300">
            {deletedCrossings.map((c) => (
              <li key={c.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-race-ink">
                    <span className="font-bold tabular-nums">#{c.bib}</span>
                    <span className="ml-2 text-race-muted">
                      {new Date(c.client_recorded_at).toLocaleTimeString()}
                    </span>
                  </span>
                  <button
                    onClick={() => startRestore(c.id)}
                    aria-label={`Restore crossing for #${c.bib}`}
                    className="race-inline-action"
                  >
                    Restore
                  </button>
                </div>

                {restoring?.id === c.id && (
                  <div className="race-panel mt-2 p-3">
                    <label className="block text-xs font-bold uppercase tracking-wide text-race-muted">
                      Reason (required)
                      <textarea
                        value={restoring.reason}
                        onChange={(e) => setRestoring({ ...restoring, reason: e.target.value })}
                        placeholder="Why is this crossing being restored?"
                        className="mt-1 w-full border-2 border-race-ink bg-white p-2 text-sm"
                        rows={2}
                      />
                    </label>
                    {restoring.error && <p className="mt-2 text-sm font-bold text-race-ink">{restoring.error}</p>}
                    <div className="mt-3 flex gap-3">
                      <button
                        onClick={confirmRestore}
                        disabled={!restoring.reason.trim()}
                        className="race-action--muted race-action--yellow disabled:opacity-40"
                      >
                        Confirm restore
                      </button>
                      <button
                        onClick={() => setRestoring(null)}
                        className="text-sm font-black uppercase text-race-ink underline decoration-2 underline-offset-4"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>

      {/* Rider detail sheet (portal-like fixed overlay) */}
      {sheetEntryLive && (
        <RiderDetailSheet
          entry={sheetEntryLive}
          lapCount={lapsByBib.get(sheetEntryLive.bib) ?? 0}
          penalties={penaltiesByEntry.get(sheetEntryLive.id) ?? []}
          canManageStatus={canManageStatus}
          canManagePenaltiesRole={canManagePenaltiesRole}
          onClose={() => setSheetEntry(null)}
          onSetEntryStatus={setEntryStatus}
          onRemovePenalty={removePenalty}
          onAddPenalty={addPenalty}
        />
      )}
    </main>
  );
}
