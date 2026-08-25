"use client";

import { use, useMemo, useState } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import { useRaceData } from "@/lib/useRaceData";
import { computeStandings, fmtLapTime } from "@/lib/standings";

function classNames(...classes: (string | false)[]) {
  return classes.filter(Boolean).join(" ");
}

export default function LiveBoard({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = use(params);
  const { race, entries, crossings, loading } = useRaceData(raceId);
  const [query, setQuery] = useState("");

  const standings = useMemo(
    () => computeStandings(crossings, entries),
    [crossings, entries]
  );

  const leader = standings[0];
  const leaderLaps = leader?.laps ?? 0;
  const lapsToGo =
    race?.laps_planned != null ? Math.max(race.laps_planned - leaderLaps, 0) : null;

  const q = query.trim().toLowerCase();
  const matches = (r: (typeof standings)[number]) =>
    q !== "" && (r.bib === q || r.name.toLowerCase().includes(q));

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-gray-950 text-gray-400">
        Loading…
      </main>
    );
  }
  if (!race) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-gray-950 text-gray-400">
        Race not found
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-gray-950 pb-16">
      {/* Header */}
      <header className="border-b border-white/10 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">{race.name}</h1>
            <p className="text-xs text-gray-400">SplitSync live</p>
          </div>
          <span
            className={classNames(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              race.status === "active"
                ? "bg-green-400/10 text-green-400"
                : race.status === "finished"
                  ? "bg-indigo-400/10 text-indigo-400"
                  : "bg-white/10 text-gray-300"
            )}
          >
            {race.status === "active" && (
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-green-400" />
              </span>
            )}
            {race.status === "active" ? "LIVE" : race.status}
          </span>
        </div>
      </header>

      {/* Race stats — Tailwind Plus "stats with shared borders" pattern */}
      <dl className="mx-auto mt-4 grid max-w-3xl grid-cols-3 divide-x divide-white/10 overflow-hidden rounded-lg bg-gray-800/75 inset-ring inset-ring-white/10 sm:mt-6">
        <div className="px-4 py-4 sm:p-5">
          <dt className="text-xs font-normal text-gray-400">Laps to go</dt>
          <dd className="mt-1 text-3xl font-semibold tabular-nums text-white">
            {lapsToGo ?? "—"}
          </dd>
        </div>
        <div className="px-4 py-4 sm:p-5">
          <dt className="text-xs font-normal text-gray-400">Leader</dt>
          <dd className="mt-1 truncate text-3xl font-semibold text-indigo-400">
            {leaderLaps > 0 ? `#${leader.bib}` : "—"}
          </dd>
        </div>
        <div className="px-4 py-4 sm:p-5">
          <dt className="text-xs font-normal text-gray-400">Last lap</dt>
          <dd className="mt-1 text-3xl font-semibold tabular-nums text-white">
            {fmtLapTime(leader?.lastLapMs ?? null)}
          </dd>
        </div>
      </dl>

      {/* Find your rider */}
      <div className="mx-auto mt-4 max-w-3xl px-4 sm:px-0">
        <div className="grid grid-cols-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find your rider — bib or name"
            className="col-start-1 row-start-1 block w-full rounded-md bg-white/5 py-2 pr-3 pl-10 text-sm text-white outline-1 -outline-offset-1 outline-white/10 placeholder:text-gray-500 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-500"
          />
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="pointer-events-none col-start-1 row-start-1 ml-3 size-4 self-center text-gray-500"
          />
        </div>
      </div>

      {/* Standings */}
      <div className="mx-auto mt-4 max-w-3xl">
        <table className="min-w-full divide-y divide-white/15">
          <thead>
            <tr className="text-left text-xs font-semibold text-gray-400">
              <th scope="col" className="py-2 pr-2 pl-4 sm:pl-2">
                Pos
              </th>
              <th scope="col" className="px-2 py-2">
                Rider
              </th>
              <th scope="col" className="px-2 py-2 text-right">
                Laps
              </th>
              <th scope="col" className="hidden px-2 py-2 text-right sm:table-cell">
                Last lap
              </th>
              <th scope="col" className="py-2 pr-4 pl-2 text-right sm:pr-2">
                Gap
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {standings.map((row) => {
              const hit = matches(row);
              return (
                <tr
                  key={row.bib}
                  className={classNames(
                    hit && "bg-indigo-500/15",
                    !hit && q !== "" && "opacity-40"
                  )}
                >
                  <td className="py-3 pr-2 pl-4 text-sm font-semibold tabular-nums text-gray-300 sm:pl-2">
                    {row.laps > 0 ? row.position : "—"}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex w-10 shrink-0 justify-center rounded-md bg-white/10 px-1.5 py-0.5 text-sm font-bold tabular-nums text-white">
                        {row.bib}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{row.name}</p>
                        {row.team && (
                          <p className="truncate text-xs text-gray-400">{row.team}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-3 text-right text-sm font-semibold tabular-nums text-white">
                    {row.laps}
                  </td>
                  <td className="hidden px-2 py-3 text-right text-sm tabular-nums text-gray-300 sm:table-cell">
                    {fmtLapTime(row.lastLapMs)}
                  </td>
                  <td
                    className={classNames(
                      "py-3 pr-4 pl-2 text-right text-sm tabular-nums sm:pr-2",
                      row.gapText.startsWith("-") ? "text-amber-400" : "text-gray-300"
                    )}
                  >
                    {row.position === 1 && row.laps > 0 ? "Leader" : row.gapText}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
