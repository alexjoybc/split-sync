"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import type { EventRow, Race } from "@/lib/types";

const statusBadge: Record<string, string> = {
  upcoming: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300",
  active: "bg-green-100 text-green-800 dark:bg-green-400/10 dark:text-green-400",
  finished: "bg-indigo-100 text-indigo-800 dark:bg-indigo-400/10 dark:text-indigo-400",
};

export default function Home() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [races, setRaces] = useState<Race[]>([]);

  useEffect(() => {
    supabase.from("events").select("*").then(({ data }) => setEvents(data ?? []));
    supabase
      .from("races")
      .select("*")
      .order("sequence_order")
      .then(({ data }) => setRaces(data ?? []));
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            SplitSync
          </h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">live timing</span>
        </div>
        <Link
          href="/new"
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          New event
        </Link>
      </div>

      {events.map((event) => (
        <section key={event.id} className="mt-8">
          <Link href={`/event/${event.id}`} className="group">
            <h2 className="text-base font-semibold text-gray-900 group-hover:text-indigo-600 dark:text-white dark:group-hover:text-indigo-400">
              {event.title} →
            </h2>
          </Link>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{event.location}</p>

          <ul className="mt-4 divide-y divide-gray-200 overflow-hidden rounded-lg bg-white shadow-sm dark:divide-white/10 dark:bg-gray-800/75 dark:inset-ring dark:inset-ring-white/10">
            {races
              .filter((r) => r.event_id === event.id)
              .map((race) => (
                <li key={race.id} className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{race.name}</p>
                    <span
                      className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge[race.status]}`}
                    >
                      {race.status}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Link
                      href={`/live/${race.id}`}
                      className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                    >
                      Live
                    </Link>
                    <Link
                      href={`/score/${race.id}`}
                      className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-xs inset-ring inset-ring-gray-300 hover:bg-gray-50 dark:bg-white/10 dark:text-white dark:inset-ring-white/15 dark:hover:bg-white/20"
                    >
                      Score
                    </Link>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
