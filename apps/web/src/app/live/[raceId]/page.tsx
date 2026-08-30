"use client";

import React, { use, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MagnifyingGlassIcon } from "@heroicons/react/20/solid";
import { useRaceData } from "@/lib/useRaceData";
import { computePodiums, computeStandings, filterByCategory, fmtLapTime, getCategories, isPenalized, type StandingRow } from "@/lib/standings";
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
import { RaceNav } from "@/components/RaceNav";
import type { Crossing, Entry, EntryPenalty, Race } from "@/lib/types";

function classNames(...classes: (string | false)[]) {
  return classes.filter(Boolean).join(" ");
}

const STATUS_LABEL: Record<string, string> = { dns: "DNS", dnf: "DNF", dsq: "DSQ" };

/**
 * Classification section kicker + footer copy, driven by publish state
 * (#72). A race is "unofficial" (live, still subject to change) until an
 * organizer deliberately publishes it via /score/[raceId]/finalize; after
 * that it reads as final. Reopening a published race clears the publish
 * timestamp and flags results as under revision until re-published — see
 * docs/adr/0018-race-result-finalization.md.
 */
function classificationCopy(race: Race): { kicker: string; footer: string } {
  if (race.results_under_revision) {
    return { kicker: "Results under revision", footer: "Results under revision · Being corrected by the organizer" };
  }
  if (race.results_published_at) {
    const when = new Date(race.results_published_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    return { kicker: "Final classification", footer: `Final classification · Published ${when}` };
  }
  return { kicker: "Unofficial live standings", footer: "Live unofficial classification · Updates automatically" };
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") return null;
  return (
    <span
      className={classNames(
        "inline-flex px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-white",
        status === "dsq" ? "bg-race-red" : "bg-race-muted"
      )}
    >
      {STATUS_LABEL[status] ?? status}
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
  return <span className="tabular-nums">{hours > 0 ? `${hours}:` : ""}{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</span>;
}

/** Tooltip text summarizing every penalty/adjustment applied to a row. */
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
    <span
      title={penaltyTooltip(row)}
      className="ml-1 inline-flex cursor-help px-1 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-white bg-race-red"
    >
      Penalty
    </span>
  );
}

/**
 * Cumulative points-race leaderboard, plus a sprint-lap banner + that
 * sprint's own mini-result that surfaces for as long as the field is on the
 * sprint lap, then folds back into the leaderboard once anyone crosses to
 * the next lap — driven by live crossings rather than a timer.
 */
function PointsClassification({ race, crossings, entries }: { race: Race; crossings: Crossing[]; entries: Entry[] }) {
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
    <div className="mx-auto max-w-4xl px-4 pt-7 sm:px-6">
      {activeSprint && (
        <div className={classNames("border-2 border-race-ink px-4 py-3", activeSprint.isFinal ? "bg-race-red text-white" : "bg-race-yellow text-race-ink")}>
          <p className="text-xs font-black uppercase tracking-[0.2em]">
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

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-b-2 border-race-ink pb-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-race-red">Sprint points overlay</p>
          <h2 className="mt-1 text-2xl font-black uppercase tracking-tight">Points classification</h2>
        </div>
        <p className="text-xs font-black uppercase tracking-[0.1em] text-race-muted">{nextSprintText}</p>
      </div>

      <div className="mt-4 overflow-hidden border-b-2 border-race-ink">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="bg-race-ink text-left text-[10px] font-black uppercase tracking-[0.14em] text-white">
              <th className="w-12 py-2 text-center sm:w-16">Rank</th>
              <th className="w-14 border-l border-white/20 py-2 text-center sm:w-16">Bib</th>
              <th className="border-l border-white/20 px-3 py-2">Rider</th>
              <th className="w-16 border-l border-white/20 py-2 text-center">Points</th>
              <th className="w-12 border-l border-white/20 py-2 text-center">Laps</th>
            </tr>
          </thead>
          <tbody>
            {pointsStandings.map((row, index) => {
              const isLeader = row.position === 1;
              const statused = row.status !== "ok";
              return (
                <tr
                  key={row.bib}
                  className={classNames("border-t border-race-line", isLeader ? "bg-race-yellow" : index % 2 === 0 ? "bg-white" : "bg-race-panel-alt", statused && "opacity-70")}
                  style={isLeader ? { boxShadow: "var(--race-leader-shadow)" } : undefined}
                >
                  <td className={classNames("py-3 text-center text-lg font-black race-numeral", isLeader ? "bg-race-ink text-race-yellow race-angle-cut" : "text-race-muted")}>
                    {statused ? <StatusBadge status={row.status} /> : row.position ?? "—"}
                  </td>
                  <td className="border-l border-race-line py-3 text-center"><span className="race-numeral inline-flex min-w-8 justify-center bg-race-ink px-1.5 py-1 text-sm font-black text-white">{row.bib}</span></td>
                  <td className="border-l border-race-line px-3 py-3"><p className="truncate text-sm font-black uppercase sm:text-base">{row.name}</p><p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-race-muted">{row.team ?? (row.isUnknownBib ? "Unregistered rider" : "Independent")}</p></td>
                  <td className="race-numeral border-l border-race-line py-3 text-center text-base font-black">{row.points}</td>
                  <td className="race-numeral border-l border-race-line py-3 text-center text-base font-black">{row.laps}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

/** Per-runner card on the live spectator board with its own timer. */
function LiveRunnerCard({
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
    <div className="flex items-center gap-3 border-t border-race-line px-4 py-3">
      <span className="inline-flex min-w-10 justify-center bg-race-ink px-2 py-1 text-sm font-black tabular-nums text-white">
        #{runner.bib}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black uppercase">{runner.name}</p>
        {runner.team && (
          <p className="text-xs font-bold uppercase text-race-muted">{runner.team}</p>
        )}
        <div className="mt-1 h-2 w-full bg-race-panel-alt">
        {progress.indeterminate ? (
          <div className="h-2 w-full animate-pulse bg-race-yellow" />
        ) : (
          <div
            className={`h-2 transition-all ${progress.overtimeMs != null ? "bg-race-red" : "bg-race-yellow"}`}
            style={{ width: `${progress.pct}%` }}
          />
        )}
        </div>
        {progress.overtimeMs != null && (
          <p className="text-[10px] font-black text-race-red">+{fmtElapsedMs(progress.overtimeMs)} over best</p>
        )}
      </div>
      <span className="ml-auto shrink-0 text-lg font-black tabular-nums text-race-red">
        {fmtElapsedMs(elapsedMs)}
      </span>
    </div>
  );
}

function computeRunningEntries(crossings: Crossing[], entries: Entry[]): TimeTrialRow[] {
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

function TimeTrialBoard({
  race,
  entries,
  crossings,
}: {
  race: Race;
  entries: Entry[];
  crossings: Crossing[];
}) {
  const queue = useMemo(() => computeTimeTrialQueue(crossings, entries), [crossings, entries]);
  const results = useMemo(() => computeTimeTrialResults(crossings, entries), [crossings, entries]);

  const runningEntries: TimeTrialRow[] = useMemo(
    () => computeRunningEntries(crossings, entries),
    [crossings, entries]
  );

  const fastestMs: number | null = useMemo(() => {
    const finished = results.filter((r) => r.phase === "finished" && r.elapsedMs != null);
    return finished.length > 0 ? Math.min(...finished.map((r) => r.elapsedMs!)) : null;
  }, [results]);

  // Single hero runner (used when exactly 1 runner is on course)
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

  // How many finished riders are currently faster → projectedPosition = that count + 1
  const projectedPosition: number | null = singleRunner
    ? results.filter(
        (r) => r.phase === "finished" && r.elapsedMs != null && r.elapsedMs < heroElapsedMs
      ).length + 1
    : null;
  const showRank = results.some((r) => r.phase === "finished");

  const finishedResults = results.filter(
    (r) => (r.phase === "finished" || r.phase === "needs-review") && r.status === "ok"
  );
  const dnsRows = results.filter((r) => r.status !== "ok");

  return (
    <div className="mx-auto max-w-4xl px-4 pt-7 sm:px-6">
      {/* Now Running section — hidden once the race is finished */}
      {race.status !== "finished" && (
          <div className="mb-6 border-4 border-race-ink bg-white">
          <div className="border-b-2 border-race-ink bg-race-ink px-4 py-2">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-race-yellow">
              Now on course{runningEntries.length > 1 ? ` (${runningEntries.length})` : ""}
            </p>
          </div>
          {runningEntries.length === 0 ? (
            <p className="px-4 py-5 text-sm font-black uppercase text-race-muted">
              Waiting for next rider
            </p>
          ) : runningEntries.length === 1 && singleRunner ? (
            /* Hero layout for a single runner */
            <div className="p-4">
              <div className="flex items-baseline gap-3">
                <span className="inline-flex min-w-10 justify-center bg-race-ink px-2 py-1 text-xl font-black tabular-nums text-white">
                  #{singleRunner.bib}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xl font-black uppercase">{singleRunner.name}</p>
                  {singleRunner.team && (
                    <p className="text-xs font-bold uppercase text-race-muted">{singleRunner.team}</p>
                  )}
                </div>
                <span className="ml-auto flex items-baseline gap-2">
                  <span className="text-3xl font-black tabular-nums text-race-red">
                    {fmtElapsedMs(heroElapsedMs)}
                  </span>
                  {showRank && projectedPosition != null && (
                    <span
                      className={`inline-block px-2 py-0.5 text-xs font-black tabular-nums ${projectedPosition === 1 ? "bg-race-yellow text-race-ink" : "bg-race-panel-alt text-race-ink"}`}
                    >
                      P{projectedPosition}
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-3 h-3 w-full bg-race-line">
                {heroProgress?.indeterminate ? (
                  <div className="h-3 w-full animate-pulse bg-race-yellow" />
                ) : (
                  <div
                    className={`h-3 transition-all ${heroProgress?.overtimeMs != null ? "bg-race-red" : "bg-race-yellow"}`}
                    style={{ width: `${heroProgress?.pct ?? 0}%` }}
                  />
                )}
              </div>
              {heroProgress?.overtimeMs != null && (
                <p className="mt-1 text-xs font-black text-race-red">
                  +{fmtElapsedMs(heroProgress.overtimeMs)} over best
                </p>
              )}
            </div>
          ) : (
            /* Compact rows for 2+ runners */
            <div>
              {runningEntries.map((runner) => (
                <LiveRunnerCard key={runner.bib} runner={runner} fastestMs={fastestMs} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Up Next */}
      {queue.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-race-muted">
            Up next
          </p>
          <ol className="divide-y divide-race-line border-y-2 border-race-ink">
            {queue.slice(0, 5).map((r) => (
              <li key={r.bib} className="flex items-center gap-3 bg-race-paper px-3 py-2">
                <span className="inline-flex min-w-8 justify-center bg-race-ink px-1.5 py-1 text-sm font-black tabular-nums text-white">
                  {r.bib}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-black uppercase text-race-ink">
                  {r.name}
                </span>
              </li>
            ))}
          </ol>
          {queue.length > 5 && (
            <p className="mt-2 text-xs font-bold uppercase text-race-muted">
              +{queue.length - 5} more
            </p>
          )}
        </div>
      )}

      {/* Results table */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-race-ink pb-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-race-red">
            Live ranking by time
          </p>
          <h2 className="mt-1 text-2xl font-black uppercase tracking-tight">Classification</h2>
        </div>
      </div>
      <div className="overflow-hidden border-b-2 border-race-ink">
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="bg-race-ink text-left text-[10px] font-black uppercase tracking-[0.14em] text-white">
              <th className="w-12 py-2 text-center sm:w-16">Pos</th>
              <th className="w-14 border-l border-white/20 py-2 text-center sm:w-16">Bib</th>
              <th className="border-l border-white/20 px-3 py-2">Rider</th>
              <th className="w-24 border-l border-white/20 py-2 text-center sm:w-28">Time</th>
              <th className="w-20 border-l border-white/20 py-2 pr-2 text-right sm:w-24">Gap</th>
            </tr>
          </thead>
          <tbody>
            {finishedResults.map((row, index) => {
              const isLeader = row.position === 1;
              return (
                <tr
                  key={row.bib}
                  className={classNames(
                    "border-t border-race-line",
                    isLeader ? "bg-race-yellow" : index % 2 === 0 ? "bg-white" : "bg-race-panel-alt"
                  )}
                  style={isLeader ? { boxShadow: "var(--race-leader-shadow)" } : undefined}
                >
                  <td
                    className={classNames(
                      "py-3 text-center text-lg font-black race-numeral",
                      isLeader ? "bg-race-ink text-race-yellow race-angle-cut" : "text-race-muted"
                    )}
                  >
                    {row.position ?? "—"}
                  </td>
                  <td className="border-l border-race-line py-3 text-center">
                    <span className="race-numeral inline-flex min-w-8 justify-center bg-race-ink px-1.5 py-1 text-sm font-black text-white">
                      {row.bib}
                    </span>
                  </td>
                  <td className="border-l border-race-line px-3 py-3">
                    <p className="truncate text-sm font-black uppercase sm:text-base">{row.name}</p>
                    {row.team && (
                      <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-race-muted">
                        {row.team}
                      </p>
                    )}
                    {row.phase === "needs-review" && (
                      <span className="mt-0.5 inline-flex px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-white bg-race-muted">
                        Review
                      </span>
                    )}
                  </td>
                  <td className="race-numeral border-l border-race-line py-3 text-center text-sm font-bold">
                    {row.elapsedMs != null ? fmtElapsedMs(row.elapsedMs) : "—"}
                  </td>
                  <td className="race-numeral border-l border-race-line py-3 pr-2 text-right text-sm font-black">
                    {row.gapText || "—"}
                  </td>
                </tr>
              );
            })}
            {dnsRows.map((row) => (
              <tr key={row.bib} className="border-t border-race-line bg-white opacity-70">
                <td className="py-3 text-center">
                  <StatusBadge status={row.status} />
                </td>
                <td className="border-l border-race-line py-3 text-center">
                  <span className="inline-flex min-w-8 justify-center bg-race-ink px-1.5 py-1 text-sm font-black tabular-nums text-white">
                    {row.bib}
                  </span>
                </td>
                <td className="border-l border-race-line px-3 py-3">
                  <p className="truncate text-sm font-black uppercase sm:text-base">{row.name}</p>
                  {row.team && (
                    <p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-race-muted">
                      {row.team}
                    </p>
                  )}
                </td>
                <td className="border-l border-race-line py-3 text-center text-sm font-bold tabular-nums">
                  —
                </td>
                <td className="border-l border-race-line py-3 pr-2 text-right text-sm font-black tabular-nums">
                  —
                </td>
              </tr>
            ))}
            {finishedResults.length === 0 && dnsRows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="py-8 text-center text-sm font-bold uppercase text-race-muted"
                >
                  No finishers yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-race-muted">
        {classificationCopy(race).footer} ·{" "}
        <Link href={`/announce/${race.id}`} className="underline hover:text-race-ink">
          Announcer / TV view
        </Link>
      </p>
    </div>
  );
}

export default function LiveBoard({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = use(params);
  const { race, entries, crossings, penalties, loading } = useRaceData(raceId);
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
    () => computeStandings(scopedCrossings, scopedEntries, raceStartMs, penalties),
    [scopedCrossings, scopedEntries, raceStartMs, penalties]
  );
  const podiums = useMemo(
    () => (showPodium ? computePodiums(crossings, entries, raceStartMs, categories, penalties) : []),
    [showPodium, crossings, entries, raceStartMs, categories, penalties]
  );
  const leader = standings[0];
  const leaderLaps = leader?.laps ?? 0;
  const lapsToGo = race?.laps_planned == null ? null : Math.max(race.laps_planned - leaderLaps, 0);
  const q = query.trim().toLowerCase();
  const matches = (row: (typeof standings)[number]) => q !== "" && (row.bib === q || row.name.toLowerCase().includes(q));

  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());
  // Tracks the previous numerical rank (position) of each bib so we can
  // detect whether a row moved up or down between standings updates.
  const prevRanksRef = useRef<Map<string, number>>(new Map());
  // Tracks which bib held P1 on the previous render; null on first render
  // so we never fire a spurious leader-change transition on load.
  const prevLeaderBibRef = useRef<string | null>(null);

  // FLIP animation: whenever the standings order changes, smoothly slide each
  // row from its previous position to its new position instead of snapping.
  // Also applies rank-change flash (up = improved, down = dropped) and a
  // distinct leader-change transition when P1 passes to a different rider.
  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    rowRefs.current.forEach((el, bib) => {
      nextRects.set(bib, el.getBoundingClientRect());
    });

    // Build the current rank map from standings (only ranked, on-lap rows).
    const nextRanks = new Map<string, number>();
    standings.forEach((row) => {
      if (row.position != null && row.laps > 0) nextRanks.set(row.bib, row.position);
    });

    // Identify current leader bib.
    const nextLeaderBib = standings.find((row) => row.position === 1 && row.laps > 0)?.bib ?? null;

    rowRefs.current.forEach((el, bib) => {
      const prevRect = prevRectsRef.current.get(bib);
      const nextRect = nextRects.get(bib);

      // ── FLIP slide ──────────────────────────────────────────────────────
      if (prevRect && nextRect) {
        const deltaY = prevRect.top - nextRect.top;
        if (Math.abs(deltaY) >= 1) {
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
        }
      }

      // ── Rank-change flash ────────────────────────────────────────────────
      const oldRank = prevRanksRef.current.get(bib);
      const newRank = nextRanks.get(bib);
      if (oldRank != null && newRank != null && oldRank !== newRank) {
        requestAnimationFrame(() => {
          // Remove any in-flight flash first, then force reflow to restart.
          el.classList.remove("race-rank-flash-up", "race-rank-flash-down");
          void el.offsetWidth;
          el.classList.add(newRank < oldRank ? "race-rank-flash-up" : "race-rank-flash-down");
          setTimeout(() => {
            el.classList.remove("race-rank-flash-up", "race-rank-flash-down");
          }, 300); // 280 ms duration + small buffer
        });
      }
    });

    // ── Leader-change transition ─────────────────────────────────────────
    // Only fire when a genuine rider-to-rider change occurs (not on first
    // render where prevLeaderBibRef is still null).
    if (
      nextLeaderBib != null &&
      prevLeaderBibRef.current != null &&
      nextLeaderBib !== prevLeaderBibRef.current
    ) {
      const leaderEl = rowRefs.current.get(nextLeaderBib);
      if (leaderEl) {
        requestAnimationFrame(() => {
          leaderEl.classList.remove("race-leader-change");
          void leaderEl.offsetWidth;
          leaderEl.classList.add("race-leader-change");
          setTimeout(() => {
            leaderEl.classList.remove("race-leader-change");
          }, 400); // 380 ms duration + small buffer
        });
      }
    }

    prevRectsRef.current = nextRects;
    prevRanksRef.current = nextRanks;
    prevLeaderBibRef.current = nextLeaderBib;
  }, [standings]);

  if (loading || !race) {
    return <main className="grid min-h-dvh place-items-center bg-race-paper font-sans text-sm font-bold uppercase tracking-widest text-race-muted">{loading ? "Loading classification" : "Race not found"}</main>;
  }

  return (
    <main className="min-h-dvh bg-race-paper pb-12 font-sans text-race-ink">
      <div className="race-topline" />
      <RaceNav links={[{ href: `/results/${race.event_id}`, label: "All event races" }]} />
      <header className="bg-race-ink px-4 py-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-race-yellow">SplitSync // live classification</p>
            <h1 className="mt-1 truncate text-xl font-black uppercase tracking-tight sm:text-2xl">{race.name}</h1>
          </div>
          <div className="shrink-0 border-l border-white/25 pl-4 text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-race-muted">Race time</p>
            <p className="mt-0.5 text-lg font-black tabular-nums">
              {race.status === "active" && race.started_at ? <RaceClock startedAt={race.started_at} /> : "—"}
            </p>
          </div>
        </div>
      </header>

      {race.results_under_revision && (
        <div className="border-b-4 border-race-ink bg-race-yellow px-4 py-2 text-center sm:px-6">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-race-ink">
            Results under revision · The organizer is correcting this race before republishing
          </p>
        </div>
      )}

      <section className="border-b-4 border-race-ink bg-white px-4 py-5 sm:px-6">
        <div className="mx-auto grid max-w-4xl grid-cols-[1.1fr_1fr_1fr] divide-x-2 divide-race-ink">
          <div className="pr-3 sm:pr-5">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-race-muted">Race status</p>
            {race.status === "active" ? (
              <div
                className="race-angle-cut mt-1 inline-flex items-center gap-1.5 bg-race-red px-2 py-1"
                style={{ boxShadow: "var(--race-live-shadow)" }}
              >
                <span className="race-live-pulse shrink-0" aria-hidden="true" />
                <span className="text-xs font-black uppercase tracking-[0.2em] text-white">Live</span>
              </div>
            ) : (
              <p className="mt-1 text-base font-black uppercase text-race-ink">{race.status}</p>
            )}
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

      {race.is_time_trial ? (
        <TimeTrialBoard race={race} entries={entries} crossings={crossings} />
      ) : (
        <>
          <div className="mx-auto max-w-4xl px-4 pt-7 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-race-ink pb-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-race-red">{classificationCopy(race).kicker}</p>
                <h2 className="mt-1 text-2xl font-black uppercase tracking-tight">Classification</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPodium((v) => !v)}
                  className={classNames(
                    "border-2 border-race-ink px-3 py-2 text-xs font-black uppercase tracking-[0.1em]",
                    showPodium ? "bg-race-ink text-white" : "bg-white text-race-ink hover:bg-race-panel-alt"
                  )}
                >
                  Podium
                </button>
                <div className="relative w-48 sm:w-60">
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find bib / rider" className="w-full border-2 border-race-ink bg-white py-2 pr-3 pl-9 text-sm font-bold outline-none placeholder:text-race-muted focus:border-race-red" />
                  <MagnifyingGlassIcon className="pointer-events-none absolute top-2.5 left-3 size-4 text-race-muted" />
                </div>
              </div>
            </div>

            {categories.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCategory(null)}
                  className={classNames(
                    "border-2 border-race-ink px-3 py-1.5 text-xs font-black uppercase tracking-[0.08em]",
                    category === null ? "bg-race-ink text-white" : "bg-white text-race-ink hover:bg-race-panel-alt"
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
                      "border-2 border-race-ink px-3 py-1.5 text-xs font-black uppercase tracking-[0.08em]",
                      category === cat ? "bg-race-ink text-white" : "bg-white text-race-ink hover:bg-race-panel-alt"
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
                  <div key={cat} className="border-2 border-race-ink bg-white">
                    <p className="border-b-2 border-race-ink bg-race-ink px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] text-race-yellow">{cat}</p>
                    {rows.length === 0 ? (
                      <p className="px-3 py-3 text-xs font-bold uppercase tracking-wide text-race-muted">No finishers yet</p>
                    ) : (
                      <ol className="divide-y divide-race-line">
                        {rows.map((row) => (
                          <li key={row.bib} className="flex items-center gap-3 px-3 py-2">
                            <span className="w-5 shrink-0 text-lg font-black tabular-nums text-race-muted">{row.position}</span>
                            <span className="inline-flex min-w-8 shrink-0 justify-center bg-race-ink px-1.5 py-1 text-xs font-black tabular-nums text-white">{row.bib}</span>
                            <span className="min-w-0 flex-1 truncate text-sm font-black uppercase">{row.name}<PenaltyBadge row={row} /></span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-hidden border-b-2 border-race-ink">
              <table className="w-full table-fixed border-collapse">
                <thead>
                  <tr className="bg-race-ink text-left text-[10px] font-black uppercase tracking-[0.14em] text-white">
                    <th className="w-12 py-2 text-center sm:w-16">Rank</th>
                    <th className="w-14 border-l border-white/20 py-2 text-center sm:w-16">Bib</th>
                    <th className="border-l border-white/20 px-3 py-2">Rider</th>
                    <th className="w-12 border-l border-white/20 py-2 text-center sm:w-16">Laps</th>
                    <th className="hidden w-20 border-l border-white/20 py-2 text-center sm:table-cell">Last lap</th>
                    <th className="w-20 border-l border-white/20 py-2 pr-2 text-right sm:w-28">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row, index) => {
                    const hit = matches(row);
                    const isLeader = row.position === 1 && row.laps > 0;
                    const podium = row.position != null && row.position > 1 && row.position <= 3 && row.laps > 0;
                    const statused = row.status !== "ok";
                    return (
                      <tr
                        key={row.bib}
                        ref={(el) => {
                          if (el) rowRefs.current.set(row.bib, el);
                          else rowRefs.current.delete(row.bib);
                        }}
                        className={classNames("relative border-t border-race-line transition-opacity", isLeader ? "bg-race-yellow" : index % 2 === 0 ? "bg-white" : "bg-race-panel-alt", hit && !isLeader && "bg-race-red-tint ring-2 ring-inset ring-race-red", !hit && q !== "" && "opacity-35", statused && "opacity-70")}
                        style={isLeader ? { boxShadow: "var(--race-leader-shadow)" } : undefined}
                      >
                        <td className={classNames("py-3 text-center text-lg font-black race-numeral", isLeader ? "bg-race-ink text-race-yellow race-angle-cut" : podium ? "text-race-red" : "text-race-muted")}>
                          {statused ? <StatusBadge status={row.status} /> : row.laps > 0 ? row.position : "—"}
                        </td>
                        <td className="border-l border-race-line py-3 text-center"><span className="race-numeral inline-flex min-w-8 justify-center bg-race-ink px-1.5 py-1 text-sm font-black text-white">{row.bib}</span></td>
                        <td className="border-l border-race-line px-3 py-3"><p className="truncate text-sm font-black uppercase sm:text-base">{row.name}<PenaltyBadge row={row} /></p><p className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-race-muted">{row.team ?? (row.isUnknownBib ? "Unregistered rider" : "Independent")}</p></td>
                        <td className="race-numeral border-l border-race-line py-3 text-center text-base font-black">{row.laps}</td>
                        <td className="race-numeral hidden border-l border-race-line py-3 text-center text-sm font-bold sm:table-cell">{fmtLapTime(row.lastLapMs)}</td>
                        <td className={classNames("race-numeral border-l border-race-line py-3 pr-2 text-right text-sm font-black", row.gapText.startsWith("-") ? "text-race-red" : "text-race-ink")}>
                          {statused ? "" : isLeader ? "Leader" : row.gapText}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-race-muted">
              {classificationCopy(race).footer} ·{" "}
              <Link href={`/announce/${raceId}`} className="underline hover:text-race-ink">
                Announcer / TV view
              </Link>
            </p>
          </div>

          {race.is_points_race && <PointsClassification race={race} crossings={scopedCrossings} entries={scopedEntries} />}
        </>
      )}
    </main>
  );
}
