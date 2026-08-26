"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { EventRow, Race } from "@/lib/types";

const statusStyle: Record<string, string> = {
  upcoming: "bg-zinc-200 text-zinc-700",
  active: "bg-race-yellow text-race-ink",
  finished: "bg-zinc-950 text-white",
};

export default function Home() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [races, setRaces] = useState<Race[]>([]);

  useEffect(() => {
    supabase.from("events").select("*").then(({ data }) => setEvents(data ?? []));
    supabase.from("races").select("*").order("sequence_order").then(({ data }) => setRaces(data ?? []));
  }, []);

  return (
    <main className="race-page">
      <div className="race-topline" />
      <header className="race-masthead">
        <div className="mx-auto flex max-w-3xl items-end justify-between gap-4">
          <div><p className="race-kicker">Grassroots race control</p><h1 className="race-title">SplitSync</h1></div>
          <Link href="/new" className="race-action race-action--yellow">+ New event</Link>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-6">
        <div className="race-section-heading"><p className="race-kicker">Race calendar</p><h2 className="mt-1 text-2xl font-black uppercase">Events</h2></div>
        {events.length === 0 && <p className="py-10 text-center text-sm font-bold uppercase tracking-wide text-zinc-500">No events yet. Create the first race night.</p>}
        {events.map((event) => <section key={event.id} className="border-b-2 border-zinc-950 py-5">
          <Link href={`/event/${event.id}`} className="group flex items-baseline justify-between gap-4"><div><h3 className="text-lg font-black uppercase group-hover:text-[#ec1c24]">{event.title}</h3><p className="mt-1 text-xs font-bold uppercase tracking-wide text-zinc-500">{event.location ?? "Location to be confirmed"}</p></div><span className="text-xl font-black">→</span></Link>
          <ul className="mt-4 border-t border-zinc-300">
            {races.filter((race) => race.event_id === event.id).map((race) => <li key={race.id} className="flex items-center justify-between gap-3 border-b border-zinc-300 bg-race-panel px-3 py-3 even:bg-race-panel-alt"><div className="min-w-0"><p className="truncate text-sm font-black uppercase">{race.name}</p><span className={`mt-1 inline-flex px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${statusStyle[race.status]}`}>{race.status}</span></div><div className="flex shrink-0 gap-2"><Link href={`/live/${race.id}`} className="race-action">Live</Link><Link href={`/score/${race.id}`} className="race-action race-action--outline">Score</Link></div></li>)}
          </ul>
        </section>)}
      </div>
    </main>
  );
}
