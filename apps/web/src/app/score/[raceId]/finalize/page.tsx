"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRaceData } from "@/lib/useRaceData";
import { useAuth } from "@/lib/useAuth";
import { canManageEvent, useEventAccess } from "@/lib/useEventAccess";
import { RaceNav } from "@/components/RaceNav";
import {
  computePodiums,
  computeStandings,
  flagSuspiciousGaps,
  getCategories,
  getRidersWithoutCrossings,
} from "@/lib/standings";
import { computeTimeTrialResults } from "@/lib/timeTrial";

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default function FinalizeRace({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = use(params);
  const { race, entries, crossings, penalties, loading, refetch } = useRaceData(raceId);
  const { user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading } = useEventAccess(race?.event_id, user);
  const canPublish = canManageEvent(role);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const raceStartMs = race?.started_at ? new Date(race.started_at).getTime() : null;
  const categories = useMemo(() => getCategories(entries), [entries]);

  const standings = useMemo(
    () => computeStandings(crossings, entries, raceStartMs, penalties),
    [crossings, entries, raceStartMs, penalties]
  );
  const noCrossingRiders = useMemo(() => getRidersWithoutCrossings(standings), [standings]);
  const suspiciousGapRiders = useMemo(() => flagSuspiciousGaps(standings), [standings]);
  const podiums = useMemo(
    () => computePodiums(crossings, entries, raceStartMs, categories, penalties),
    [crossings, entries, raceStartMs, categories, penalties]
  );

  const timeTrialResults = useMemo(
    () => (race?.is_time_trial ? computeTimeTrialResults(crossings, entries) : []),
    [race?.is_time_trial, crossings, entries]
  );
  const needsReviewRiders = useMemo(
    () => timeTrialResults.filter((r) => r.phase === "needs-review"),
    [timeTrialResults]
  );
  const stillOnCourseRiders = useMemo(
    () => timeTrialResults.filter((r) => r.status === "ok" && (r.phase === "queued" || r.phase === "running")),
    [timeTrialResults]
  );

  const unresolvedStatusEntries = useMemo(
    () => entries.filter((e) => e.status !== "ok" && !e.status_reason),
    [entries]
  );
  const penalizedEntryIds = useMemo(() => new Set(penalties.map((p) => p.entry_id)), [penalties]);
  const penalizedEntries = useMemo(
    () => entries.filter((e) => penalizedEntryIds.has(e.id)),
    [entries, penalizedEntryIds]
  );

  const publish = async () => {
    setError(null);
    setPublishing(true);
    const { error: rpcError } = await supabase.rpc("finalize_and_publish_race", { p_race_id: raceId });
    setPublishing(false);
    if (rpcError) return setError(rpcError.message);
    refetch();
  };

  if (loading || authLoading || roleLoading || !race) {
    return (
      <main className="race-page flex items-center justify-center text-race-muted">
        {loading ? "Loading…" : "Race not found"}
      </main>
    );
  }

  // Anyone with any accepted role on this event can review the checklist —
  // same posture as the scorer page. Only owner/organizer can actually
  // publish (gated below and re-checked by the RPC itself).
  if (!user || role == null) {
    return (
      <main className="race-page">
        <div className="race-topline--muted" />
        <div className="mx-auto max-w-lg px-4 py-16">
          <div className="race-panel p-5">
            <p className="race-kicker--muted">Finalize race</p>
            <h1 className="mt-1 text-2xl font-black uppercase">Sign-in required</h1>
            <p className="mt-3 text-sm text-race-muted">
              Only the event owner or an invited organizer/scorer/official can review this race&apos;s results.
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(`/score/${raceId}/finalize`)}`}
              className="race-action--muted mt-5 inline-block"
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (race.status !== "finished") {
    return (
      <main className="race-page">
        <div className="race-topline--muted" />
        <RaceNav links={[{ href: `/score/${raceId}`, label: "Back to scorer" }]} showAuth />
        <div className="mx-auto max-w-lg px-4 py-16">
          <div className="race-panel p-5">
            <p className="race-kicker--muted">Finalize race</p>
            <h1 className="mt-1 text-2xl font-black uppercase">Not finished yet</h1>
            <p className="mt-3 text-sm text-race-muted">
              This race must be finished before it can be reviewed and published.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const clean =
    noCrossingRiders.length === 0 &&
    suspiciousGapRiders.length === 0 &&
    unresolvedStatusEntries.length === 0 &&
    needsReviewRiders.length === 0 &&
    stillOnCourseRiders.length === 0;

  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <RaceNav links={[{ href: `/score/${raceId}`, label: "Back to scorer" }, { href: `/live/${raceId}`, label: "Live board" }]} showAuth />
      <div className="mx-auto max-w-2xl px-4 py-8">
        <p className="race-kicker--muted">Result finalization</p>
        <h1 className="mt-1 text-2xl font-black uppercase">{race.name}</h1>
        <p className="mt-2 text-sm text-race-muted">
          Review this checklist before publishing. Publishing does not certify official timing — SplitSync results
          remain unofficial — it simply marks this race&apos;s classification as final for spectators.
        </p>

        {race.results_published_at && (
          <div className="race-panel mt-5 border-l-4 border-l-race-yellow p-4">
            <p className="text-sm font-black uppercase text-race-ink">Published {fmtWhen(race.results_published_at)}</p>
            <p className="mt-1 text-xs text-race-muted">
              Reopening this race will unpublish it and flag results as under revision until you publish again.
            </p>
          </div>
        )}

        <div className="mt-5 space-y-4">
          <ChecklistSection
            title="Riders with no crossings"
            ok={noCrossingRiders.length === 0}
            emptyText="Every entered rider has at least one recorded crossing."
          >
            <ul className="divide-y divide-race-line">
              {noCrossingRiders.map((r) => (
                <li key={r.bib} className="flex items-center gap-3 py-2 text-sm font-bold uppercase">
                  <span className="inline-flex min-w-8 justify-center bg-race-ink px-1.5 py-1 text-xs font-black text-white">{r.bib}</span>
                  {r.name}
                </li>
              ))}
            </ul>
          </ChecklistSection>

          {!race.is_time_trial && (
            <ChecklistSection
              title="Suspicious gaps"
              ok={suspiciousGapRiders.length === 0}
              emptyText="No rider's last lap looks unusually slow relative to the field."
            >
              <ul className="divide-y divide-race-line">
                {suspiciousGapRiders.map((r) => (
                  <li key={r.bib} className="flex items-center gap-3 py-2 text-sm font-bold uppercase">
                    <span className="inline-flex min-w-8 justify-center bg-race-ink px-1.5 py-1 text-xs font-black text-white">{r.bib}</span>
                    {r.name}
                    <span className="ml-auto text-xs text-race-muted">Last lap flagged as unusually slow</span>
                  </li>
                ))}
              </ul>
            </ChecklistSection>
          )}

          {race.is_time_trial && (
            <ChecklistSection
              title="Needs review (3+ crossings)"
              ok={needsReviewRiders.length === 0}
              emptyText="No rider has an ambiguous (3+) crossing count."
            >
              <ul className="divide-y divide-race-line">
                {needsReviewRiders.map((r) => (
                  <li key={r.bib} className="flex items-center gap-3 py-2 text-sm font-bold uppercase">
                    <span className="inline-flex min-w-8 justify-center bg-race-ink px-1.5 py-1 text-xs font-black text-white">{r.bib}</span>
                    {r.name}
                  </li>
                ))}
              </ul>
            </ChecklistSection>
          )}

          {race.is_time_trial && (
            <ChecklistSection
              title="Still on course / not yet started"
              ok={stillOnCourseRiders.length === 0}
              emptyText="Every rider has either finished or been marked DNS/DNF/DSQ."
            >
              <ul className="divide-y divide-race-line">
                {stillOnCourseRiders.map((r) => (
                  <li key={r.bib} className="flex items-center gap-3 py-2 text-sm font-bold uppercase">
                    <span className="inline-flex min-w-8 justify-center bg-race-ink px-1.5 py-1 text-xs font-black text-white">{r.bib}</span>
                    {r.name}
                    <span className="ml-auto text-xs text-race-muted">{r.phase}</span>
                  </li>
                ))}
              </ul>
            </ChecklistSection>
          )}

          <ChecklistSection
            title="Unresolved statuses"
            ok={unresolvedStatusEntries.length === 0}
            emptyText="Every DNS/DNF/DSQ rider has a recorded reason."
          >
            <ul className="divide-y divide-race-line">
              {unresolvedStatusEntries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2 text-sm font-bold uppercase">
                  <span className="inline-flex min-w-8 justify-center bg-race-ink px-1.5 py-1 text-xs font-black text-white">{e.bib}</span>
                  {e.name}
                  <span className="ml-auto text-xs text-race-muted">{e.status.toUpperCase()} — no reason recorded</span>
                </li>
              ))}
            </ul>
          </ChecklistSection>

          {penalizedEntries.length > 0 && (
            <div className="race-panel p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-race-muted">
                Penalties/adjustments applied ({penalizedEntries.length})
              </p>
              {race.is_time_trial && (
                <p className="mt-2 text-xs text-race-red">
                  This is a time-trial race — penalties are not yet applied to time-trial classification (see
                  #72&apos;s follow-up). Review these manually before publishing.
                </p>
              )}
              <ul className="mt-2 divide-y divide-race-line">
                {penalizedEntries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-2 text-sm font-bold uppercase">
                    <span className="inline-flex min-w-8 justify-center bg-race-ink px-1.5 py-1 text-xs font-black text-white">{e.bib}</span>
                    {e.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!race.is_time_trial && categories.length > 0 && (
            <div className="race-panel p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-race-muted">Category standings summary</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {podiums.map(({ category, rows }) => (
                  <div key={category} className="border-2 border-race-ink">
                    <p className="border-b-2 border-race-ink bg-race-ink px-2 py-1 text-xs font-black uppercase text-white">{category}</p>
                    {rows.length === 0 ? (
                      <p className="px-2 py-2 text-xs text-race-muted">No finishers yet</p>
                    ) : (
                      <ol className="divide-y divide-race-line">
                        {rows.map((r) => (
                          <li key={r.bib} className="flex items-center gap-2 px-2 py-1 text-xs font-bold uppercase">
                            <span>{r.position}.</span>
                            {r.name}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <p className="mt-4 text-sm font-bold text-race-ink">{error}</p>}

        <div className="mt-6 flex items-center gap-4">
          {canPublish ? (
            <button onClick={publish} disabled={publishing} className="race-action--muted race-action--yellow disabled:opacity-40">
              {publishing ? "Publishing…" : race.results_published_at ? "Republish results" : "Finalize & publish"}
            </button>
          ) : (
            <p className="text-sm text-race-muted">Only the event owner or an organizer can publish results.</p>
          )}
          <Link href={`/live/${raceId}`} className="text-sm font-black uppercase text-race-ink underline decoration-2 underline-offset-4">
            View live board
          </Link>
        </div>
        {!clean && (
          <p className="mt-3 text-xs text-race-muted">
            Publishing is still allowed with open checklist items above — SplitSync results are unofficial by design;
            this checklist is a sanity check, not a hard gate.
          </p>
        )}
      </div>
    </main>
  );
}

function ChecklistSection({
  title,
  ok,
  emptyText,
  children,
}: {
  title: string;
  ok: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="race-panel p-4">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-white ${ok ? "bg-race-muted" : "bg-[#ec1c24]"}`}
        >
          {ok ? "Clear" : "Review"}
        </span>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-race-muted">{title}</p>
      </div>
      {ok ? <p className="mt-2 text-xs text-race-muted">{emptyText}</p> : <div className="mt-2">{children}</div>}
    </div>
  );
}
