"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRaceData } from "@/lib/useRaceData";
import { recordCrossing, flushQueue, pendingCount } from "@/lib/crossingQueue";
import { useAuth } from "@/lib/useAuth";
import { canManageEvent, canScore, useEventAccess } from "@/lib/useEventAccess";
import { RaceNav } from "@/components/RaceNav";
import type { Entry, EntryStatus } from "@/lib/types";

const STATUS_OPTIONS: { value: EntryStatus; label: string }[] = [
  { value: "ok", label: "OK" },
  { value: "dns", label: "DNS" },
  { value: "dnf", label: "DNF" },
  { value: "dsq", label: "DSQ" },
];

export default function Scorer({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = use(params);
  const { race, entries, crossings, loading, refetch } = useRaceData(raceId);
  const [pending, setPending] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const { user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading } = useEventAccess(race?.event_id, user);
  const allowed = canScore(role);
  const canManageStatus = canManageEvent(role);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState<string | null>(null);

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
    return <main className="race-page"><div className="race-topline--muted" /><div className="mx-auto max-w-lg px-4 py-16"><div className="race-panel p-5"><p className="race-kicker--muted">Scorer access</p><h1 className="mt-1 text-2xl font-black uppercase">Sign-in required</h1><p className="mt-3 text-sm text-race-muted">Only the event owner or an invited organizer/scorer can score this race. Ask the organizer for an invite link.</p><Link href="/login" className="race-action--muted mt-5 inline-block">Sign in</Link></div></div></main>;
  }

  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <RaceNav links={[{ href: `/event/${race.event_id}`, label: "Event setup" }, { href: `/results/${race.event_id}`, label: "Spectator results" }, { href: "/help", label: "Help" }]} showAuth />
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
          const canScore = race.status === "active" && !statused;
          return (
            <div
              key={entry.id}
              className={`min-h-28 border-2 p-3 text-left transition-colors ${flash === entry.bib ? "border-race-ink bg-race-ink text-white" : statused ? "border-race-muted bg-race-panel-alt text-race-muted" : "border-race-ink bg-race-panel text-race-ink"}`}
            >
              <button
                type="button"
                onClick={() => canScore && submit(entry.bib)}
                disabled={!canScore}
                className="block w-full text-left disabled:cursor-not-allowed"
              >
                <span className="block text-3xl font-black tabular-nums">#{entry.bib}</span>
                <span className="mt-2 block truncate text-sm font-black uppercase">{entry.name}</span>
                <span className={`mt-1 block text-xs font-bold ${flash === entry.bib ? "text-white" : "text-race-muted"}`}>
                  {statused ? entry.status.toUpperCase() : `Lap ${lapsByBib.get(entry.bib) ?? 0}`}
                </span>
              </button>
              {canManageStatus && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEntryStatus(entry, opt.value)}
                      className={`border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${entry.status === opt.value ? "border-race-ink bg-race-ink text-white" : "border-race-muted text-race-muted hover:border-race-ink hover:text-race-ink"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent crossings with undo */}
      <ul className="mt-4 border-y-2 border-race-ink divide-y divide-zinc-300">
        {recent.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 text-sm">
            <span className="text-race-ink">
              <span className="font-bold tabular-nums">#{c.bib}</span>
              <span className="ml-2 text-race-muted">
                lap {lapsByBib.get(c.bib) ?? "?"} ·{" "}
                {new Date(c.client_recorded_at).toLocaleTimeString()}
              </span>
            </span>
            <button
              onClick={() => undo(c.id)}
              className="font-black uppercase text-race-ink underline decoration-2 underline-offset-4 hover:no-underline"
            >
              Undo
            </button>
          </li>
        ))}
      </ul>
      </div>
    </main>
  );
}
