/**
 * Multi-session local solo stopwatch storage layer (ADR 0024).
 *
 * Schema
 * ──────
 * solo_sessions_index_v1  → JSON: SoloSessionIndex (ordered list of SoloSessionMeta)
 * solo_session_<id>_v1    → JSON: SoloSessionPayload (per-session timer state)
 * solo_active_session_v1  → string: active session id
 *
 * Migration
 * ─────────
 * On first launch after this update, if legacy keys `solo_stopwatch_v1` or
 * `solo_timer_v1` exist, they are wrapped into a new session named "Session 1"
 * in the index, and the legacy keys are removed.
 *
 * Session cap: 10 (per ADR 0024).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

// ── Storage keys ───────────────────────────────────────────────────────────────

export const SOLO_SESSIONS_INDEX_KEY = "solo_sessions_index_v1";
export const SOLO_ACTIVE_SESSION_KEY = "solo_active_session_v1";
export const SESSION_KEY_PREFIX = "solo_session_";
export const SESSION_KEY_SUFFIX = "_v1";

/** Legacy single-session keys (pre-multi-session). */
export const LEGACY_SOLO_KEY = "solo_stopwatch_v1";
export const LEGACY_TIMER_KEY = "solo_timer_v1";
export const LEGACY_MODE_KEY = "solo_mode_v1";

// ── Constants ─────────────────────────────────────────────────────────────────

export const SESSION_CAP = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

export type SoloMode = "stopwatch" | "timer";

/**
 * Persisted state for the stopwatch (count-up) mode.
 * Mirrors PersistedSolo in App.tsx.
 */
export type PersistedStopwatchState = {
  state: "running" | "paused";
  accumMs: number;
  anchorWall: number | null;
  lastLapCumMs: number;
  laps: { number: number; splitMs: number; cumulativeMs: number }[];
};

/**
 * Persisted state for the countdown timer mode.
 * Mirrors PersistedTimer in App.tsx.
 */
export type PersistedTimerState = {
  state: "running" | "paused";
  durationMs: number;
  endAtWall: number | null;
  remainingMs: number | null;
};

/**
 * Metadata stored in the index for quick listing — no full state payload here.
 */
export type SoloSessionMeta = {
  id: string;
  /** User-visible name, e.g. "Session 1" */
  name: string;
  mode: SoloMode;
  /** ISO 8601 timestamp of the last time this session was made active */
  lastUsedAt: string;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
  /**
   * Optional accent color tag (hex string from @splitsync/palette).
   * Undefined means "no color" (default styling applies).
   * WCAG 1.4.1: color supplements the name label, never replaces it.
   */
  color?: string;
};

/**
 * The full ordered index stored under SOLO_SESSIONS_INDEX_KEY.
 */
export type SoloSessionIndex = SoloSessionMeta[];

/**
 * The per-session payload stored under `solo_session_<id>_v1`.
 * Both states are optional because a freshly created session is empty.
 */
export type SoloSessionPayload = {
  stopwatchState?: PersistedStopwatchState;
  timerState?: PersistedTimerState;
};

// ── Key helpers ────────────────────────────────────────────────────────────────

export function sessionPayloadKey(id: string): string {
  return `${SESSION_KEY_PREFIX}${id}${SESSION_KEY_SUFFIX}`;
}

// ── Index CRUD ─────────────────────────────────────────────────────────────────

export async function loadIndex(): Promise<SoloSessionIndex> {
  try {
    const raw = await AsyncStorage.getItem(SOLO_SESSIONS_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as SoloSessionIndex;
  } catch {
    return [];
  }
}

async function saveIndex(index: SoloSessionIndex): Promise<void> {
  await AsyncStorage.setItem(SOLO_SESSIONS_INDEX_KEY, JSON.stringify(index));
}

// ── Active session pointer ─────────────────────────────────────────────────────

export async function getActiveSessionId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SOLO_ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

export async function setActiveSessionId(id: string): Promise<void> {
  await AsyncStorage.setItem(SOLO_ACTIVE_SESSION_KEY, id);
}

// ── Session CRUD ──────────────────────────────────────────────────────────────

/**
 * Create a new solo session.
 *
 * - Enforces the cap: throws if the cap (10) is already reached.
 * - Appends to the index in creation order.
 * - Does NOT automatically make the new session active.
 */
export async function createSession(
  id: string,
  name: string,
  mode: SoloMode,
  color?: string
): Promise<SoloSessionMeta> {
  const index = await loadIndex();

  if (index.length >= SESSION_CAP) {
    throw new Error(
      `Session cap of ${SESSION_CAP} reached. Delete an existing session before creating a new one.`
    );
  }

  const now = new Date().toISOString();
  const meta: SoloSessionMeta = {
    id,
    name,
    mode,
    lastUsedAt: now,
    createdAt: now,
    ...(color ? { color } : {}),
  };

  // Write an empty payload for the new session
  await AsyncStorage.setItem(sessionPayloadKey(id), JSON.stringify({}));

  // Append to the index
  await saveIndex([...index, meta]);

  return meta;
}

/**
 * Load the payload for a single session.
 */
export async function getSession(id: string): Promise<SoloSessionPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(sessionPayloadKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as SoloSessionPayload;
  } catch {
    return null;
  }
}

/**
 * Update the persisted payload for a session and update its `lastUsedAt`
 * timestamp in the index.
 */
export async function updateSession(
  id: string,
  payload: SoloSessionPayload
): Promise<void> {
  await AsyncStorage.setItem(sessionPayloadKey(id), JSON.stringify(payload));

  // Update lastUsedAt in the index
  const index = await loadIndex();
  const idx = index.findIndex((m) => m.id === id);
  if (idx !== -1) {
    index[idx] = { ...index[idx], lastUsedAt: new Date().toISOString() };
    await saveIndex(index);
  }
}

/**
 * Update a session's metadata (name, mode, and/or color) in the index.
 */
export async function updateSessionMeta(
  id: string,
  patch: Partial<Pick<SoloSessionMeta, "name" | "mode" | "color">>
): Promise<void> {
  const index = await loadIndex();
  const idx = index.findIndex((m) => m.id === id);
  if (idx !== -1) {
    index[idx] = { ...index[idx], ...patch };
    await saveIndex(index);
  }
}

/**
 * Delete a session: removes the payload key and its entry from the index.
 * If the deleted session was the active one, the active pointer is cleared.
 */
export async function deleteSession(id: string): Promise<void> {
  const [index, activeId] = await Promise.all([loadIndex(), getActiveSessionId()]);

  // Remove payload
  await AsyncStorage.removeItem(sessionPayloadKey(id));

  // Remove from index
  await saveIndex(index.filter((m) => m.id !== id));

  // Clear active pointer if it pointed to this session
  if (activeId === id) {
    await AsyncStorage.removeItem(SOLO_ACTIVE_SESSION_KEY);
  }
}

/**
 * Return the ordered list of session metadata from the index.
 */
export async function listSessions(): Promise<SoloSessionIndex> {
  return loadIndex();
}

// ── Migration ─────────────────────────────────────────────────────────────────

/**
 * One-time migration from legacy single-session storage to the multi-session
 * model.
 *
 * Conditions that trigger migration:
 *   - `solo_stopwatch_v1` exists, OR
 *   - `solo_timer_v1` exists
 *
 * AND the new index (`solo_sessions_index_v1`) is empty (i.e., not yet
 * created by the new storage layer).
 *
 * After a successful migration, the legacy keys are removed.
 *
 * Returns the migrated session's id, or null if no migration was needed.
 */
export async function migrateLegacySession(
  generateId: () => string
): Promise<string | null> {
  // Only migrate if the new index doesn't exist yet
  const existing = await loadIndex();
  if (existing.length > 0) {
    // Index already populated — migration already happened or user has sessions.
    return null;
  }

  // Check for active pointer too — if it's set the migration already ran.
  const existingActive = await AsyncStorage.getItem(SOLO_ACTIVE_SESSION_KEY);
  if (existingActive !== null) {
    return null;
  }

  // Read legacy keys in parallel
  const [rawSolo, rawTimer, rawMode] = await Promise.all([
    AsyncStorage.getItem(LEGACY_SOLO_KEY),
    AsyncStorage.getItem(LEGACY_TIMER_KEY),
    AsyncStorage.getItem(LEGACY_MODE_KEY),
  ]);

  // Nothing to migrate
  if (rawSolo === null && rawTimer === null) {
    return null;
  }

  // Determine the mode from the legacy mode key
  let legacyMode: SoloMode = "stopwatch";
  if (rawMode === "timer") legacyMode = "timer";

  // Parse legacy payloads (best-effort — corrupt data is silently dropped)
  let stopwatchState: PersistedStopwatchState | undefined;
  if (rawSolo) {
    try {
      const parsed = JSON.parse(rawSolo) as PersistedStopwatchState;
      if (
        (parsed.state === "running" || parsed.state === "paused") &&
        typeof parsed.accumMs === "number" &&
        Array.isArray(parsed.laps)
      ) {
        stopwatchState = parsed;
      }
    } catch {
      // Corrupt — skip
    }
  }

  let timerState: PersistedTimerState | undefined;
  if (rawTimer) {
    try {
      const parsed = JSON.parse(rawTimer) as PersistedTimerState;
      if (
        (parsed.state === "running" || parsed.state === "paused") &&
        typeof parsed.durationMs === "number" &&
        parsed.durationMs > 0
      ) {
        timerState = parsed;
      }
    } catch {
      // Corrupt — skip
    }
  }

  // Create the migrated session
  const id = generateId();
  const now = new Date().toISOString();
  const meta: SoloSessionMeta = {
    id,
    name: "Session 1",
    mode: legacyMode,
    lastUsedAt: now,
    createdAt: now,
  };

  const payload: SoloSessionPayload = {};
  if (stopwatchState) payload.stopwatchState = stopwatchState;
  if (timerState) payload.timerState = timerState;

  // Write the new session payload and index atomically via multiSet
  await AsyncStorage.multiSet([
    [sessionPayloadKey(id), JSON.stringify(payload)],
    [SOLO_SESSIONS_INDEX_KEY, JSON.stringify([meta])],
    [SOLO_ACTIVE_SESSION_KEY, id],
  ]);

  // Remove legacy keys
  await AsyncStorage.multiRemove([LEGACY_SOLO_KEY, LEGACY_TIMER_KEY, LEGACY_MODE_KEY]);

  return id;
}

/**
 * Resolve the active session id, creating a default session if none exists.
 *
 * This is the "boot" function called by SoloContainer:
 *  1. Run legacy migration if needed.
 *  2. If after migration there is still no session, create a default one.
 *  3. Return the active session id (guaranteed non-null).
 */
export async function resolveActiveSession(
  generateId: () => string
): Promise<string> {
  // Step 1 — migrate legacy data
  const migratedId = await migrateLegacySession(generateId);
  if (migratedId !== null) {
    return migratedId;
  }

  // Step 2 — check existing active pointer
  const activeId = await getActiveSessionId();
  if (activeId !== null) {
    // Verify it still exists in the index
    const index = await loadIndex();
    if (index.some((m) => m.id === activeId)) {
      return activeId;
    }
    // Stale pointer — fall through to pick the first available session
    const firstId = index[0]?.id;
    if (firstId) {
      await setActiveSessionId(firstId);
      return firstId;
    }
  }

  // Step 3 — no sessions at all, create a default one
  const sessions = await listSessions();
  if (sessions.length > 0) {
    const firstId = sessions[0].id;
    await setActiveSessionId(firstId);
    return firstId;
  }

  // Truly empty — create "Session 1"
  const newId = generateId();
  await createSession(newId, "Session 1", "stopwatch");
  await setActiveSessionId(newId);
  return newId;
}
