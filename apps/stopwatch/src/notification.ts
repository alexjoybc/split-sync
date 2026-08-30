/**
 * Ongoing "running stopwatch" notification (#231).
 *
 * While a solo or shared stopwatch is running, an ongoing (non-dismissable)
 * Android notification shows the session name and elapsed time. The elapsed
 * time is rendered by Android's native notification chronometer, so it ticks
 * every second with no per-second JS wakeups — the app posts the notification
 * once on start and cancels it on stop/reset.
 *
 * Permission flow: POST_NOTIFICATIONS (Android 13+) is requested at most once,
 * the first time a stopwatch starts. If the user declines, we remember that
 * and never ask again — the stopwatch works normally without the notification.
 *
 * All calls are best-effort no-ops when the native module isn't compiled in
 * (e.g. before a native rebuild), so timing behavior is never affected.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import StopwatchNotification from "../modules/stopwatch-notification";

const PROMPTED_KEY = "notification_permission_prompted";

const NOTIFICATION_TEXT = "Stopwatch running — tap to return";

async function ensurePermission(): Promise<boolean> {
  if (!StopwatchNotification) return false;
  if (StopwatchNotification.hasPermission()) return true;

  // A single non-blocking prompt at most; if the user already declined once,
  // never nag again.
  const prompted = await AsyncStorage.getItem(PROMPTED_KEY);
  if (prompted !== null) return false;
  await AsyncStorage.setItem(PROMPTED_KEY, "1");
  return StopwatchNotification.requestPermission();
}

/**
 * Show (or replace) the ongoing notification for a running stopwatch.
 * `startedAtMs` is the epoch-millis zero point of the running clock
 * (`Date.now() - elapsedMs`), which drives the native chronometer.
 */
export async function showRunningNotification(
  title: string,
  startedAtMs: number
): Promise<void> {
  if (!StopwatchNotification) return;
  try {
    const granted = await ensurePermission();
    if (granted) {
      StopwatchNotification.show(title, NOTIFICATION_TEXT, startedAtMs);
    }
  } catch {
    // Best-effort: notifications must never break timing.
  }
}

/** Clear the ongoing notification (stop, reset, or leaving the stopwatch). */
export function clearRunningNotification(): void {
  try {
    StopwatchNotification?.clear();
  } catch {
    // Best-effort.
  }
}
