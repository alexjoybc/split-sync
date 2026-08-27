"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { EventRow, Race } from "@/lib/types";
import { RaceNav } from "@/components/RaceNav";

const statusStyle: Record<string, string> = {
  upcoming: "bg-zinc-200 text-zinc-700",
  active: "bg-race-yellow text-race-ink",
  finished: "bg-race-ink text-white",
};

export default function EventResults({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [races, setRaces] = useState<Race[]>([]);

  useEffect(() => {
    supabase.from("events").select("*").eq("id", eventId).single().then(({ data }) => setEvent(data));
    supabase.from("races").select("*").eq("event_id", eventId).order("sequence_order").then(({ data }) => setRaces(data ?? []));
  }, [eventId]);

  if (!event) return <main className="race-page grid place-items-center"><p className="text-sm font-black uppercase tracking-wide text-race-muted">Loading results…</p></main>;

  return <main className="race-page"><div className="race-topline" /><RaceNav links={[{ href: "/", label: "All events" }]} /><header className="race-masthead"><div className="mx-auto max-w-2xl"><p className="race-kicker">SplitSync // event results</p><h1 className="race-title">{event.title}</h1><p className="mt-1 text-xs font-bold uppercase tracking-wide text-race-muted">{event.location}</p></div></header><div className="mx-auto max-w-2xl px-4 py-8 sm:px-6"><div className="race-section-heading"><p className="race-kicker">Live classifications</p><h2 className="mt-1 text-2xl font-black uppercase">Race results</h2></div>{races.length === 0 ? <p className="py-10 text-center text-sm font-bold uppercase tracking-wide text-race-muted">Race schedule coming soon</p> : <ul className="mt-5 border-t-2 border-race-ink">{races.map((race) => <li key={race.id} className="flex items-center justify-between gap-3 border-b border-zinc-300 bg-race-panel px-4 py-4 even:bg-race-panel-alt"><div className="min-w-0"><p className="truncate text-base font-black uppercase">{race.name}</p><p className="mt-1 text-xs font-bold text-race-muted">{race.laps_planned ? `${race.laps_planned} laps` : "Timed race"}</p></div><div className="flex shrink-0 items-center gap-3"><span className={`px-2 py-1 text-[10px] font-black uppercase tracking-wide ${statusStyle[race.status]}`}>{race.status === "active" ? "Live" : race.status}</span><Link href={`/live/${race.id}`} className="race-action">View</Link></div></li>)}</ul>}<p className="mt-6 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-race-muted">Live unofficial timing · SplitSync</p></div></main>;
}
