"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PlusIcon } from "@heroicons/react/20/solid";
import { QRCodeSVG } from "qrcode.react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import type { Entry, EventRow, Participant, Race } from "@/lib/types";

const categories = ["U13", "U15", "U17", "Junior", "U23", "Senior", "Master 35+", "Master 40+", "Master 50+", "Open"];
const inputCls = "race-input";

export default function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [races, setRaces] = useState<Race[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rider, setRider] = useState({ bib: "", name: "", team: "", category: "" });
  const [newRace, setNewRace] = useState({ name: "", laps: "" });
  const [assigningRaceId, setAssigningRaceId] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const { user, loading: authLoading } = useAuth();

  const refetch = useCallback(async () => {
    const [ev, rs, en, ps] = await Promise.all([
      supabase.from("events").select("*").eq("id", eventId).single(),
      supabase.from("races").select("*").eq("event_id", eventId).order("sequence_order"),
      supabase.from("entries").select("*"),
      supabase.from("participants").select("*").eq("event_id", eventId).order("bib"),
    ]);
    if (ev.data) setEvent(ev.data);
    if (rs.data) setRaces(rs.data);
    if (en.data && rs.data) setEntries(en.data.filter((entry) => rs.data.some((race) => race.id === entry.race_id)));
    if (ps.data) setParticipants(ps.data);
  }, [eventId]);

  useEffect(() => { refetch(); }, [refetch]);
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const addParticipant = async () => {
    if (!rider.bib.trim() || !rider.name.trim()) return;
    const { error } = await supabase.from("participants").insert({
      event_id: eventId,
      bib: rider.bib.trim(),
      name: rider.name.trim(),
      team: rider.team.trim() || null,
      category: rider.category || null,
    });
    if (!error) {
      setRider({ bib: "", name: "", team: "", category: rider.category });
      refetch();
    }
  };

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

  const toggleAssignment = async (race: Race, participant: Participant, assigned: boolean) => {
    if (assigned) {
      const existing = entries.find((entry) => entry.race_id === race.id && entry.bib === participant.bib);
      if (existing) await supabase.from("entries").delete().eq("id", existing.id);
    } else {
      await supabase.from("entries").insert({
        race_id: race.id,
        bib: participant.bib,
        name: participant.name,
        team: participant.team,
        category: participant.category,
      });
    }
    refetch();
  };

  const publish = async () => {
    await supabase.from("events").update({ status: "live" }).eq("id", eventId);
    refetch();
  };

  if (!event || authLoading) return <main className="race-page flex items-center justify-center text-race-muted">Loading…</main>;
  if (!user || event.owner_id !== user.id) return <main className="race-page"><div className="race-topline" /><div className="mx-auto max-w-lg px-4 py-16"><div className="race-panel p-5"><p className="race-kicker">Organizer access</p><h1 className="mt-1 text-2xl font-black uppercase">This event is private</h1><p className="mt-3 text-sm text-race-muted">Sign in with the organizer email to manage this event.</p><Link href="/login" className="race-action mt-5 inline-block">Sign in</Link></div></div></main>;

  return (
    <main className="race-page">
      <div className="race-topline" />
      <header className="race-masthead"><div className="mx-auto max-w-3xl"><Link href="/" className="text-xs font-black uppercase tracking-wide text-race-yellow hover:text-white">← All events</Link><p className="race-kicker mt-4">Event setup</p><h1 className="race-title">{event.title}</h1><p className="mt-1 text-xs font-bold uppercase tracking-wide text-zinc-400">{event.location}</p></div></header>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">

      <section className="race-panel mt-8 p-4">
        <div className="flex items-baseline justify-between"><h2 className="text-base font-black uppercase">1. Event roster</h2><span className="text-sm font-bold text-race-muted">{participants.length} racers</span></div>
        <p className="mt-1 text-sm text-race-muted">Add each racer once, then place them in one or more races below.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-[80px_1fr_1fr_150px_auto]">
          <input value={rider.bib} onChange={(e) => setRider({ ...rider, bib: e.target.value })} placeholder="Bib" inputMode="numeric" className={inputCls} />
          <input value={rider.name} onChange={(e) => setRider({ ...rider, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addParticipant()} placeholder="Racer name" className={inputCls} />
          <input value={rider.team} onChange={(e) => setRider({ ...rider, team: e.target.value })} placeholder="Team / club" className={inputCls} />
          <input value={rider.category} onChange={(e) => setRider({ ...rider, category: e.target.value })} placeholder="Category" list="categories" className={inputCls} />
          <button onClick={addParticipant} className="race-action flex items-center justify-center"><PlusIcon className="size-5" /></button>
        </div>
        <datalist id="categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>
        {participants.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{participants.map((participant) => <span key={participant.id} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700 dark:bg-white/10 dark:text-gray-300"><b>#{participant.bib}</b> {participant.name}{participant.category && <span className="ml-1 text-gray-500 dark:text-gray-400">· {participant.category}</span>}</span>)}</div>}
      </section>

      <section className="mt-6">
        <div className="race-section-heading flex items-baseline justify-between"><h2 className="text-base font-black uppercase">2. Races</h2><span className="text-sm font-bold text-race-muted">Create then assign racers</span></div>
        <div className="mt-3 space-y-3">
          {races.map((race) => {
            const raceEntries = entries.filter((entry) => entry.race_id === race.id);
            const open = assigningRaceId === race.id;
            return <section key={race.id} className="rounded-lg bg-white p-4 shadow-sm dark:bg-gray-800/75 dark:inset-ring dark:inset-ring-white/10">
              <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-gray-900 dark:text-white">{race.name}</h3><p className="text-xs text-gray-500 dark:text-gray-400">{race.laps_planned ? `${race.laps_planned} laps` : "open-ended"} · {raceEntries.length} racers · {race.status}</p></div><div className="flex gap-2"><button onClick={() => setAssigningRaceId(open ? null : race.id)} className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xs inset-ring inset-ring-gray-300 hover:bg-gray-50 dark:bg-white/10 dark:text-white dark:inset-ring-white/15">Assign</button><Link href={`/score/${race.id}`} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 dark:bg-indigo-500">Score</Link></div></div>
              {open && <div className="mt-4 grid gap-1 border-t border-gray-200 pt-3 dark:border-white/10 sm:grid-cols-2">{participants.map((participant) => { const assigned = raceEntries.some((entry) => entry.bib === participant.bib); return <label key={participant.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-gray-50 dark:hover:bg-white/5"><input type="checkbox" checked={assigned} onChange={() => toggleAssignment(race, participant, assigned)} className="size-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600" /><span className="text-sm text-gray-900 dark:text-white"><b>#{participant.bib}</b> {participant.name}</span>{participant.category && <span className="ml-auto text-xs text-gray-500">{participant.category}</span>}</label>; })}</div>}
              {raceEntries.length > 0 && !open && <div className="mt-3 flex flex-wrap gap-1.5">{raceEntries.map((entry) => <span key={entry.id} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700 dark:bg-white/10 dark:text-gray-300"><b>#{entry.bib}</b> {entry.name}</span>)}</div>}
            </section>;
          })}
          <section className="rounded-lg border-2 border-dashed border-gray-300 p-4 dark:border-white/15"><h3 className="text-sm font-semibold text-gray-900 dark:text-white">Add race</h3><div className="mt-2 flex gap-2"><input value={newRace.name} onChange={(e) => setNewRace({ ...newRace, name: e.target.value })} placeholder="Race name" className={inputCls} /><input value={newRace.laps} onChange={(e) => setNewRace({ ...newRace, laps: e.target.value.replace(/\D/g, "") })} placeholder="Laps" inputMode="numeric" className={`${inputCls} !w-20`} /><button onClick={addRace} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 dark:bg-indigo-500">Add</button></div></section>
        </div>
      </section>
      <section className="race-panel mt-6 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="race-kicker">3. Publish</p><h2 className="mt-1 text-base font-black uppercase">Spectator sharing</h2><p className="mt-1 text-sm text-race-muted">Publish when the roster is ready, then display or print a QR code for each race.</p></div>{event.status === "live" ? <span className="bg-race-yellow px-3 py-2 text-xs font-black uppercase">Published</span> : <button onClick={publish} className="race-action">Publish event</button>}</div>
        {event.status === "live" && origin && races.length > 0 && <div className="mt-5 grid gap-4 sm:grid-cols-2">{races.map((race) => { const liveUrl = `${origin}/live/${race.id}`; return <div key={race.id} className="border-2 border-race-ink bg-race-paper p-3"><div className="flex items-center gap-3"><QRCodeSVG value={liveUrl} size={76} bgColor="#f4f1ea" fgColor="#18181b" /><div className="min-w-0"><p className="text-sm font-black uppercase">{race.name}</p><p className="mt-1 break-all text-[10px] font-bold text-race-muted">{liveUrl}</p><a href={liveUrl} target="_blank" className="mt-2 inline-block text-xs font-black uppercase text-race-red">Open live board ↗</a></div></div></div>; })}</div>}
      </section>
      </div>
    </main>
  );
}
