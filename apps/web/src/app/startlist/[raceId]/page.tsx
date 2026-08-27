"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRaceData } from "@/lib/useRaceData";
import { useAuth } from "@/lib/useAuth";
import { useEventAccess } from "@/lib/useEventAccess";
import { RaceNav } from "@/components/RaceNav";
import type { Participant } from "@/lib/types";

type SortBy = "bib" | "category";

export default function StartList({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = use(params);
  const { race, entries, loading } = useRaceData(raceId);
  const { user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading } = useEventAccess(race?.event_id, user);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [sortBy, setSortBy] = useState<SortBy>("bib");
  const [checkedInOnly, setCheckedInOnly] = useState(false);

  const refetchParticipants = useCallback(async () => {
    if (!race) return;
    const { data } = await supabase.from("participants").select("*").eq("event_id", race.event_id);
    if (data) setParticipants(data);
  }, [race]);

  useEffect(() => {
    refetchParticipants();
  }, [refetchParticipants]);

  const checkedInByBib = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const p of participants) m.set(p.bib, p.checked_in_at);
    return m;
  }, [participants]);

  const rows = useMemo(() => {
    let list = entries.map((entry) => ({ ...entry, checked_in_at: checkedInByBib.get(entry.bib) ?? null }));
    if (checkedInOnly) list = list.filter((entry) => entry.checked_in_at);
    list = [...list].sort((a, b) => {
      if (sortBy === "category") {
        const catCompare = (a.category ?? "").localeCompare(b.category ?? "");
        if (catCompare !== 0) return catCompare;
      }
      return a.bib.localeCompare(b.bib, undefined, { numeric: true });
    });
    return list;
  }, [entries, checkedInByBib, checkedInOnly, sortBy]);

  const checkedInCount = entries.filter((entry) => checkedInByBib.get(entry.bib)).length;

  if (loading || authLoading || roleLoading || !race) {
    return (
      <main className="race-page flex items-center justify-center text-race-muted">
        {loading ? "Loading…" : "Race not found"}
      </main>
    );
  }

  if (!user || !role) {
    return (
      <main className="race-page">
        <div className="race-topline--muted" />
        <div className="mx-auto max-w-lg px-4 py-16">
          <div className="race-panel p-5">
            <p className="race-kicker--muted">Start list access</p>
            <h1 className="mt-1 text-2xl font-black uppercase">Sign-in required</h1>
            <p className="mt-3 text-sm text-race-muted">Only the event owner or an invited volunteer can view this race&apos;s start list. Ask the organizer for an invite link.</p>
            <Link href="/login" className="race-action--muted mt-5 inline-block">Sign in</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="race-page">
      <div className="race-topline--muted no-print" />
      <div className="no-print">
        <RaceNav links={[{ href: `/event/${race.event_id}`, label: "Event setup" }, { href: `/score/${raceId}`, label: "Score" }]} showAuth />
      </div>
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <header className="race-section-heading flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="race-kicker--muted">Start list</p>
            <h1 className="text-xl font-black uppercase">{race.name}</h1>
          </div>
          <span className="text-sm font-bold text-race-muted">{checkedInCount} / {entries.length} checked in</span>
        </header>

        <div className="no-print mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-black uppercase tracking-wide">
              <input type="checkbox" checked={checkedInOnly} onChange={(e) => setCheckedInOnly(e.target.checked)} className="size-4" />
              Checked-in only
            </label>
            <label className="flex items-center gap-2 text-xs font-black uppercase tracking-wide">
              Sort by
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="race-input--muted !w-auto">
                <option value="bib">Bib</option>
                <option value="category">Category</option>
              </select>
            </label>
          </div>
          <button onClick={() => window.print()} className="race-action--muted">Print</button>
        </div>

        {rows.length === 0 && <p className="mt-6 text-sm text-race-muted">No entries match this view.</p>}

        {rows.length > 0 && (
          <div className="mt-4 overflow-hidden border-t-2 border-race-ink">
            <table className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-300 text-left text-[10px] font-black uppercase tracking-wide text-race-muted">
                  <th className="w-14 py-2">Bib</th>
                  <th className="py-2">Name</th>
                  <th className="w-28 py-2">Team</th>
                  <th className="w-24 py-2">Category</th>
                  <th className="w-28 py-2">Check-in</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id} className="border-b border-zinc-200 even:bg-race-panel-alt">
                    <td className="py-2 font-black tabular-nums">#{entry.bib}</td>
                    <td className="truncate py-2 font-bold">{entry.name}</td>
                    <td className="truncate py-2 text-race-muted">{entry.team ?? "—"}</td>
                    <td className="truncate py-2 text-race-muted">{entry.category ?? "—"}</td>
                    <td className="py-2">
                      {entry.checked_in_at ? (
                        <span className="bg-race-yellow px-2 py-0.5 text-xs font-black uppercase text-race-ink">Checked in</span>
                      ) : (
                        <span className="bg-race-panel-alt px-2 py-0.5 text-xs font-black uppercase text-race-muted">Not in</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
