"use client";

import { supabase } from "./supabase";

export interface PendingCrossing {
  race_id: string;
  bib: string;
  client_id: string;
  client_recorded_at: string;
}

const KEY = "splitsync.pendingCrossings";

function load(): PendingCrossing[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(items: PendingCrossing[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function pendingCount(): number {
  return load().length;
}

/**
 * Record a crossing. Always enqueue locally first, then flush.
 * client_id is unique in the DB, so retries are idempotent.
 */
export async function recordCrossing(raceId: string, bib: string): Promise<void> {
  const item: PendingCrossing = {
    race_id: raceId,
    bib,
    client_id: crypto.randomUUID(),
    client_recorded_at: new Date().toISOString(),
  };
  save([...load(), item]);
  await flushQueue();
}

/** Try to push all pending crossings. Leaves failures queued. */
export async function flushQueue(): Promise<number> {
  const items = load();
  if (items.length === 0) return 0;

  const { error } = await supabase.from("crossings").insert(items);
  if (!error) {
    save([]);
    return 0;
  }
  // 23505 = unique violation: rows already made it in a previous retry
  if (error.code === "23505") {
    save([]);
    return 0;
  }
  return items.length;
}
