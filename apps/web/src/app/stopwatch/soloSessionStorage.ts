/**
 * Multi-session local storage model for the web solo stopwatch/timer.
 *
 * Implements the data layer described in ADR 0024
 * (docs/adr/0024-stopwatch-multiple-local-solo-sessions.md).
 *
 * Session cap: 10 (per ADR 0024).
 *
 * Storage keys:
 *   - Index:          splitsync_stopwatch_sessions_index_v1
 *   - Per-session:    splitsync_stopwatch_session_<id>_v1
 *   - Active pointer: splitsync_stopwatch_active_session_v1
 *
 * One-time migration from legacy single-session keys:
 *   - splitsync_stopwatch_solo_v1  → session.stopwatchState
 *   - splitsync_stopwatch_mode_v1  → session.mode
 *   - splitsync_timer_solo_v1      → session.timerState
 *   - splitsync_timer_duration_v1  → session.timerDurationMs
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Lap {
  n: number;
  /** This lap's duration in ms. */
  lapMs: number;
  /** Cumulative time at end of this lap in ms. */
  totalMs: number;
}

export type SoloMode = "stopwatch" | "timer";

export interface StopwatchPersistedState {
  /** Only "running" | "stopped" are persisted; idle clears storage. */
  state: "running" | "stopped";
  /** Milliseconds accumulated before the last resume (or total, if stopped). */
  accMs: number;
  /** Wall-clock (Date.now()) at last resume; null when stopped. */
  startedAtWall: number | null;
  laps: Lap[];
}

export interface TimerPersistedState {
  /** Only "running" | "paused" are persisted; idle clears storage. */
  state: "running" | "paused";
  /** The originally set duration — completion resets back to this. */
  durationMs: number;
  /** Wall-clock (Date.now()) when the countdown reaches zero; null when paused. */
  endAtWall: number | null;
  /** Remaining ms when paused; null when running. */
  remainingMs: number | null;
}

export interface SoloSessionRecord {
  id: string;
  name: string;
  mode: SoloMode;
  /** Null means idle/not-started. */
  stopwatchState: StopwatchPersistedState | null;
  /** Null means idle (timer not started or already reset). */
  timerState: TimerPersistedState | null;
  /**
   * Last-used timer duration in ms. Persisted separately from timerState so
   * the timer input is pre-filled even after a reset (when timerState is null).
   */
  timerDurationMs: number;
  /** ISO timestamp of the last time this session was written. */
  lastUsedAt: string;
  /** ISO timestamp of session creation. */
  createdAt: string;
}

export interface SoloSessionIndex {
  /** Ordered by creation time, oldest first. At most SESSION_CAP entries. */
  ids: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of local solo sessions per device (ADR 0024). */
export const SESSION_CAP = 10;

/** Default countdown timer duration (5 minutes) if none was ever set. */
export const DEFAULT_TIMER_DURATION_MS = 5 * 60_000;

const SESSIONS_INDEX_KEY = "splitsync_stopwatch_sessions_index_v1";
const SESSION_KEY_PREFIX = "splitsync_stopwatch_session_";
const SESSION_KEY_SUFFIX = "_v1";
const ACTIVE_SESSION_KEY = "splitsync_stopwatch_active_session_v1";

// Legacy keys (for one-time migration only — never written after migration)
const LEGACY_STOPWATCH_KEY = "splitsync_stopwatch_solo_v1";
const LEGACY_MODE_KEY = "splitsync_stopwatch_mode_v1";
const LEGACY_TIMER_KEY = "splitsync_timer_solo_v1";
const LEGACY_DURATION_KEY = "splitsync_timer_duration_v1";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sessionKey(id: string): string {
  return `${SESSION_KEY_PREFIX}${id}${SESSION_KEY_SUFFIX}`;
}

function safeGet<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode / quota) — degraded mode.
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

function safeGetString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore.
  }
}

// ---------------------------------------------------------------------------
// Session index
// ---------------------------------------------------------------------------

function readIndex(): SoloSessionIndex {
  const index = safeGet<SoloSessionIndex>(SESSIONS_INDEX_KEY);
  if (!index || !Array.isArray(index.ids)) return { ids: [] };
  return index;
}

function writeIndex(index: SoloSessionIndex): void {
  safeSet(SESSIONS_INDEX_KEY, index);
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/** Return all sessions in creation order (oldest first). */
export function listSessions(): SoloSessionRecord[] {
  const index = readIndex();
  const sessions: SoloSessionRecord[] = [];
  for (const id of index.ids) {
    const session = safeGet<SoloSessionRecord>(sessionKey(id));
    if (session) sessions.push(session);
  }
  return sessions;
}

/** Return a single session by id, or null if not found. */
export function getSession(id: string): SoloSessionRecord | null {
  return safeGet<SoloSessionRecord>(sessionKey(id));
}

/**
 * Create a new session and add it to the index.
 * Returns the new session, or null if the session cap is already reached.
 */
export function createSession(
  name: string,
  mode: SoloMode = "stopwatch"
): SoloSessionRecord | null {
  const index = readIndex();
  if (index.ids.length >= SESSION_CAP) return null; // cap enforced

  const now = new Date().toISOString();
  const session: SoloSessionRecord = {
    id: generateId(),
    name,
    mode,
    stopwatchState: null,
    timerState: null,
    timerDurationMs: DEFAULT_TIMER_DURATION_MS,
    lastUsedAt: now,
    createdAt: now,
  };

  safeSet(sessionKey(session.id), session);
  writeIndex({ ids: [...index.ids, session.id] });
  return session;
}

/**
 * Apply a partial update to a session, bumping lastUsedAt.
 * Returns the updated session, or null if the session doesn't exist.
 */
export function updateSession(
  id: string,
  patch: Partial<Omit<SoloSessionRecord, "id" | "createdAt">>
): SoloSessionRecord | null {
  const session = getSession(id);
  if (!session) return null;
  const updated: SoloSessionRecord = {
    ...session,
    ...patch,
    id: session.id,
    createdAt: session.createdAt,
    lastUsedAt: new Date().toISOString(),
  };
  safeSet(sessionKey(id), updated);
  return updated;
}

/**
 * Persist a new session order.
 *
 * `orderedIds` must be a permutation of (a subset of) the current index IDs.
 * - IDs that appear in `orderedIds` are placed in that order.
 * - IDs that exist in the index but are absent from `orderedIds` are appended
 *   at the end (safety net).
 * - IDs in `orderedIds` that are not in the current index are silently dropped.
 */
export function reorderSessions(orderedIds: string[]): void {
  const index = readIndex();
  const existingSet = new Set(index.ids);

  // Reordered IDs (only those that exist)
  const newIds = orderedIds.filter((id) => existingSet.has(id));

  // Append any IDs from the old index that were not mentioned
  const mentioned = new Set(orderedIds);
  for (const id of index.ids) {
    if (!mentioned.has(id)) {
      newIds.push(id);
    }
  }

  writeIndex({ ids: newIds });
}

/**
 * Delete a session and remove it from the index.
 * If the deleted session was the active one, the active pointer is cleared.
 */
export function deleteSession(id: string): void {
  safeRemove(sessionKey(id));
  const index = readIndex();
  writeIndex({ ids: index.ids.filter((i) => i !== id) });
  const activeId = getActiveSessionId();
  if (activeId === id) safeRemove(ACTIVE_SESSION_KEY);
}

// ---------------------------------------------------------------------------
// Active session pointer
// ---------------------------------------------------------------------------

/** Return the id of the currently-active session, or null if none is set. */
export function getActiveSessionId(): string | null {
  return safeGetString(ACTIVE_SESSION_KEY);
}

/** Persist the active session pointer. */
export function setActiveSessionId(id: string): void {
  safeSetString(ACTIVE_SESSION_KEY, id);
}

/**
 * Return the active session.
 * If no valid active session exists, pick the first one in the index or create
 * a new default "Session 1". Safe to call on every mount.
 */
export function getOrCreateActiveSession(): SoloSessionRecord {
  // 1. Try the stored active pointer.
  const activeId = getActiveSessionId();
  if (activeId) {
    const session = getSession(activeId);
    if (session) return session;
  }

  // 2. Fall back to the first session in the index.
  const index = readIndex();
  if (index.ids.length > 0) {
    const first = getSession(index.ids[0]);
    if (first) {
      setActiveSessionId(first.id);
      return first;
    }
  }

  // 3. Create a default session.
  const newSession = createSession("Session 1");
  if (newSession) {
    setActiveSessionId(newSession.id);
    return newSession;
  }

  // 4. Absolute fallback (storage completely unavailable — in-memory only).
  const now = new Date().toISOString();
  return {
    id: "fallback",
    name: "Session 1",
    mode: "stopwatch",
    stopwatchState: null,
    timerState: null,
    timerDurationMs: DEFAULT_TIMER_DURATION_MS,
    lastUsedAt: now,
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// Active-session state accessors
// (thin wrappers so callers don't need to manage the session id themselves)
// ---------------------------------------------------------------------------

/** Read the stopwatch state for the currently-active session. */
export function readActiveStopwatchState(): StopwatchPersistedState | null {
  const id = getActiveSessionId();
  if (!id) return null;
  return getSession(id)?.stopwatchState ?? null;
}

/** Write (upsert) the stopwatch state for the currently-active session. */
export function writeActiveStopwatchState(state: StopwatchPersistedState): void {
  const id = getActiveSessionId();
  if (!id) return;
  updateSession(id, { stopwatchState: state });
}

/** Clear (set to null) the stopwatch state for the currently-active session. */
export function clearActiveStopwatchState(): void {
  const id = getActiveSessionId();
  if (!id) return;
  updateSession(id, { stopwatchState: null });
}

/** Read the timer state for the currently-active session. */
export function readActiveTimerState(): TimerPersistedState | null {
  const id = getActiveSessionId();
  if (!id) return null;
  return getSession(id)?.timerState ?? null;
}

/** Write (upsert) the timer state for the currently-active session. */
export function writeActiveTimerState(state: TimerPersistedState): void {
  const id = getActiveSessionId();
  if (!id) return;
  updateSession(id, { timerState: state });
}

/** Clear (set to null) the timer state for the currently-active session. */
export function clearActiveTimerState(): void {
  const id = getActiveSessionId();
  if (!id) return;
  updateSession(id, { timerState: null });
}

/**
 * Read the last-used timer duration for the currently-active session.
 * Falls back to DEFAULT_TIMER_DURATION_MS if no session or no duration is set.
 */
export function readActiveTimerDurationMs(): number {
  const id = getActiveSessionId();
  if (!id) return DEFAULT_TIMER_DURATION_MS;
  return getSession(id)?.timerDurationMs ?? DEFAULT_TIMER_DURATION_MS;
}

/** Persist the last-used timer duration for the currently-active session. */
export function writeActiveTimerDurationMs(durationMs: number): void {
  const id = getActiveSessionId();
  if (!id) return;
  updateSession(id, { timerDurationMs: durationMs });
}

/** Read the solo mode (stopwatch | timer) for the currently-active session. */
export function readActiveMode(): SoloMode {
  const id = getActiveSessionId();
  if (!id) return "stopwatch";
  return getSession(id)?.mode ?? "stopwatch";
}

/** Persist the solo mode for the currently-active session. */
export function writeActiveMode(mode: SoloMode): void {
  const id = getActiveSessionId();
  if (!id) return;
  updateSession(id, { mode });
}

// ---------------------------------------------------------------------------
// One-time migration from the legacy single-session storage model
// ---------------------------------------------------------------------------

/**
 * Migrate from the legacy fixed-key model to the multi-session model.
 *
 * This function is idempotent — it checks for the existence of the sessions
 * index key and returns immediately if it already exists (i.e. migration was
 * already done on a previous load).
 *
 * Legacy keys consumed and then removed on success:
 *   splitsync_stopwatch_solo_v1  → SoloSessionRecord.stopwatchState
 *   splitsync_stopwatch_mode_v1  → SoloSessionRecord.mode
 *   splitsync_timer_solo_v1      → SoloSessionRecord.timerState
 *   splitsync_timer_duration_v1  → SoloSessionRecord.timerDurationMs
 */
export function runMigrationIfNeeded(): void {
  // Guard: if the index already exists, migration was done on a prior load.
  if (safeGetString(SESSIONS_INDEX_KEY) !== null) return;

  // Read legacy values (null = key didn't exist).
  const legacyStopwatch = safeGet<{
    state: unknown;
    accMs: unknown;
    startedAtWall: unknown;
    laps: unknown;
  }>(LEGACY_STOPWATCH_KEY);

  const legacyModeRaw = safeGetString(LEGACY_MODE_KEY);
  const legacyMode: SoloMode | null =
    legacyModeRaw === "timer" || legacyModeRaw === "stopwatch"
      ? legacyModeRaw
      : null;

  const legacyTimer = safeGet<{
    state: unknown;
    durationMs: unknown;
    endAtWall: unknown;
    remainingMs: unknown;
  }>(LEGACY_TIMER_KEY);

  const legacyDurationRaw = safeGetString(LEGACY_DURATION_KEY);
  const legacyDurationMs =
    legacyDurationRaw !== null
      ? (() => {
          const n = Number(legacyDurationRaw);
          return Number.isFinite(n) && n > 0 ? n : null;
        })()
      : null;

  const hasLegacyData =
    legacyStopwatch !== null ||
    legacyMode !== null ||
    legacyTimer !== null ||
    legacyDurationMs !== null;

  if (hasLegacyData) {
    // Validate and coerce the stopwatch state.
    let stopwatchState: StopwatchPersistedState | null = null;
    if (
      legacyStopwatch !== null &&
      (legacyStopwatch.state === "running" ||
        legacyStopwatch.state === "stopped") &&
      typeof legacyStopwatch.accMs === "number" &&
      Array.isArray(legacyStopwatch.laps)
    ) {
      stopwatchState = {
        state: legacyStopwatch.state,
        accMs: legacyStopwatch.accMs,
        startedAtWall:
          typeof legacyStopwatch.startedAtWall === "number"
            ? legacyStopwatch.startedAtWall
            : null,
        laps: (legacyStopwatch.laps as Lap[]).filter(
          (l): l is Lap =>
            typeof l === "object" &&
            l !== null &&
            typeof l.n === "number" &&
            typeof l.lapMs === "number" &&
            typeof l.totalMs === "number"
        ),
      };
    }

    // Validate and coerce the timer state.
    let timerState: TimerPersistedState | null = null;
    if (
      legacyTimer !== null &&
      (legacyTimer.state === "running" || legacyTimer.state === "paused") &&
      typeof legacyTimer.durationMs === "number" &&
      legacyTimer.durationMs > 0
    ) {
      timerState = {
        state: legacyTimer.state,
        durationMs: legacyTimer.durationMs,
        endAtWall:
          typeof legacyTimer.endAtWall === "number"
            ? legacyTimer.endAtWall
            : null,
        remainingMs:
          typeof legacyTimer.remainingMs === "number"
            ? legacyTimer.remainingMs
            : null,
      };
    }

    const timerDurationMs =
      legacyDurationMs ??
      timerState?.durationMs ??
      DEFAULT_TIMER_DURATION_MS;

    const now = new Date().toISOString();
    const id = generateId();
    const session: SoloSessionRecord = {
      id,
      name: "Session 1",
      mode: legacyMode ?? "stopwatch",
      stopwatchState,
      timerState,
      timerDurationMs,
      lastUsedAt: now,
      createdAt: now,
    };

    safeSet(sessionKey(id), session);
    writeIndex({ ids: [id] });
    setActiveSessionId(id);

    // Remove legacy keys after a successful write.
    safeRemove(LEGACY_STOPWATCH_KEY);
    safeRemove(LEGACY_MODE_KEY);
    safeRemove(LEGACY_TIMER_KEY);
    safeRemove(LEGACY_DURATION_KEY);
  } else {
    // No legacy data: initialise an empty index. A session will be created
    // lazily via getOrCreateActiveSession() when the page finishes loading.
    writeIndex({ ids: [] });
  }
}
