"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { RaceNav } from "@/components/RaceNav";
import { STATUS_COLORS } from "@/lib/statusColors";
import type { EventRow, Race } from "@/lib/types";

export default function EventsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [races, setRaces] = useState<Race[]>([]);
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    supabase.from("events").select("*").then(({ data }) => setEvents(data ?? []));
    supabase.from("races").select("*").order("sequence_order").then(({ data }) => setRaces(data ?? []));
  }, [loading, user]);

  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <RaceNav links={user ? [{ href: "/new", label: "+ New event" }] : []} showAuth />
      <header className="race-masthead">
        <div className="mx-auto max-w-3xl">
          <p className="race-kicker--muted">Race calendar</p>
          <h1 className="race-title">Events</h1>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-6">
        {!loading && events.length === 0 && (
          <p className="py-10 text-center text-sm font-bold uppercase tracking-wide text-race-muted">
            No events yet.{" "}
            {user ? (
              <Link href="/new" className="underline">
                Create the first race night.
              </Link>
            ) : (
              "Check back soon."
            )}
          </p>
        )}
        {events.map((event) => (
          <section key={event.id} className="border-b-2 border-race-ink py-5">
            <Link href={`/event/${event.id}`} className="group flex items-baseline justify-between gap-4">
              <div>
                <h3 className="text-lg font-black uppercase group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">
                  {event.title}
                </h3>
                <p className="mt-1 text-xs font-bold uppercase tracking-wide text-race-muted">
                  {event.location ?? "Location to be confirmed"}
                </p>
              </div>
              <span className="text-xl font-black">→</span>
            </Link>
            <ul className="mt-4 border-t border-race-line">
              {races
                .filter((race) => race.event_id === event.id)
                .map((race) => (
                  <li
                    key={race.id}
                    className="flex items-center justify-between gap-3 border-b border-race-line bg-race-panel px-3 py-3 even:bg-race-panel-alt"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black uppercase">{race.name}</p>
                      <span
                        className={`mt-1 inline-flex px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${STATUS_COLORS[race.status]}`}
                      >
                        {race.status}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Link href={`/live/${race.id}`} className="race-action--muted">
                        Live
                      </Link>
                      <Link href={`/score/${race.id}`} className="race-action--muted race-action--outline">
                        Score
                      </Link>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
