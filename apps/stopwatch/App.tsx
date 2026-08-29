/**
 * SplitSync Stopwatch — standalone solo stopwatch screen.
 *
 * Features:
 *  - Monotonic-clock timing anchored via AppState (stays accurate across background/foreground)
 *  - Start/stop (red pusher), Lap/Reset (black pusher)
 *  - Lap list with split time, cumulative time, best lap highlighted in yellow
 *  - Haptic feedback on every button press
 *  - useKeepAwake while running
 *  - "Time together" stub entry point for #184
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { AppStateStatus } from "react-native";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

// ── Suite palette ──────────────────────────────────────────────────────────────
// Mirrors apps/mobile/App.tsx colors and the web visual spec.
const colors = {
  racePaper: "#F5F0E8",
  black: "#1A1A1A",
  red: "#CC0000",
  yellow: "#FFD700",
  white: "#FFFFFF",
  muted: "#71717a",
  line: "#D4D0C8",
  panel: "#FFFFFF",
  bezelOuter: "#1A1A1A",
  bezelInner: "#2A2A2A",
  dial: "#F5F0E8",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Format elapsed milliseconds as M:SS.hh (e.g. "1:23.45"). */
function formatTime(ms: number): string {
  const totalHundredths = Math.floor(ms / 10);
  const hundredths = totalHundredths % 100;
  const totalSecs = Math.floor(ms / 1000);
  const secs = totalSecs % 60;
  const mins = Math.floor(totalSecs / 60);
  return `${mins}:${pad2(secs)}.${pad2(hundredths)}`;
}

/** Format a lap split time compactly as M:SS.hh. */
function formatSplit(ms: number): string {
  return formatTime(ms);
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface Lap {
  number: number;
  splitMs: number;      // this lap's duration
  cumulativeMs: number; // wall time at moment of lap press
}

type StopwatchState = "idle" | "running" | "paused";

// ── Main App ───────────────────────────────────────────────────────────────────

function Stopwatch() {
  useKeepAwake(); // prevent screen sleep while the component is mounted

  const { width } = useWindowDimensions();
  const dialSize = Math.min(width - 48, 340);

  // ── Timing state ────────────────────────────────────────────────────────────
  const [swState, setSwState] = useState<StopwatchState>("idle");
  const [displayMs, setDisplayMs] = useState(0);
  const [laps, setLaps] = useState<Lap[]>([]);

  // Monotonic anchor: absolute Date.now() timestamp when the current run started
  // (or resumed). Total elapsed at pause accumulates in accumulatedMs.
  const startAnchorRef = useRef<number | null>(null);
  const accumulatedMsRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Last lap cumulative so we can compute next split
  const lastLapCumulativeRef = useRef(0);

  // ── AppState background/foreground accuracy ──────────────────────────────────
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === "active"
      ) {
        // Returning to foreground: no state adjustment needed because we
        // always compute elapsed from (Date.now() - startAnchor + accumulated).
        // Just force a display refresh if running.
        if (startAnchorRef.current !== null) {
          setDisplayMs(accumulatedMsRef.current + Date.now() - startAnchorRef.current);
        }
      }
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, []);

  // ── Tick ────────────────────────────────────────────────────────────────────
  const startTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (startAnchorRef.current !== null) {
        setDisplayMs(accumulatedMsRef.current + Date.now() - startAnchorRef.current);
      }
    }, 30); // ~33 fps — smooth enough for centisecond display
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopTick();
  }, [stopTick]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleStartStop = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    setSwState((prev) => {
      if (prev === "idle" || prev === "paused") {
        // Start / resume
        startAnchorRef.current = Date.now();
        startTick();
        return "running";
      } else {
        // Stop / pause
        if (startAnchorRef.current !== null) {
          accumulatedMsRef.current += Date.now() - startAnchorRef.current;
          startAnchorRef.current = null;
        }
        stopTick();
        setDisplayMs(accumulatedMsRef.current);
        return "paused";
      }
    });
  }, [startTick, stopTick]);

  const handleLapReset = useCallback(() => {
    setSwState((prev) => {
      if (prev === "running") {
        // Lap
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const now = Date.now();
        const cumulative = accumulatedMsRef.current + (startAnchorRef.current !== null ? now - startAnchorRef.current : 0);
        const split = cumulative - lastLapCumulativeRef.current;
        lastLapCumulativeRef.current = cumulative;
        setLaps((existing) => [
          { number: existing.length + 1, splitMs: split, cumulativeMs: cumulative },
          ...existing,
        ]);
        return "running";
      } else if (prev === "paused" || prev === "idle") {
        // Reset
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        stopTick();
        startAnchorRef.current = null;
        accumulatedMsRef.current = 0;
        lastLapCumulativeRef.current = 0;
        setDisplayMs(0);
        setLaps([]);
        return "idle";
      }
      return prev;
    });
  }, [stopTick]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const isRunning = swState === "running";
  const canLapReset = swState !== "idle";

  // Best lap index (minimum split among all laps)
  const bestLapNumber: number | null = laps.length === 0
    ? null
    : laps.reduce((best, lap) => (lap.splitMs < best.splitMs ? lap : best), laps[0]).number;

  // ── Button labels ────────────────────────────────────────────────────────────
  const startStopLabel = isRunning ? "STOP" : swState === "paused" ? "RESUME" : "START";
  const lapResetLabel = isRunning ? "LAP" : "RESET";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.racePaper} translucent={false} />

      {/* Masthead */}
      <View style={styles.masthead}>
        <View style={styles.mastheadRow}>
          <Logo />
          <Text style={styles.mastheadKicker}>STOPWATCH</Text>
        </View>
      </View>

      {/* Circular bezel / dial */}
      <View style={styles.dialWrapper}>
        <View style={[styles.bezelOuter, { width: dialSize, height: dialSize, borderRadius: dialSize / 2 }]}>
          <View style={[styles.bezelInner, { width: dialSize - 12, height: dialSize - 12, borderRadius: (dialSize - 12) / 2 }]}>
            <View style={[styles.dial, { width: dialSize - 28, height: dialSize - 28, borderRadius: (dialSize - 28) / 2 }]}>
              {/* Elapsed display */}
              <Text style={styles.timeDisplay} numberOfLines={1} adjustsFontSizeToFit>
                {formatTime(displayMs)}
              </Text>

              {/* Current lap split — shown while running and at least 1 lap exists */}
              {laps.length > 0 && (
                <Text style={styles.currentSplitLabel}>
                  LAP {laps.length + 1}
                </Text>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Pushers row */}
      <View style={styles.pushersRow}>
        {/* Lap / Reset — black pusher (left) */}
        <Pressable
          onPress={canLapReset ? handleLapReset : undefined}
          style={({ pressed }) => [
            styles.pusher,
            styles.pusherBlack,
            pressed && canLapReset && styles.pusherPressed,
            !canLapReset && styles.pusherDisabled,
          ]}
          accessible
          accessibilityLabel={lapResetLabel}
          accessibilityRole="button"
        >
          <Text style={[styles.pusherLabel, !canLapReset && styles.pusherLabelDisabled]}>
            {lapResetLabel}
          </Text>
        </Pressable>

        {/* Start / Stop — red pusher (right) */}
        <Pressable
          onPress={handleStartStop}
          style={({ pressed }) => [
            styles.pusher,
            styles.pusherRed,
            pressed && styles.pusherRedPressed,
          ]}
          accessible
          accessibilityLabel={startStopLabel}
          accessibilityRole="button"
        >
          <Text style={styles.pusherLabelLight}>{startStopLabel}</Text>
        </Pressable>
      </View>

      {/* Lap list */}
      {laps.length > 0 && (
        <View style={styles.lapListWrapper}>
          {/* Header row */}
          <View style={[styles.lapRow, styles.lapHeaderRow]}>
            <Text style={[styles.lapCell, styles.lapHeaderText, styles.lapNumCell]}>LAP</Text>
            <Text style={[styles.lapCell, styles.lapHeaderText, styles.lapSplitCell]}>SPLIT</Text>
            <Text style={[styles.lapCell, styles.lapHeaderText, styles.lapCumCell]}>TIME</Text>
          </View>
          <FlatList
            data={laps}
            keyExtractor={(item) => String(item.number)}
            style={styles.lapList}
            renderItem={({ item }) => {
              const isBest = item.number === bestLapNumber && laps.length > 1;
              return (
                <View style={[styles.lapRow, isBest && styles.lapRowBest]}>
                  <Text style={[styles.lapCell, styles.lapNumCell, styles.lapNumText, isBest && styles.lapBestText]}>
                    {item.number}
                  </Text>
                  <Text style={[styles.lapCell, styles.lapSplitCell, styles.lapTimeText, isBest && styles.lapBestText]}>
                    {formatSplit(item.splitMs)}
                  </Text>
                  <Text style={[styles.lapCell, styles.lapCumCell, styles.lapTimeText, isBest && styles.lapBestText]}>
                    {formatSplit(item.cumulativeMs)}
                  </Text>
                </View>
              );
            }}
          />
        </View>
      )}

      {/* "Time together" stub — entry point for #184 */}
      <View style={styles.togetherWrapper}>
        <Pressable
          disabled
          style={styles.togetherBtn}
          accessible
          accessibilityLabel="Time together — coming soon"
          accessibilityRole="button"
        >
          <Text style={styles.togetherLabel}>⏱ TIME TOGETHER</Text>
          <Text style={styles.togetherSub}>COMING SOON</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// ── Logo ───────────────────────────────────────────────────────────────────────
// Matches the suite wordmark style from apps/mobile/App.tsx.
function Logo() {
  const W = 82;
  const H = 22;
  return (
    <View style={{ width: W, height: H, overflow: "hidden", borderRadius: 2 }}>
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.yellow }} />
      <View
        style={{
          position: "absolute",
          left: -6,
          top: 0,
          bottom: 0,
          width: 56,
          backgroundColor: colors.black,
          transform: [{ skewX: "-21.8deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 43,
          top: 0,
          bottom: 0,
          width: 3,
          backgroundColor: colors.racePaper,
          transform: [{ skewX: "-21.8deg" }],
        }}
      />
      <Text
        style={{
          position: "absolute",
          left: 0,
          width: 44,
          top: 0,
          height: H,
          textAlign: "center",
          lineHeight: H,
          color: colors.white,
          fontSize: 9,
          fontWeight: "900",
          letterSpacing: 1,
        }}
      >
        SPLIT
      </Text>
      <Text
        style={{
          position: "absolute",
          left: 46,
          right: 0,
          top: 0,
          height: H,
          textAlign: "center",
          lineHeight: H,
          color: colors.black,
          fontSize: 9,
          fontWeight: "900",
          letterSpacing: 1,
        }}
      >
        SYNC
      </Text>
    </View>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <SafeAreaProvider>
      <Stopwatch />
    </SafeAreaProvider>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const PUSHER_SIZE = 88;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.racePaper,
  },

  // ── Masthead
  masthead: {
    backgroundColor: colors.panel,
    borderBottomWidth: 2,
    borderColor: colors.black,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  mastheadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  mastheadKicker: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    color: colors.red,
  },

  // ── Dial / bezel
  dialWrapper: {
    alignItems: "center",
    paddingTop: 28,
    paddingBottom: 20,
  },
  bezelOuter: {
    backgroundColor: colors.bezelOuter,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.black,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  bezelInner: {
    backgroundColor: colors.bezelInner,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.08)",
  },
  dial: {
    backgroundColor: colors.dial,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: colors.black,
  },
  timeDisplay: {
    fontSize: 52,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    color: colors.black,
    letterSpacing: 2,
    paddingHorizontal: 10,
  },
  currentSplitLabel: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
    color: colors.muted,
    textTransform: "uppercase",
  },

  // ── Pushers
  pushersRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 32,
    paddingBottom: 20,
  },
  pusher: {
    width: PUSHER_SIZE,
    height: PUSHER_SIZE,
    borderRadius: PUSHER_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  pusherBlack: {
    backgroundColor: colors.black,
    borderColor: "#444",
    shadowColor: colors.black,
  },
  pusherRed: {
    backgroundColor: colors.red,
    borderColor: "#990000",
    shadowColor: colors.red,
  },
  pusherPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.95 }],
  },
  pusherRedPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
  pusherDisabled: {
    opacity: 0.35,
  },
  pusherLabel: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  pusherLabelLight: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  pusherLabelDisabled: {
    color: "rgba(255,255,255,0.4)",
  },

  // ── Lap list (dense square-table style)
  lapListWrapper: {
    flex: 1,
    marginHorizontal: 20,
    borderWidth: 2,
    borderColor: colors.black,
    backgroundColor: colors.panel,
    marginBottom: 12,
  },
  lapList: {
    flex: 1,
  },
  lapRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  lapHeaderRow: {
    backgroundColor: colors.black,
    borderBottomWidth: 2,
    borderColor: colors.black,
  },
  lapRowBest: {
    backgroundColor: "rgba(255, 215, 0, 0.18)",
  },
  lapCell: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  lapHeaderText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  lapNumCell: {
    width: 44,
  },
  lapSplitCell: {
    flex: 1,
  },
  lapCumCell: {
    flex: 1,
    textAlign: "right",
  },
  lapNumText: {
    color: colors.muted,
    fontWeight: "700",
  },
  lapTimeText: {
    color: colors.black,
    fontWeight: "700",
  },
  lapBestText: {
    color: "#8B6914",
    fontWeight: "900",
  },

  // ── "Time together" stub
  togetherWrapper: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  togetherBtn: {
    borderWidth: 2,
    borderColor: colors.line,
    borderStyle: "dashed",
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    opacity: 0.5,
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
  },
  togetherLabel: {
    color: colors.black,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  togetherSub: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
