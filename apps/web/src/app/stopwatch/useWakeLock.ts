"use client";

import { useEffect, useRef } from "react";

/**
 * useWakeLock — acquires a Screen Wake Lock while `active` is true.
 *
 * - Gracefully no-ops on browsers without the Wake Lock API.
 * - Re-acquires the lock on `visibilitychange` to "visible" because the
 *   browser automatically releases wake locks when the tab is hidden.
 * - All async errors are caught and logged; they are never thrown to the UI.
 */
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    // Bail out if the API is not available (Firefox, older Safari, etc.)
    if (!("wakeLock" in navigator)) return;

    let cancelled = false;

    async function acquire() {
      if (cancelled) return;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          // The effect cleaned up while the request was in flight — release
          // the just-acquired sentinel instead of leaking it.
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
      } catch (err) {
        // NotAllowedError when page is not visible; DOMException on other
        // browsers that partially implement the spec — both are safe to ignore.
        console.warn("[useWakeLock] Failed to acquire wake lock:", err);
      }
    }

    async function release() {
      if (sentinelRef.current) {
        try {
          await sentinelRef.current.release();
        } catch (err) {
          console.warn("[useWakeLock] Failed to release wake lock:", err);
        }
        sentinelRef.current = null;
      }
    }

    // Re-acquire when the tab becomes visible again (browsers auto-release on
    // tab hide, so we need to reclaim the lock when the user returns).
    async function handleVisibilityChange() {
      if (!active || document.visibilityState !== "visible") return;
      // Only re-acquire if we no longer hold the lock
      if (!sentinelRef.current || sentinelRef.current.released) {
        await acquire();
      }
    }

    if (active) {
      acquire();
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      release();
    };
  }, [active]);
}
