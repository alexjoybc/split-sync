"use client";

import { use, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import { useRaceData } from "@/lib/useRaceData";
import { computeStandings, filterByCategory, fmtLapTime, getCategories, type StandingRow } from "@/lib/standings";
import { RaceNav } from "@/components/RaceNav";
import type { Crossing, Entry } from "@/lib/types";

function classNames(...classes: (string | false)[]) {
  return classes.filter(Boolean).join(" ");
}

function RaceClock({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const totalSeconds = Math.floor(Math.max(0, now - new Date(startedAt).getTime()) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return <span className="tabular-nums">{hours > 0 ? `${hours}:` : ""}{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</span>;
}

function computePodiums(
  crossings: Crossing[],
  entries: Entry[],
  raceStartMs: number | null,
  categories: string[]
): { category: string; rows: StandingRow[] }[] {
  const groups = categories.length > 0 ? categories : ["Overall"];
  return groups.map((category) => {
    const { crossings: c, entries: e } =
      categories.length > 0 ? filterByCategory(crossings, entries, category) : { crossings, entries };
    const rows = computeStandings(c, e, raceStartMs).filter((r) => r.laps > 0).slice(0, 3);
    return { category, rows };
  });
}

export default function LiveBoard({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = use(params);
  const { race, entries, crossings, loading } = useRaceData(raceId);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [showPodium, setShowPodium] = useState(false);

  const categories = useMemo(() => getCategories(entries), [entries]);
  const { crossings: scopedCrossings, entries: scopedEntries } = useMemo(
    () => filterByCategory(crossings, entries, category),
    [crossings, entries, category]
  );

  const raceStartMs = race?.started_at ? new Date(race.started_at).getTime() : null;
  const standings = useMemo(
    () => computeStandings(scopedCrossings, scopedEntries, raceStartMs),
    [scopedCrossings, scopedEntries, raceStartMs]
  );
  const podiums = useMemo(
    () => (showPodium ? computePodiums(crossings, entries, raceStartMs, categories) : []),
    [showPodium, crossings, entries, raceStartMs, categories]
  );
  const leader = standings[0];
  const leaderLaps = leader?.laps ?? 0;
  const lapsToGo = race?.laps_planned == null ? null : Math.max(race.laps_planned - leaderLaps, 0);
  const q = query.trim().toLowerCase();
  const matches = (row: (typeof standings)[number]) => q !== "" && (row.bib === q || row.name.toLowerCase().includes(q));

  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());

  // FLIP animation: whenever the standings order changes, smoothly slide each
  // row from its previous position to its new position instead of snapping.
  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    rowRefs.current.forEach((el, bib) => {
      nextRects.set(bib, el.getBoundingClientRect());
    });

    rowRefs.current.forEach((el, bib) => {
      const prevRect = prevRectsRef.current.get(bib);
      const nextRect = nextRects.get(bib);
      if (!prevRect || !nextRect) return;
      const deltaY = prevRect.top - nextRect.top;
      if (Math.abs(deltaY) < 1) return;

      el.style.transition = "none";
      el.style.transform = `translateY(${deltaY}px)`;
      el.style.zIndex = "1";
      // Force a reflow so the browser registers the starting position
      // before we transition back to the resting position.
      el.getBoundingClientRect();

      requestAnimationFrame(() => {
        el.style.transition = "transform 500ms cubic-bezier(0.22, 1, 0.36, 1)";
        el.style.transform = "";
      });

      const clearZIndex = () => {
        el.style.zIndex = "";
        el.removeEventListener("transitionend", clearZIndex);
      };
      el.addEventListener("transitionend", clearZIndex);
    });

    prevRectsRef.current = nextRects;
  }, [standings]);

  if (loading || !race) {
    return <main className="grid min-h-dvh place-items-center bg-race-paper font-sans text-sm font-bold uppercase tracking-widest text-race-muted">{loading ? "Loading classification" : "Race not found"}</main>;
  }

  return (
    <main className="min-h-dvh bg-race-paper pb-12 font-sans text-race-ink">
      <div className="race-topline" />
      <RaceNav links={[{ href: `/results/${race.event_id}`, label: "All event races" }, { href: "/help", label: "Help" }]} />
      <header className="bg-race-ink px-4 py-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-race-yellow">SplitSync // live classification</p>
            <h1 className="mt-1 truncate text-xl font-black uppercase tracking-tight sm:text-2xl">{race.name}</h1>
          </div>
          <div className="shrink-0 border-l border-white/25 pl-4 text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">Race time</p>
            <p className="mt-0.5 text-lg font-black tabular-nums">
              {race.status === "active" && race.started_at ? <RaceClock startedAt={race.started_at} /> : "—"}
            </p>
          </div>
        </div>
      </header>

      <section className="border-b-4 border-zinc-950 bg-white px-4 py-5 sm:px-6">
        <div className="mx-auto grid max-w-4xl grid-cols-[1.1fr_1fr_1fr] divide-x-2 divide-zinc-950">
          <div className="pr-3 sm:pr-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Race status</p>
            <p className={classNames("mt-1 text-base font-black uppercase", race.status === "active" ? "text-race-red" : "text-race-ink")}>
              {race.status === "active" ? "Live now" : race.status}
            </p>
          </div>
          <div className="px-3 sm:px-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-race-muted">Laps to go</p>
            <p className="mt-1 text-2xl font-black tabular-nums leading-none">{lapsToGo ?? "—"}</p>
          </div>
          <div className="pl-3 sm:pl-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-race-muted">Leader last lap</p>
            <p className="mt-1 text-2xl font-black tabular-nums leading-none">{fmtLapTime(leader?.lastLapMs ?? null)}</p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-4 pt-7 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-zinc-950 pb-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#ec1c24]">Official live standings</p>
            <h2 className="mt-1 text-2xl font-black uppercase tracking-tight">Classification</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPodium((v) => !v)}
              className={classNames(
                "border-2 border-zinc-950 px-3 py-2 text-xs font-black uppercase tracking-[0.1em]",
                showPodium ? "bg-zinc-950 text-white" : "bg-white text-zinc-950 hover:bg-zinc-100"
              )}
            >
              Podium
            </button>
            <div className="relative w-48 sm:w-60">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find bib / rider" className="w-full border-2 border-zinc-950 bg-white py-2 pr-3 pl-9 text-sm font-bold outline-none placeholder:text-zinc-400 focus:border-[#ec1c24]" />
              <MagnifyingGlassIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-500" />
            </div>
          </div>
        </div>

        {categories.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className={classNames(
                "border-2 border-zinc-950 px-3 py-1.5 text-xs font-black uppercase tracking-[0.08em]",
                category === null ? "bg-zinc-950 text-white" : "bg-white text-zinc-950 hover:bg-zinc-100"
              )}
            >
              Overall
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={classNames(
                  "border-2 border-zinc-950 px-3 py-1.5 text-xs font-black uppercase tracking-[0.08em]",
                  category === cat ? "bg-zinc-950 text-white" : "bg-white text-zinc-950 hover:bg-zinc-100"
                )}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {showPodium && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {podiums.map(({ category: cat, rows }) => (
              <div key={cat} className="border-2 border-zinc-950 bg-white">
                <p className="border-b-2 border-zinc-950 bg-zinc-950 px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] text-[#f6d428]">{cat}</p>
                {rows.length === 0 ? (
                  <p className="px-3 py-3 text-xs font-bold uppercase tracking-wide text-zinc-500">No finishers yet</p>
                ) : (
                  <ol className="divide-y divide-zinc-200">
                    {rows.map((row) => (
                      <li key={row.bib} className="flex items-center gap-3 px-3 py-2">
                        <span className="w-5 shrink-0 text-lg font-black tabular-nums text-zinc-700">{row.position}</span>
                        <span className="inline-flex min-w-8 shrink-0 justify-center bg-zinc-950 px-1.5 py-1 text-xs font-black tabular-nums text-white">{row.bib}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-black uppercase">{row.name}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="overflow-hidden border-b-2 border-zinc-950">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="bg-zinc-950 text-left text-[10px] font-black uppercase tracking-[0.14em] text-white">
                <th className="w-12 py-2 text-center sm:w-16">Rank</th>
                <th className="w-14 border-l border-zinc-700 py-2 text-center sm:w-16">Bib</th>
                <th className="border-l border-zinc-700 px-3 py-2">Rider</th>
                <th className="w-12 border-l border-zinc-700 py-2 text-center sm:w-16">Laps</th>
                <th className="hidden w-20 border-l border-zinc-700 py-2 text-center sm:table-cell">Last lap</th>
                <th className="w-20 border-l border-zinc-700 py-2 pr-2 text-right sm:w-28">Gap</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, index) => {
                const hit = matches(row);
                const isLeader = row.position === 1 && row.laps > 0;
                const podium = row.position > 1 && row.position <= 3 && row.laps > 0;
                return (
                  <tr
                    key={row.bib}
                    ref={(el) => {
                      if (el) rowRefs.current.set(row.bib, el);
                      else rowRefs.current.delete(row.bib);
                    }}
                    className={classNames("relative border-t border-zinc-300 transition-opacity", isLeader ? "bg-[#f6d428]" : index % 2 === 0 ? "bg-white" : "bg-[#e9e6df]", hit && !isLeader && "bg-[#ffdfdf] ring-2 ring-inset ring-[#ec1c24]", !hit && q !== "" && "opacity-35")}>
                    <td className={classNames("py-3 text-center text-lg font-black tabular-nums", isLeader ? "bg-zinc-950 text-[#f6d428]" : podium ? "text-[#ec1c24]" : "text-zinc-700")}>
                      {row.laps > 0 ? row.position : "—"}
                    </td>
                    <td className="border-l border-zinc-300 py-3 text-center"><span className="inline-flex min-w-8 justify-center bg-zinc-950 px-1.5 py-1 text-sm font-black tabular-nums text-white">{row.bib}</span></td>
                    <td className="border-l border-zinc-300 px-3 py-3"><p className="truncate text-sm font-black uppercase sm:text-base">{row.name}</p><p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-zinc-500">{row.team ?? (row.isUnknownBib ? "Unregistered rider" : "Independent")}</p></td>
                    <td className="border-l border-zinc-300 py-3 text-center text-base font-black tabular-nums">{row.laps}</td>
                    <td className="hidden border-l border-zinc-300 py-3 text-center text-sm font-bold tabular-nums sm:table-cell">{fmtLapTime(row.lastLapMs)}</td>
                    <td className={classNames("border-l border-zinc-300 py-3 pr-2 text-right text-sm font-black tabular-nums", row.gapText.startsWith("-") ? "text-[#ec1c24]" : "text-zinc-900")}>
                      {isLeader ? "Leader" : row.gapText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
          Live unofficial classification · Updates automatically ·{" "}
          <Link href={`/announce/${raceId}`} className="underline hover:text-zinc-800">
            Announcer / TV view
          </Link>
        </p>
      </div>
    </main>
  );
}
