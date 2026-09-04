/** Framework-neutral state shared by the web and native stopwatch clients. */

export type RepeatConfig = {
  /** Number of work phases to complete; null means repeat indefinitely. */
  repeatCount: number | null;
  /** Duration of the rest phase between work phases. Zero skips rest. */
  restDurationMs: number;
};

type TimerBase = {
  id: string;
  name: string;
  /** Accumulated elapsed time before the current wall-clock anchor. */
  elapsedMs: number;
  /** ISO wall-clock anchor for the active segment, null when not running. */
  startedAt: string | null;
  status: "idle" | "running" | "paused" | "completed";
};

export type StopwatchTimerState = TimerBase & {
  mode: "stopwatch";
  laps: { recordedAt: string; elapsedMs: number }[];
};

export type CountdownTimerState = TimerBase & {
  mode: "timer";
  durationMs: number;
  /** The active phase. A rest phase uses repeatConfig.restDurationMs. */
  phase: "work" | "rest";
  repeatConfig: RepeatConfig | null;
  /** Completed work phases in the current run. */
  repsDone: number;
};

/** A timer is discriminated by its mode so consumers cannot read timer-only fields from a stopwatch. */
export type TimerState = StopwatchTimerState | CountdownTimerState;

export type SessionParticipant = {
  displayName: string;
  isOwner: boolean;
  clientId: string;
  joinedAt: string;
};

export type SessionStateJSON = {
  schemaVersion: 1;
  id: string;
  name: string;
  kind: "local" | "shared";
  shared: null | {
    code: string;
    ownerId: string;
    status: "waiting" | "running" | "stopped" | "closed";
    expiresAt: string;
    participants: Record<string, SessionParticipant>;
  };
  createdAt: string;
  updatedAt: string;
  timerOrder: string[];
  timers: Record<string, TimerState>;
  /** Persisted deduplication keys make replaying an event a no-op. */
  appliedEventIds?: string[];
};

type EventBase<T extends string, P extends Record<string, unknown>> = {
  id: string;
  sessionId: string;
  timerId: string | null;
  type: T;
  payload: P;
  clientRecordedAt: string;
  serverReceivedAt?: string;
  sequence: number;
};

export type SessionEvent =
  | EventBase<"start" | "pause" | "reset" | "complete", Record<string, never>> & { timerId: string }
  | EventBase<"lap", { elapsedMs?: number }> & { timerId: string }
  | EventBase<"timer_added", { timer: TimerState }> & { timerId: string | null }
  | EventBase<"timer_removed", Record<string, never>> & { timerId: string }
  | EventBase<"timer_renamed", { name: string }> & { timerId: string }
  | EventBase<"timers_reordered", { timerOrder: string[] }> & { timerId: null }
  | EventBase<"session_renamed", { name: string }> & { timerId: null }
  | EventBase<"repeat_config_set", { config: RepeatConfig | null }> & { timerId: string };

export type StorageAdapter = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export type SessionMeta = Pick<SessionStateJSON, "id" | "name" | "kind" | "createdAt" | "updatedAt">;
