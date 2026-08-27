"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { Crossing, Entry, EntryPenalty, Race } from "./types";

/**
 * Loads race + entries + crossings + penalties and keeps them fresh via
 * Supabase Realtime. On any crossings/races/entries change we refetch —
 * simple and always consistent; at grassroots scale (hundreds of rows) this
 * is well within budget.
 */
export function useRaceData(raceId: string) {
  const [race, setRace] = useState<Race | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [crossings, setCrossings] = useState<Crossing[]>([]);
  const [deletedCrossings, setDeletedCrossings] = useState<Crossing[]>([]);
  const [penalties, setPenalties] = useState<EntryPenalty[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    const [raceRes, entriesRes, crossingsRes, deletedRes] = await Promise.all([
      supabase.from("races").select("*").eq("id", raceId).single(),
      supabase.from("entries").select("*").eq("race_id", raceId),
      supabase
        .from("crossings")
        .select("*")
        .eq("race_id", raceId)
        .is("deleted_at", null)
        .order("client_recorded_at", { ascending: true }),
      // Recently removed crossings, kept around so a mistaken "Undo" can be restored.
      supabase
        .from("crossings")
        .select("*")
        .eq("race_id", raceId)
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(20),
    ]);
    if (raceRes.data) setRace(raceRes.data);
    if (entriesRes.data) setEntries(entriesRes.data);
    if (crossingsRes.data) setCrossings(crossingsRes.data);
    if (deletedRes.data) setDeletedCrossings(deletedRes.data);

    // Penalties are scoped to entries, not race_id directly.
    const entryIds = (entriesRes.data ?? []).map((e) => e.id);
    if (entryIds.length > 0) {
      const penaltiesRes = await supabase
        .from("race_entry_penalties")
        .select("*")
        .in("entry_id", entryIds)
        .order("set_at", { ascending: true });
      if (penaltiesRes.data) setPenalties(penaltiesRes.data);
    } else {
      setPenalties([]);
    }
    setLoading(false);
  }, [raceId]);

  useEffect(() => {
    refetch();

    const channel = supabase
      .channel(`race-${raceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crossings", filter: `race_id=eq.${raceId}` },
        () => refetch()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "races", filter: `id=eq.${raceId}` },
        () => refetch()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries", filter: `race_id=eq.${raceId}` },
        () => refetch()
      )
      // race_entry_penalties has no race_id column to filter on directly,
      // so listen unfiltered and let refetch() re-scope by this race's
      // entry ids — fine at grassroots scale, same tradeoff as above.
      .on("postgres_changes", { event: "*", schema: "public", table: "race_entry_penalties" }, () => refetch())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [raceId, refetch]);

  return { race, entries, crossings, deletedCrossings, penalties, loading, refetch };
}
