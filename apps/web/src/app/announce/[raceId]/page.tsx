"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import { useRaceData } from "@/lib/useRaceData";
import { computeStandings, filterByCategory, fmtLapTime, getCategories, getRecentCrossings } from "@/lib/standings";

type Mode = "announcer" | "tv";

function classNames(...classes: (string | false)[]) {
  return classes.filter(Boolean).join(" ");
}

const STATUS_LABEL: Record<string, string> = { dns: "DNS", dnf: "DNF", dsq: "DSQ" };

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
  return (
    <span className="tabular-nums">
      {hours > 0 ? `${hours}:` : ""}
      {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
    </span>
  );
}

function timeAgo(atMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - atMs) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}

/** Continuously scrolls a container top-to-bottom, pausing briefly at the
 * bottom before looping — suited to an unattended venue TV. */
function useAutoScroll(active: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    let paused = false;
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;

    const step = () => {
      if (!paused && el.scrollHeight > el.clientHeight) {
        el.scrollTop += 0.5;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
          paused = true;
          pauseTimer = setTimeout(() => {
            el.scrollTop = 0;
            paused = false;
          }, 3000);
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      if (pauseTimer) clearTimeout(pauseTimer);
    };
  }, [active]);
  return containerRef;
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="flex border-2 border-white/40 text-[11px] font-black uppercase tracking-[0.14em]">
      <button
        type="button"
        onClick={() => onChange("announcer")}
        className={classNames("px-3 py-1.5", mode === "announcer" ? "bg-race-yellow text-race-ink" : "text-white/70 hover:text-white")}
      >
        Announcer
      </button>
      <button
        type="button"
        onClick={() => onChange("tv")}
        className={classNames("border-l-2 border-white/40 px-3 py-1.5", mode === "tv" ? "bg-race-yellow text-race-ink" : "text-white/70 hover:text-white")}
      >
        TV mode
      </button>
    </div>
  );
}

function CategoryTabs({
  categories,
  category,
  onChange,
}: {
  categories: string[];
  category: string | null;
  onChange: (category: string | null) => void;
}) {
  if (categories.length === 0) return null;
  return (
    <div className="mx-auto flex max-w-5xl flex-wrap gap-2 px-4 pt-6 sm:px-6">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={classNames(
          "border-2 border-white/40 px-3 py-1.5 text-xs font-black uppercase tracking-[0.08em]",
          category === null ? "bg-race-yellow text-race-ink" : "text-white/70 hover:text-white"
        )}
      >
        Overall
      </button>
      {categories.map((cat) => (
        <button
          key={cat}
          type="button"
          onClick={() => onChange(cat)}
          className={classNames(
            "border-2 border-white/40 px-3 py-1.5 text-xs font-black uppercase tracking-[0.08em]",
            category === cat ? "bg-race-yellow text-race-ink" : "text-white/70 hover:text-white"
          )}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}

function AnnouncerBody({
  standings,
  recent,
  now,
}: {
  standings: ReturnType<typeof computeStandings>;
  recent: ReturnType<typeof getRecentCrossings>;
  now: number;
}) {
  const [query, setQuery] = useState("");
  const leader = standings.find((row) => row.status === "ok" && row.laps > 0);
  const podium = standings.filter((row) => row.status === "ok" && row.laps > 0).slice(0, 3);

  const q = query.trim().toLowerCase();
  const match = q === "" ? null : standings.find((row) => row.bib === q || row.name.toLowerCase().includes(q)) ?? null;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="space-y-6">
        <section className="border-4 border-race-yellow bg-black/40 p-6">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-race-yellow">Current leader</p>
          {leader ? (
            <div className="mt-3 flex items-baseline gap-4">
              <span className="inline-flex min-w-16 justify-center bg-race-yellow px-3 py-1.5 text-3xl font-black tabular-nums text-race-ink sm:text-4xl">{leader.bib}</span>
              <div className="min-w-0">
                <p className="truncate text-3xl font-black uppercase leading-tight text-white sm:text-5xl">{leader.name}</p>
                <p className="mt-1 truncate text-sm font-bold uppercase tracking-wide text-white/60 sm:text-base">
                  {leader.team ?? (leader.isUnknownBib ? "Unregistered rider" : "Independent")} · Lap {leader.laps}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-2xl font-black uppercase text-white/50">Awaiting first crossing</p>
          )}
        </section>

        {podium.length > 1 && (
          <section>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50">Top of the field</p>
            <ol className="mt-2 divide-y-2 divide-white/10 border-y-2 border-white/10">
              {podium.map((row) => (
                <li key={row.bib} className="flex items-center gap-4 py-3">
                  <span className="w-8 text-center text-xl font-black tabular-nums text-race-yellow">{row.position}</span>
                  <span className="inline-flex min-w-12 justify-center bg-white/10 px-2 py-1 text-lg font-black tabular-nums text-white">{row.bib}</span>
                  <span className="min-w-0 flex-1 truncate text-lg font-black uppercase text-white sm:text-xl">{row.name}</span>
                  <span className="shrink-0 text-base font-bold tabular-nums text-white/70">{row.position === 1 ? "Leader" : row.gapText}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50">Latest crossings</p>
          <ol className="mt-2 divide-y-2 divide-white/10 border-y-2 border-white/10">
            {recent.length === 0 && <li className="py-3 text-base font-bold uppercase text-white/40">No crossings recorded yet</li>}
            {recent.map((crossing, i) => (
              <li key={`${crossing.bib}-${crossing.atMs}-${i}`} className="flex items-center gap-4 py-3">
                <span className="inline-flex min-w-12 justify-center bg-white/10 px-2 py-1 text-lg font-black tabular-nums text-white">{crossing.bib}</span>
                <span className="min-w-0 flex-1 truncate text-lg font-black uppercase text-white sm:text-xl">{crossing.name}</span>
                <span className="shrink-0 text-sm font-bold uppercase tracking-wide text-white/50">Lap {crossing.lap}</span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-race-yellow">{timeAgo(crossing.atMs, now)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="h-fit border-2 border-white/30 bg-black/40 p-5">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50">Rider lookup</p>
        <div className="relative mt-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Bib or name"
            autoFocus
            className="w-full border-2 border-white/40 bg-black/60 py-3 pr-3 pl-11 text-lg font-bold text-white outline-none placeholder:text-white/30 focus:border-race-yellow"
          />
          <MagnifyingGlassIcon className="pointer-events-none absolute top-3.5 left-3.5 size-5 text-white/40" />
        </div>

        {q !== "" && !match && <p className="mt-4 text-sm font-bold uppercase tracking-wide text-white/40">No rider matches “{query}”</p>}

        {match && (
          <div className="mt-5 border-t-2 border-white/10 pt-5">
            <div className="flex items-baseline gap-3">
              <span className="inline-flex min-w-14 justify-center bg-race-yellow px-2.5 py-1 text-2xl font-black tabular-nums text-race-ink">{match.bib}</span>
              <p className="truncate text-2xl font-black uppercase text-white">{match.name}</p>
            </div>
            <p className="mt-1 text-sm font-bold uppercase tracking-wide text-white/50">{match.team ?? (match.isUnknownBib ? "Unregistered rider" : "Independent")}</p>
            <dl className="mt-4 grid grid-cols-2 gap-4 border-t-2 border-white/10 pt-4">
              <div>
                <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Standing</dt>
                <dd className="mt-1 text-2xl font-black tabular-nums text-white">
                  {match.status !== "ok" ? STATUS_LABEL[match.status] ?? match.status : match.laps > 0 ? `${match.position}${match.position === 1 ? "st" : ""}` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Laps</dt>
                <dd className="mt-1 text-2xl font-black tabular-nums text-white">{match.laps}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Last lap</dt>
                <dd className="mt-1 text-lg font-black tabular-nums text-white">{fmtLapTime(match.lastLapMs)}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Gap</dt>
                <dd className="mt-1 text-lg font-black tabular-nums text-white">{match.status !== "ok" ? "—" : match.position === 1 ? "Leader" : match.gapText || "—"}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>
    </div>
  );
}

function TvBody({ standings }: { standings: ReturnType<typeof computeStandings> }) {
  const scrollRef = useAutoScroll(true);
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div ref={scrollRef} className="max-h-[70vh] overflow-y-auto border-2 border-white/20">
        <table className="w-full table-fixed border-collapse text-white">
          <thead className="sticky top-0">
            <tr className="bg-black text-left text-xs font-black uppercase tracking-[0.14em] text-white/60">
              <th className="w-20 py-3 text-center">Rank</th>
              <th className="w-24 border-l border-white/20 py-3 text-center">Bib</th>
              <th className="border-l border-white/20 px-4 py-3">Rider</th>
              <th className="w-24 border-l border-white/20 py-3 text-center">Laps</th>
              <th className="w-32 border-l border-white/20 py-3 pr-4 text-right">Gap</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, index) => {
              const isLeader = row.position === 1 && row.laps > 0;
              const statused = row.status !== "ok";
              return (
                <tr key={row.bib} className={classNames("border-t border-white/10", isLeader ? "bg-race-yellow text-race-ink" : index % 2 === 0 ? "bg-white/5" : "bg-transparent", statused && "opacity-60")}>
                  <td className="py-4 text-center text-2xl font-black tabular-nums">
                    {statused ? STATUS_LABEL[row.status] ?? row.status : row.laps > 0 ? row.position : "—"}
                  </td>
                  <td className="border-l border-white/10 py-4 text-center">
                    <span className={classNames("inline-flex min-w-12 justify-center px-2 py-1 text-xl font-black tabular-nums", isLeader ? "bg-race-ink text-race-yellow" : "bg-white/10 text-white")}>{row.bib}</span>
                  </td>
                  <td className="border-l border-white/10 px-4 py-4 text-xl font-black uppercase">{row.name}</td>
                  <td className="border-l border-white/10 py-4 text-center text-xl font-black tabular-nums">{row.laps}</td>
                  <td className="border-l border-white/10 py-4 pr-4 text-right text-xl font-black tabular-nums">{statused ? "" : isLeader ? "Leader" : row.gapText}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnnouncerView({ raceId }: { raceId: string }) {
  const { race, entries, crossings, loading } = useRaceData(raceId);
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>(searchParams.get("mode") === "tv" ? "tv" : "announcer");
  const [category, setCategory] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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
  const recent = useMemo(
    () => getRecentCrossings(scopedCrossings, scopedEntries, raceStartMs, 5),
    [scopedCrossings, scopedEntries, raceStartMs]
  );

  const leader = standings.find((row) => row.laps > 0);
  const lapsToGo = race?.laps_planned == null ? null : Math.max(race.laps_planned - (leader?.laps ?? 0), 0);

  if (loading || !race) {
    return (
      <main className="grid min-h-dvh place-items-center bg-black font-sans text-sm font-black uppercase tracking-widest text-white/50">
        {loading ? "Loading classification" : "Race not found"}
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-black font-sans text-white">
      <div className="race-topline" />
      <header className="border-b-4 border-race-yellow bg-race-ink px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-race-yellow">SplitSync // announcer view</p>
            <h1 className="mt-1 truncate text-2xl font-black uppercase tracking-tight sm:text-4xl">{race.name}</h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">Race time</p>
              <p className="text-2xl font-black tabular-nums">{race.status === "active" && race.started_at ? <RaceClock startedAt={race.started_at} /> : "—"}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/50">Laps to go</p>
              <p className="text-2xl font-black tabular-nums">{lapsToGo ?? "—"}</p>
            </div>
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
        </div>
      </header>

      <CategoryTabs categories={categories} category={category} onChange={setCategory} />

      {mode === "announcer" ? <AnnouncerBody standings={standings} recent={recent} now={now} /> : <TvBody standings={standings} />}

      <p className="mx-auto max-w-5xl px-4 pb-6 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-white/30 sm:px-6">
        Live unofficial classification · Updates automatically ·{" "}
        <Link href={`/live/${raceId}`} className="underline hover:text-white/60">
          Spectator view
        </Link>
      </p>
    </main>
  );
}

export default function AnnouncePage({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = use(params);
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center bg-black text-sm font-black uppercase tracking-widest text-white/50">Loading classification</main>}>
      <AnnouncerView raceId={raceId} />
    </Suspense>
  );
}
