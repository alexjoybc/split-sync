"use client";

import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import { useRaceData } from "@/lib/useRaceData";
import { computeStandings, filterByCategory, fmtLapTime, getCategories, getRecentCrossings, isPenalized, type StandingRow } from "@/lib/standings";
import {
  computePointsStandings,
  getCurrentLap,
  getNextSprintText,
  getPointsRaceConfig,
  getSprintAtLap,
  getSprintLaps,
  getSprintResult,
} from "@/lib/pointsRace";
import { computeTimeTrialQueue, computeTimeTrialResults, getProgress, type TimeTrialRow } from "@/lib/timeTrial";
import type { Crossing, Entry, Race } from "@/lib/types";

type Mode = "announcer" | "tv";

function classNames(...classes: (string | false)[]) {
  return classes.filter(Boolean).join(" ");
}

const STATUS_LABEL: Record<string, string> = { dns: "DNS", dnf: "DNF", dsq: "DSQ" };

function penaltyTooltip(row: StandingRow): string {
  return row.penalties
    .map((p) => {
      if (p.type === "time_penalty") return `+${p.value}s time penalty${p.reason ? ` — ${p.reason}` : ""}`;
      if (p.type === "lap_penalty") return `-${p.value} lap penalty${p.reason ? ` — ${p.reason}` : ""}`;
      if (p.type === "relegation") return `Relegated${p.reason ? ` — ${p.reason}` : ""}`;
      return `Note${p.reason ? ` — ${p.reason}` : ""}`;
    })
    .join("\n");
}

function PenaltyBadge({ row }: { row: StandingRow }) {
  if (!isPenalized(row)) return null;
  return (
    <span title={penaltyTooltip(row)} className="ml-2 inline-flex cursor-help px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-white bg-[#ec1c24]">
      Penalty
    </span>
  );
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
                <p className="truncate text-3xl font-black uppercase leading-tight text-white sm:text-5xl">{leader.name}<PenaltyBadge row={leader} /></p>
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
                  <span className="min-w-0 flex-1 truncate text-lg font-black uppercase text-white sm:text-xl">{row.name}<PenaltyBadge row={row} /></span>
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
              <p className="truncate text-2xl font-black uppercase text-white">{match.name}<PenaltyBadge row={match} /></p>
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
                  <td className="border-l border-white/10 px-4 py-4 text-xl font-black uppercase">{row.name}<PenaltyBadge row={row} /></td>
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

/**
 * Compact points-race overlay for the announcer/TV view: a sprint-lap
 * banner + that sprint's mini-result while the field is on the sprint lap
 * (folding back once anyone crosses to the next lap), plus the cumulative
 * points leaderboard.
 */
function PointsOverlay({ race, crossings, entries }: { race: Race; crossings: Crossing[]; entries: Entry[] }) {
  const config = useMemo(() => getPointsRaceConfig(race), [race]);
  const sprintLaps = useMemo(() => getSprintLaps(config), [config]);
  const currentLap = useMemo(() => getCurrentLap(crossings), [crossings]);
  const activeSprint = useMemo(() => getSprintAtLap(sprintLaps, currentLap), [sprintLaps, currentLap]);
  const sprintResult = useMemo(
    () => (activeSprint ? getSprintResult(crossings, entries, activeSprint.lap).slice(0, config.sprintPoints.length) : []),
    [activeSprint, crossings, entries, config.sprintPoints.length]
  );
  const pointsStandings = useMemo(() => computePointsStandings(crossings, entries, race), [crossings, entries, race]);
  const nextSprintText = getNextSprintText(currentLap, sprintLaps);

  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-6">
      {activeSprint && (
        <div className={classNames("border-2 border-race-yellow px-4 py-3", activeSprint.isFinal ? "bg-[#ec1c24]" : "bg-race-yellow text-race-ink")}>
          <p className="text-xs font-black uppercase tracking-[0.24em]">
            {activeSprint.isFinal ? `Final sprint — lap ${activeSprint.lap} — double points` : `Sprint lap ${activeSprint.lap}`}
          </p>
          {sprintResult.length > 0 && (
            <ol className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
              {sprintResult.map((row) => (
                <li key={row.bib} className="text-sm font-black uppercase tabular-nums">
                  {row.place}. #{row.bib} {row.name}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <div className="mt-4 flex items-baseline justify-between border-b-2 border-white/20 pb-2">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-white/50">Points classification</p>
        <p className="text-xs font-black uppercase tracking-[0.1em] text-race-yellow">{nextSprintText}</p>
      </div>
      <ol className="mt-2 divide-y-2 divide-white/10 border-y-2 border-white/10">
        {pointsStandings.slice(0, 8).map((row) => (
          <li key={row.bib} className="flex items-center gap-4 py-2">
            <span className="w-8 text-center text-lg font-black tabular-nums text-race-yellow">{row.position ?? "—"}</span>
            <span className="inline-flex min-w-12 justify-center bg-white/10 px-2 py-1 text-base font-black tabular-nums text-white">{row.bib}</span>
            <span className="min-w-0 flex-1 truncate text-base font-black uppercase text-white">{row.name}</span>
            <span className="shrink-0 text-base font-bold tabular-nums text-white/70">{row.points} pts</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Format an elapsed millisecond value at tenths-of-a-second precision. */
function fmtElapsedMs(ms: number): string {
  const totalTenths = Math.round(ms / 100);
  const tenths = totalTenths % 10;
  const totalSecs = Math.floor(totalTenths / 10);
  const s = totalSecs % 60;
  const m = Math.floor(totalSecs / 60);
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}.${tenths}`;
  return `${s}.${tenths}s`;
}

/** Per-runner row for the announcer view, with its own timer. */
function AnnouncerRunnerRow({
  runner,
  fastestMs,
}: {
  runner: TimeTrialRow;
  fastestMs: number | null;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { setNowMs(Date.now()); }, [runner.bib]);
  useEffect(() => {
    if (!runner.startedAt) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [runner.bib, runner.startedAt]);

  const elapsedMs = runner.startedAt != null ? nowMs - runner.startedAt : 0;
  const progress = getProgress(elapsedMs, fastestMs);

  return (
    <div className="border-t border-race-yellow/30 pt-3 mt-3">
      <div className="flex items-baseline gap-4">
        <span className="inline-flex min-w-14 justify-center bg-race-yellow px-2 py-1 text-2xl font-black tabular-nums text-race-ink">
          {runner.bib}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xl font-black uppercase text-white">
            {runner.name}
          </p>
          {runner.team && (
            <p className="truncate text-sm font-bold uppercase tracking-wide text-white/60">
              {runner.team}
            </p>
          )}
        </div>
        <span className="shrink-0 text-3xl font-black tabular-nums text-race-yellow">
          {fmtElapsedMs(elapsedMs)}
        </span>
      </div>
      <div className="mt-2 h-3 w-full bg-white/20">
        {progress.indeterminate ? (
          <div className="h-3 w-full animate-pulse bg-race-yellow" />
        ) : (
          <div
            className="h-3 bg-race-yellow transition-all"
            style={{ width: `${progress.pct}%` }}
          />
        )}
      </div>
      {progress.overtimeMs != null && (
        <p className="mt-1 text-xs font-black text-race-red">
          +{fmtElapsedMs(progress.overtimeMs)} over best time
        </p>
      )}
    </div>
  );
}

function computeAnnouncerRunningEntries(crossings: Crossing[], entries: Entry[]): TimeTrialRow[] {
  const crossingCountByBib = new Map<string, number>();
  for (const cr of crossings) {
    if (!cr.deleted_at) crossingCountByBib.set(cr.bib, (crossingCountByBib.get(cr.bib) ?? 0) + 1);
  }
  return entries
    .filter((e) => e.status === "ok" && crossingCountByBib.get(e.bib) === 1)
    .map((e) => {
      const startCrossing = crossings
        .filter((cr) => cr.bib === e.bib && !cr.deleted_at)
        .sort((a, b) => new Date(a.client_recorded_at).getTime() - new Date(b.client_recorded_at).getTime())[0];
      return {
        bib: e.bib,
        name: e.name,
        team: e.team ?? null,
        phase: "running" as const,
        startedAt: startCrossing ? new Date(startCrossing.client_recorded_at).getTime() : null,
        finishedAt: null,
        elapsedMs: null,
        position: null,
        gapText: "",
        status: "ok" as const,
      } satisfies TimeTrialRow;
    });
}

function TimeTrialAnnouncer({
  entries,
  crossings,
}: {
  entries: Entry[];
  crossings: Crossing[];
}) {
  const results = useMemo(() => computeTimeTrialResults(crossings, entries), [crossings, entries]);
  const queue = useMemo(() => computeTimeTrialQueue(crossings, entries), [crossings, entries]);

  const runningEntries: TimeTrialRow[] = useMemo(
    () => computeAnnouncerRunningEntries(crossings, entries),
    [crossings, entries]
  );

  const fastestMs: number | null = useMemo(() => {
    const finished = results.filter((r) => r.phase === "finished" && r.elapsedMs != null);
    return finished.length > 0 ? Math.min(...finished.map((r) => r.elapsedMs!)) : null;
  }, [results]);

  // Single hero runner (exactly 1 runner on course)
  const singleRunner = runningEntries.length === 1 ? runningEntries[0] : null;
  const [heroNowMs, setHeroNowMs] = useState(() => Date.now());
  useEffect(() => { setHeroNowMs(Date.now()); }, [singleRunner?.bib]);
  useEffect(() => {
    if (!singleRunner?.startedAt) return;
    const t = setInterval(() => setHeroNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [singleRunner?.bib, singleRunner?.startedAt]);

  const heroElapsedMs = singleRunner?.startedAt != null ? heroNowMs - singleRunner.startedAt : 0;
  const heroProgress = singleRunner ? getProgress(heroElapsedMs, fastestMs) : null;

  const finishedResults = results.filter(
    (r) => (r.phase === "finished" || r.phase === "needs-review") && r.status === "ok"
  );
  const dnsRows = results.filter((r) => r.status !== "ok");

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Now Running section */}
      <section className="mb-8 border-4 border-race-yellow bg-black/40 p-6">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-race-yellow">
          Now on course{runningEntries.length > 1 ? ` (${runningEntries.length})` : ""}
        </p>
        {runningEntries.length === 0 ? (
          <p className="mt-3 text-2xl font-black uppercase text-white/50">
            Waiting for next rider
          </p>
        ) : runningEntries.length === 1 && singleRunner ? (
          /* Hero layout for single runner */
          <div className="mt-3">
            <div className="flex items-baseline gap-4">
              <span className="inline-flex min-w-16 justify-center bg-race-yellow px-3 py-1.5 text-3xl font-black tabular-nums text-race-ink sm:text-4xl">
                {singleRunner.bib}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-3xl font-black uppercase text-white sm:text-5xl">
                  {singleRunner.name}
                </p>
                {singleRunner.team && (
                  <p className="mt-1 truncate text-sm font-bold uppercase tracking-wide text-white/60 sm:text-base">
                    {singleRunner.team}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-4xl font-black tabular-nums text-race-yellow sm:text-5xl">
                {fmtElapsedMs(heroElapsedMs)}
              </span>
            </div>
            <div className="mt-4 h-4 w-full bg-white/20">
              {heroProgress?.indeterminate ? (
                <div className="h-4 w-full animate-pulse bg-race-yellow" />
              ) : (
                <div
                  className="h-4 bg-race-yellow transition-all"
                  style={{ width: `${heroProgress?.pct ?? 0}%` }}
                />
              )}
            </div>
            {heroProgress?.overtimeMs != null && (
              <p className="mt-2 text-sm font-black text-race-red">
                +{fmtElapsedMs(heroProgress.overtimeMs)} over best time
              </p>
            )}
          </div>
        ) : (
          /* Compact rows for 2+ runners */
          <div>
            {runningEntries.map((runner) => (
              <AnnouncerRunnerRow key={runner.bib} runner={runner} fastestMs={fastestMs} />
            ))}
          </div>
        )}
      </section>

      {/* Results table */}
      <div className="overflow-hidden border-2 border-white/20">
        <table className="w-full table-fixed border-collapse text-white">
          <thead className="sticky top-0">
            <tr className="bg-black text-left text-xs font-black uppercase tracking-[0.14em] text-white/60">
              <th className="w-16 py-3 text-center">Pos</th>
              <th className="w-20 border-l border-white/20 py-3 text-center">Bib</th>
              <th className="border-l border-white/20 px-4 py-3">Rider</th>
              <th className="w-28 border-l border-white/20 py-3 text-center">Time</th>
              <th className="w-24 border-l border-white/20 py-3 pr-4 text-right">Gap</th>
            </tr>
          </thead>
          <tbody>
            {finishedResults.map((row, index) => {
              const isLeader = row.position === 1;
              return (
                <tr
                  key={row.bib}
                  className={classNames(
                    "border-t border-white/10",
                    isLeader
                      ? "bg-race-yellow text-race-ink"
                      : index % 2 === 0
                        ? "bg-white/5"
                        : "bg-transparent"
                  )}
                >
                  <td className="py-4 text-center text-2xl font-black tabular-nums">
                    {row.position ?? "—"}
                  </td>
                  <td className="border-l border-white/10 py-4 text-center">
                    <span
                      className={classNames(
                        "inline-flex min-w-12 justify-center px-2 py-1 text-xl font-black tabular-nums",
                        isLeader ? "bg-race-ink text-race-yellow" : "bg-white/10 text-white"
                      )}
                    >
                      {row.bib}
                    </span>
                  </td>
                  <td className="border-l border-white/10 px-4 py-4">
                    <p className="truncate text-xl font-black uppercase">{row.name}</p>
                    {row.team && (
                      <p className="text-sm font-bold uppercase text-white/50">{row.team}</p>
                    )}
                    {row.phase === "needs-review" && (
                      <span className="inline-flex px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] bg-white/20">
                        Review
                      </span>
                    )}
                  </td>
                  <td className="border-l border-white/10 py-4 text-center text-xl font-black tabular-nums">
                    {row.elapsedMs != null ? fmtElapsedMs(row.elapsedMs) : "—"}
                  </td>
                  <td className="border-l border-white/10 py-4 pr-4 text-right text-xl font-black tabular-nums">
                    {row.gapText || "—"}
                  </td>
                </tr>
              );
            })}
            {dnsRows.map((row) => (
              <tr key={row.bib} className="border-t border-white/10 bg-transparent opacity-60">
                <td className="py-4 text-center text-lg font-black uppercase text-white/50">
                  {STATUS_LABEL[row.status] ?? row.status}
                </td>
                <td className="border-l border-white/10 py-4 text-center">
                  <span className="inline-flex min-w-12 justify-center bg-white/10 px-2 py-1 text-xl font-black tabular-nums text-white">
                    {row.bib}
                  </span>
                </td>
                <td className="border-l border-white/10 px-4 py-4 text-xl font-black uppercase">
                  {row.name}
                </td>
                <td className="border-l border-white/10 py-4 text-center text-xl font-black tabular-nums">
                  —
                </td>
                <td className="border-l border-white/10 py-4 pr-4 text-right text-xl font-black tabular-nums">
                  —
                </td>
              </tr>
            ))}
            {finishedResults.length === 0 && dnsRows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="py-8 text-center text-base font-bold uppercase text-white/40"
                >
                  No results yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Up Next */}
      {queue.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-white/50">
            Up next
          </p>
          <ol className="divide-y-2 divide-white/10 border-y-2 border-white/10">
            {queue.slice(0, 5).map((r) => (
              <li key={r.bib} className="flex items-center gap-4 py-2">
                <span className="inline-flex min-w-12 justify-center bg-white/10 px-2 py-1 text-lg font-black tabular-nums text-white">
                  {r.bib}
                </span>
                <span className="min-w-0 flex-1 truncate text-lg font-black uppercase text-white">
                  {r.name}
                </span>
              </li>
            ))}
          </ol>
          {queue.length > 5 && (
            <p className="mt-2 text-xs font-bold uppercase text-white/40">
              +{queue.length - 5} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AnnouncerView({ raceId }: { raceId: string }) {
  const { race, entries, crossings, penalties, loading } = useRaceData(raceId);
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
    () => computeStandings(scopedCrossings, scopedEntries, raceStartMs, penalties),
    [scopedCrossings, scopedEntries, raceStartMs, penalties]
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

      {race.is_time_trial ? (
        <TimeTrialAnnouncer entries={entries} crossings={crossings} />
      ) : (
        <>
          <CategoryTabs categories={categories} category={category} onChange={setCategory} />
          {mode === "announcer" ? <AnnouncerBody standings={standings} recent={recent} now={now} /> : <TvBody standings={standings} />}
          {race.is_points_race && <PointsOverlay race={race} crossings={scopedCrossings} entries={scopedEntries} />}
        </>
      )}

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
