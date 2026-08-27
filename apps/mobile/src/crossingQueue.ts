import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";

const key = "splitsync.pending-crossings";

type PendingCrossing = {
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

export async function flushCrossings() {
  const items = await readQueue();
  if (items.length === 0) return 0;

  // client_id is unique in Postgres, so this remains safe after retries.
  const { error } = await supabase.from("crossings").insert(items);
  if (!error || error.code === "23505") await writeQueue([]);
  return error ? items.length : 0;
}

export async function recordCrossing(raceId: string, bib: string) {
  const queue = await readQueue();
  queue.push({
    race_id: raceId,
    bib,
    client_id: Crypto.randomUUID(),
    client_recorded_at: new Date().toISOString(),
    source: "manual",
  });
  await writeQueue(queue);
  return flushCrossings();
}
