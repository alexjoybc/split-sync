import { applyEvent } from "./reducer";
import type { SessionEvent, SessionMeta, SessionStateJSON, StorageAdapter } from "./types";

export const SESSION_CAP = 10;
const INDEX_KEY = "splitsync_stopwatch_core_sessions_v1";
const snapshotKey = (id: string) => `splitsync_stopwatch_core_session_${id}_v1`;
const eventKey = (id: string) => `splitsync_stopwatch_core_events_${id}_v1`;

async function read<T>(storage: StorageAdapter, key: string, fallback: T): Promise<T> {
  try { const raw = await storage.getItem(key); return raw === null ? fallback : JSON.parse(raw) as T; } catch { return fallback; }
}
const write = (storage: StorageAdapter, key: string, value: unknown) => storage.setItem(key, JSON.stringify(value));
const toMeta = (state: SessionStateJSON): SessionMeta => ({ id: state.id, name: state.name, kind: state.kind, createdAt: state.createdAt, updatedAt: state.updatedAt });

export async function listSessions(storage: StorageAdapter): Promise<SessionMeta[]> { return read(storage, INDEX_KEY, []); }
export async function getSnapshot(storage: StorageAdapter, id: string): Promise<SessionStateJSON | null> { return read(storage, snapshotKey(id), null); }

export async function createSession(storage: StorageAdapter, state: SessionStateJSON): Promise<SessionStateJSON> {
  const index = await listSessions(storage);
  if (index.length >= SESSION_CAP) throw new Error(`Session cap of ${SESSION_CAP} reached.`);
  if (index.some((entry) => entry.id === state.id)) throw new Error("Session already exists.");
  await write(storage, snapshotKey(state.id), state);
  await write(storage, eventKey(state.id), []);
  await write(storage, INDEX_KEY, [...index, toMeta(state)]);
  return state;
}

export async function appendEvent(storage: StorageAdapter, event: SessionEvent): Promise<SessionStateJSON | null> {
  const snapshot = await getSnapshot(storage, event.sessionId);
  if (!snapshot) return null;
  const next = applyEvent(snapshot, event);
  if (next === snapshot) return snapshot;
  const events = await read<SessionEvent[]>(storage, eventKey(event.sessionId), []);
  await write(storage, snapshotKey(event.sessionId), next);
  await write(storage, eventKey(event.sessionId), [...events, event]);
  const index = await listSessions(storage);
  await write(storage, INDEX_KEY, index.map((entry) => entry.id === next.id ? toMeta(next) : entry));
  return next;
}

export async function deleteSession(storage: StorageAdapter, id: string): Promise<void> {
  await storage.removeItem(snapshotKey(id)); await storage.removeItem(eventKey(id));
  await write(storage, INDEX_KEY, (await listSessions(storage)).filter((entry) => entry.id !== id));
}

export async function reorderSessions(storage: StorageAdapter, orderedIds: string[]): Promise<void> {
  const index = await listSessions(storage); const byId = new Map(index.map((entry) => [entry.id, entry]));
  const ids = orderedIds.filter((id, i, all) => byId.has(id) && all.indexOf(id) === i);
  await write(storage, INDEX_KEY, [...ids.map((id) => byId.get(id)!), ...index.filter((entry) => !ids.includes(entry.id))]);
}
