"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PlusIcon } from "@heroicons/react/20/solid";
import { supabase } from "@/lib/supabase";
import type { Entry, EventRow, Race } from "@/lib/types";

const inputCls =
  "block w-full rounded-md bg-white px-3 py-2 text-sm text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500";

function AddRider({ raceId, onAdded }: { raceId: string; onAdded: () => void }) {
  const [bib, setBib] = useState("");
  const [name, setName] = useState("");

  const add = async () => {
    if (!bib.trim() || !name.trim()) return;
    const { error } = await supabase
      .from("entries")
      .insert({ race_id: raceId, bib: bib.trim(), name: name.trim() });
    if (!error) {
      setBib("");
      setName("");
      onAdded();
    }
  };

  return (
    <div className="mt-3 flex gap-2">
      <input value={bib} onChange={(e) => setBib(e.target.value)} placeholder="Bib" inputMode="numeric" className={`${inputCls} !w-20`} />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rider name" onKeyDown={(e) => e.key === "Enter" && add()} className={inputCls} />
      <button onClick={add} className="shrink-0 rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xs inset-ring inset-ring-gray-300 hover:bg-gray-50 dark:bg-white/10 dark:text-white dark:inset-ring-white/15 dark:hover:bg-white/20">
        <PlusIcon className="size-5" />
      </button>
    </div>
  );
}

export default function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [races, setRaces] = useState<Race[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [newRace, setNewRace] = useState({ name: "", laps: "" });

  const refetch = useCallback(async () => {
    const [ev, rs, en] = await Promise.all([
      supabase.from("events").select("*").eq("id", eventId).single(),
      supabase.from("races").select("*").eq("event_id", eventId).order("sequence_order"),
      supabase.from("entries").select("*"),
    ]);
    if (ev.data) setEvent(ev.data);
    if (rs.data) {
      setRaces(rs.data);
      if (en.data) setEntries(en.data.filter((e: Entry) => rs.data.some((r: Race) => r.id === e.race_id)));
    }
  }, [eventId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const addRace = async () => {
    if (!newRace.name.trim()) return;
    await supabase.from("races").insert({
      event_id: eventId,
      name: newRace.name.trim(),
      sequence_order: races.length + 1,
      laps_planned: newRace.laps ? parseInt(newRace.laps, 10) : null,
    });
    setNewRace({ name: "", laps: "" });
    refetch();
  };

  if (!event) {
    return <main className="flex min-h-dvh items-center justify-center text-gray-400">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400">← All events</Link>
      <h1 className="mt-2 text-xl font-bold text-gray-900 dark:text-white">{event.title}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">{event.location}</p>

      <div className="mt-6 space-y-4">
        {races.map((race) => {
          const raceEntries = entries.filter((e) => e.race_id === race.id);
          return (
            <section key={race.id} className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800/75 dark:inset-ring dark:inset-ring-white/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{race.name}</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {race.laps_planned ? `${race.laps_planned} laps` : "open-ended"} · {raceEntries.length} riders · {race.status}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link href={`/live/${race.id}`} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 dark:bg-indigo-500">Live</Link>
                  <Link href={`/score/${race.id}`} className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xs inset-ring inset-ring-gray-300 hover:bg-gray-50 dark:bg-white/10 dark:text-white dark:inset-ring-white/15">Score</Link>
                </div>
              </div>

              {raceEntries.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {raceEntries.map((e) => (
                    <span key={e.id} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 dark:bg-white/10 dark:text-gray-300">
                      <b className="tabular-nums">#{e.bib}</b> {e.name}
                    </span>
                  ))}
                </div>
              )}

              {race.status === "upcoming" && <AddRider raceId={race.id} onAdded={refetch} />}
            </section>
          );
        })}

        <section className="rounded-lg border-2 border-dashed border-gray-300 p-4 dark:border-white/15">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Add race</h2>
          <div className="mt-2 flex gap-2">
            <input value={newRace.name} onChange={(e) => setNewRace({ ...newRace, name: e.target.value })} placeholder="Race name" className={inputCls} />
            <input value={newRace.laps} onChange={(e) => setNewRace({ ...newRace, laps: e.target.value.replace(/\D/g, "") })} placeholder="Laps" inputMode="numeric" className={`${inputCls} !w-20`} />
            <button onClick={addRace} className="shrink-0 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 dark:bg-indigo-500">Add</button>
          </div>
        </section>
      </div>
    </main>
  );
}
