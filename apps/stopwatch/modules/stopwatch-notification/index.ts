import { requireOptionalNativeModule } from "expo";

/**
 * Native side of the ongoing running-stopwatch notification (#231).
 *
 * Loaded optionally: before a native rebuild (or in any environment where the
 * module isn't compiled in) this resolves to `null` and callers no-op.
 */
export interface StopwatchNotificationModule {
  /** Whether the app may currently post notifications. */
  hasPermission(): boolean;
  /**
   * Request POST_NOTIFICATIONS (Android 13+). Resolves with whether the
   * permission is now granted.
   */
  requestPermission(): Promise<boolean>;
  /**
   * Show (or replace) the ongoing chronometer notification. `startedAtMs` is
   * the epoch-millis zero point of the running stopwatch — Android renders and
   * ticks the elapsed time natively.
   */
  show(title: string, text: string, startedAtMs: number): void;
  /** Remove the ongoing notification. */
  clear(): void;
}

export default requireOptionalNativeModule<StopwatchNotificationModule>(
  "StopwatchNotification"
);
