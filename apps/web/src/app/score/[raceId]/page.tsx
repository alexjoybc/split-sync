"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRaceData } from "@/lib/useRaceData";
import { recordCrossing, flushQueue, pendingCount } from "@/lib/crossingQueue";
import { useAuth } from "@/lib/useAuth";
import { canManageEvent, canManagePenalties, canScore, useEventAccess } from "@/lib/useEventAccess";
import { RaceNav } from "@/components/RaceNav";
import type { Entry, EntryStatus, PenaltyType } from "@/lib/types";

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
  entryId: string;
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
  const [editing, setEditing] = useState<EditState | null>(null);
  const [restoring, setRestoring] = useState<RestoreState | null>(null);
  const [penaltyForm, setPenaltyForm] = useState<PenaltyFormState | null>(null);

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

  const submit = useCallback(
    async (value: string) => {
      if (!value) return;
      setFlash(value);
      setTimeout(() => setFlash(null), 600);
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
  };

  const startPenalty = (entryId: string) =>
    setPenaltyForm({ entryId, type: "time_penalty", value: "", reason: "", error: null });

  const savePenalty = async () => {
    if (!penaltyForm) return;
    const opt = PENALTY_TYPE_OPTIONS.find((o) => o.value === penaltyForm.type)!;
    if (opt.needsValue && (!penaltyForm.value.trim() || Number(penaltyForm.value) <= 0)) {
      return setPenaltyForm({ ...penaltyForm, error: `${opt.label} requires a positive value` });
    }
    if (!penaltyForm.reason.trim()) {
      return setPenaltyForm({ ...penaltyForm, error: "A reason is required" });
    }
    const { error } = await supabase.from("race_entry_penalties").insert({
      entry_id: penaltyForm.entryId,
      type: penaltyForm.type,
      value: opt.needsValue ? Number(penaltyForm.value) : null,
      reason: penaltyForm.reason.trim(),
    });
    if (error) return setPenaltyForm({ ...penaltyForm, error: error.message });
    setPenaltyForm(null);
    refetch();
  };

  const removePenalty = async (id: string) => {
    if (!window.confirm("Remove this penalty/adjustment?")) return;
    await supabase.from("race_entry_penalties").delete().eq("id", id);
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
            Reopening returns this race to active and clears its finish time. A reason is required and is kept in the
            race&apos;s audit log.
          </p>
          <textarea
            value={reopenReason}
            onChange={(e) => setReopenReason(e.target.value)}
            placeholder="Why does this race need to reopen?"
            className="mt-3 w-full border-2 border-race-ink bg-white p-2 text-sm"
            rows={2}
          />
          {reopenError && <p className="mt-2 text-sm font-bold text-race-red">{reopenError}</p>}
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

      <p className="mt-6 text-center text-xs font-bold uppercase tracking-wide text-race-muted">
        {race.status === "active" ? "Tap a rider as they cross the line" : `${entries.length} rostered riders — set DNS before the start, tap Start race to enable crossing capture`}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {entries.map((entry) => {
          const statused = entry.status !== "ok";
          const canRecord = canScore(role) && race.status === "active" && !statused;
          const entryPenalties = penaltiesByEntry.get(entry.id) ?? [];
          return (
            <div
              key={entry.id}
              className={`min-h-28 border-2 p-3 text-left transition-colors ${flash === entry.bib ? "border-race-ink bg-race-ink text-white" : statused ? "border-race-muted bg-race-panel-alt text-race-muted" : "border-race-ink bg-race-panel text-race-ink"}`}
            >
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
              </button>
              {canManageStatus && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEntryStatus(entry, opt.value)}
                      aria-pressed={entry.status === opt.value}
                      aria-label={`Set status to ${opt.label} for #${entry.bib} ${entry.name}`}
                      className={`race-chip ${entry.status === opt.value ? "race-chip--on" : "race-chip--off"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {entryPenalties.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {entryPenalties.map((p) => (
                    <li key={p.id} className="flex min-h-[44px] items-center justify-between gap-2 bg-race-yellow/40 px-2 py-1 text-xs font-bold uppercase text-race-ink">
                      <span className="truncate" title={p.reason}>
                        {penaltySummary(p.type, p.value)}
                      </span>
                      {canManagePenaltiesRole && (
                        <button
                          type="button"
                          onClick={() => removePenalty(p.id)}
                          aria-label={`Remove ${penaltySummary(p.type, p.value)} penalty`}
                          className="inline-flex min-h-[44px] shrink-0 items-center font-black underline decoration-2 underline-offset-2 active:opacity-70"
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canManagePenaltiesRole && (
                <button
                  type="button"
                  onClick={() => startPenalty(entry.id)}
                  className="race-inline-action mt-1"
                >
                  + Penalty
                </button>
              )}

              {penaltyForm?.entryId === entry.id && (
                <div className="race-panel mt-2 p-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-race-muted">
                    Type
                    <select
                      value={penaltyForm.type}
                      onChange={(e) => setPenaltyForm({ ...penaltyForm, type: e.target.value as PenaltyType, error: null })}
                      className="mt-1 w-full border-2 border-race-ink bg-white p-1.5 text-xs"
                    >
                      {PENALTY_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {PENALTY_TYPE_OPTIONS.find((o) => o.value === penaltyForm.type)?.needsValue && (
                    <label className="mt-2 block text-[10px] font-bold uppercase tracking-wide text-race-muted">
                      Value
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={penaltyForm.value}
                        onChange={(e) => setPenaltyForm({ ...penaltyForm, value: e.target.value, error: null })}
                        className="mt-1 w-full border-2 border-race-ink bg-white p-1.5 text-xs tabular-nums"
                      />
                    </label>
                  )}
                  <label className="mt-2 block text-[10px] font-bold uppercase tracking-wide text-race-muted">
                    Reason (required)
                    <textarea
                      value={penaltyForm.reason}
                      onChange={(e) => setPenaltyForm({ ...penaltyForm, reason: e.target.value, error: null })}
                      placeholder="Why is this penalty being applied?"
                      className="mt-1 w-full border-2 border-race-ink bg-white p-1.5 text-xs"
                      rows={2}
                    />
                  </label>
                  {penaltyForm.error && <p className="mt-1 text-[10px] font-bold text-race-red">{penaltyForm.error}</p>}
                  <div className="mt-2 flex gap-3">
                    <button onClick={savePenalty} className="race-action--muted race-action--yellow px-2 py-1 text-[10px]">
                      Save
                    </button>
                    <button
                      onClick={() => setPenaltyForm(null)}
                      className="text-[10px] font-black uppercase text-race-ink underline decoration-2 underline-offset-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

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
                {editing.error && <p className="mt-2 text-sm font-bold text-race-red">{editing.error}</p>}
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
                    {restoring.error && <p className="mt-2 text-sm font-bold text-race-red">{restoring.error}</p>}
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
    </main>
  );
}
