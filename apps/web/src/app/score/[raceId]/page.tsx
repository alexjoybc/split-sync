"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRaceData } from "@/lib/useRaceData";
import { recordCrossing, flushQueue, pendingCount } from "@/lib/crossingQueue";
import { useAuth } from "@/lib/useAuth";
import { RaceNav } from "@/components/RaceNav";

export default function Scorer({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = use(params);
  const { race, entries, crossings, loading, refetch } = useRaceData(raceId);
  const [pending, setPending] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const { user, loading: authLoading } = useAuth();

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

  const setRaceStatus = async (status: "active" | "finished") => {
    await supabase
      .from("races")
      .update({ status, ...(status === "active" ? { started_at: new Date().toISOString() } : {}) })
      .eq("id", raceId);
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
    return <main className="race-page"><div className="race-topline" /><div className="mx-auto max-w-lg px-4 py-16"><div className="race-panel p-5"><p className="race-kicker">Scorer access</p><h1 className="mt-1 text-2xl font-black uppercase">Organizer sign-in required</h1><p className="mt-3 text-sm text-race-muted">Only the event organizer can score this race until volunteer scorer access is configured.</p><Link href="/login" className="race-action mt-5 inline-block">Sign in</Link></div></div></main>;
  }

  return (
    <main className="race-page">
      <div className="race-topline" />
      <RaceNav links={[{ href: `/event/${race.event_id}`, label: "Event setup" }, { href: `/results/${race.event_id}`, label: "Spectator results" }]} showAuth />
      <div className="mx-auto flex min-h-[calc(100dvh-0.5rem)] max-w-lg flex-col px-4 py-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
            <p className="race-kicker">Race control</p>
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
            className="race-action race-action--yellow"
          >
            Start race
          </button>
        )}
        {race.status === "active" && (
          <button
            onClick={() => setRaceStatus("finished")}
            className="race-action"
          >
            Finish
          </button>
        )}
        {race.status === "finished" && (
          <Link href={`/live/${raceId}`} className="text-sm font-black uppercase text-race-red">
            View results
          </Link>
        )}
      </div>

      <p className="mt-6 text-center text-xs font-bold uppercase tracking-wide text-race-muted">Tap a rider as they cross the line</p>
      {race.status === "active" ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {entries.map((entry) => <button key={entry.id} onClick={() => submit(entry.bib)} className={`min-h-28 border-2 p-3 text-left transition-colors active:bg-race-yellow ${flash === entry.bib ? "border-race-red bg-race-red text-white" : "border-race-ink bg-race-panel text-race-ink"}`}>
          <span className="block text-3xl font-black tabular-nums">#{entry.bib}</span>
          <span className="mt-2 block truncate text-sm font-black uppercase">{entry.name}</span>
          <span className={`mt-1 block text-xs font-bold ${flash === entry.bib ? "text-white" : "text-race-muted"}`}>Lap {lapsByBib.get(entry.bib) ?? 0}</span>
        </button>)}
      </div> : <div className="race-panel mt-3 p-4 text-center text-sm font-bold text-race-muted">{entries.length} rostered riders ready. Start the race to enable crossing capture.</div>}

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
              className="font-black uppercase text-race-red hover:text-race-ink"
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
