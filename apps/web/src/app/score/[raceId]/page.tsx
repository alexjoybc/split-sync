"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRaceData } from "@/lib/useRaceData";
import { recordCrossing, flushQueue, pendingCount } from "@/lib/crossingQueue";
import { useAuth } from "@/lib/useAuth";
import { RaceNav } from "@/components/RaceNav";

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
  const { race, entries, crossings, deletedCrossings, loading, refetch } = useRaceData(raceId);
  const [pending, setPending] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [restoring, setRestoring] = useState<RestoreState | null>(null);

  useEffect(() => {
    if (!race || !user) return setIsOwner(false);
    supabase.from("events").select("owner_id").eq("id", race.event_id).single()
      .then(({ data }) => setIsOwner(data?.owner_id === user.id));
  }, [race, user]);

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

  const reopenRace = async () => {
    setReopenError(null);
    const { error } = await supabase.rpc("reopen_race", { p_race_id: raceId, p_reason: reopenReason });
    if (error) return setReopenError(error.message);
    setReopening(false);
    setReopenReason("");
    refetch();
  };

  if (loading || authLoading || !race) {
    return (
      <main className="race-page flex items-center justify-center text-race-muted">
        {loading ? "Loading…" : "Race not found"}
      </main>
    );
  }

  if (!user || !isOwner) {
    return <main className="race-page"><div className="race-topline--muted" /><div className="mx-auto max-w-lg px-4 py-16"><div className="race-panel p-5"><p className="race-kicker--muted">Scorer access</p><h1 className="mt-1 text-2xl font-black uppercase">Organizer sign-in required</h1><p className="mt-3 text-sm text-race-muted">Only the event organizer can score this race until volunteer scorer access is configured.</p><Link href="/login" className="race-action--muted mt-5 inline-block">Sign in</Link></div></div></main>;
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

      <p className="mt-6 text-center text-xs font-bold uppercase tracking-wide text-race-muted">Tap a rider as they cross the line</p>
      {race.status === "active" ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {entries.map((entry) => <button key={entry.id} onClick={() => submit(entry.bib)} className={`min-h-28 border-2 p-3 text-left transition-colors active:bg-race-yellow ${flash === entry.bib ? "border-race-ink bg-race-ink text-white" : "border-race-ink bg-race-panel text-race-ink"}`}>
          <span className="block text-3xl font-black tabular-nums">#{entry.bib}</span>
          <span className="mt-2 block truncate text-sm font-black uppercase">{entry.name}</span>
          <span className={`mt-1 block text-xs font-bold ${flash === entry.bib ? "text-white" : "text-race-muted"}`}>Lap {lapsByBib.get(entry.bib) ?? 0}</span>
        </button>)}
      </div> : <div className="race-panel mt-3 p-4 text-center text-sm font-bold text-race-muted">{entries.length} rostered riders ready. Start the race to enable crossing capture.</div>}

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
              <span className="flex gap-3">
                <button
                  onClick={() => startEdit(c)}
                  className="font-black uppercase text-race-ink underline decoration-2 underline-offset-4 hover:no-underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => undo(c.id)}
                  className="font-black uppercase text-race-ink underline decoration-2 underline-offset-4 hover:no-underline"
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
                    className="font-black uppercase text-race-ink underline decoration-2 underline-offset-4 hover:no-underline"
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
