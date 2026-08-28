import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";

const key = "splitsync.pending-crossings";

export type PendingCrossing = {
  race_id: string;
  bib: string;
  client_id: string;
  client_recorded_at: string;
  source: "manual";
};

async function readQueue(): Promise<PendingCrossing[]> {
  const value = await AsyncStorage.getItem(key);
  return value ? JSON.parse(value) : [];
}

async function writeQueue(items: PendingCrossing[]) {
  await AsyncStorage.setItem(key, JSON.stringify(items));
}

export async function pendingCrossings() {
  return (await readQueue()).length;
}

export async function getPendingQueue(): Promise<PendingCrossing[]> {
  return readQueue();
}

export async function flushCrossings() {
  const items = await readQueue();
  if (items.length === 0) return 0;

  // client_id is unique in Postgres, so this remains safe after retries.
  const { error } = await supabase.from("crossings").insert(items);
  if (!error || error.code === "23505") await writeQueue([]);
  return error ? items.length : 0;
}

export async function recordCrossing(
  raceId: string,
  bib: string,
): Promise<{ remaining: number; client_id: string; client_recorded_at: string }> {
  const queue = await readQueue();
  const client_id = Crypto.randomUUID();
  const client_recorded_at = new Date().toISOString();
  queue.push({ race_id: raceId, bib, client_id, client_recorded_at, source: "manual" });
  await writeQueue(queue);
  const remaining = await flushCrossings();
  return { remaining, client_id, client_recorded_at };
}

/**
 * Remove a crossing from the local pending queue by its client_id.
 * Returns true if it was found (and removed) — meaning it had not yet synced.
 * Returns false if not in queue — caller should soft-delete via Supabase API.
 */
export async function removePendingCrossing(clientId: string): Promise<boolean> {
  const queue = await readQueue();
  const index = queue.findIndex((item) => item.client_id === clientId);
  if (index === -1) return false;
  queue.splice(index, 1);
  await writeQueue(queue);
  return true;
}
