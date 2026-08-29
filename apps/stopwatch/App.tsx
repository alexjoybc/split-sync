/**
 * SplitSync Stopwatch — real-stopwatch UI.
 *
 * Layout mirrors a physical chronograph:
 *  - Crown protruding at 12 o'clock (top)
 *  - LAP/RESET pusher on the LEFT side of the case
 *  - START/STOP pusher (red) on the RIGHT side of the case
 *  - 60-tick bezel ring with graduated marks
 *  - Dial face fills the screen center
 *  - Lap table below the case
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// ── Palette ────────────────────────────────────────────────────────────────────
const C = {
  paper:       "#F5F0E8",
  black:       "#1A1A1A",
  red:         "#CC0000",
  redDark:     "#8B0000",
  redLight:    "#FF3333",
  yellow:      "#FFD700",
  yellowDark:  "#8B6914",
  white:       "#FFFFFF",
  muted:       "#888880",
  line:        "#D4D0C8",
  // Case / bezel
  caseOuter:   "#111111",
  caseMid:     "#242424",
  caseLug:     "#1A1A1A",
  bezelRing:   "#0D0D0D",
  chromeHigh:  "rgba(255,255,255,0.12)",
  // Pusher chrome
  pusherBody:  "#2A2A2A",
  pusherShine: "rgba(255,255,255,0.15)",
  pusherSide:  "#0D0D0D",
};

// ── Types ──────────────────────────────────────────────────────────────────────
interface Lap {
  number: number;
  splitMs: number;
  cumulativeMs: number;
}
type SwState = "idle" | "running" | "paused";

// ── Helpers ────────────────────────────────────────────────────────────────────
function pad2(n: number) { return String(n).padStart(2, "0"); }

function formatTime(ms: number) {
  const cs  = Math.floor(ms / 10) % 100;
  const s   = Math.floor(ms / 1000) % 60;
  const m   = Math.floor(ms / 60000);
  return `${m}:${pad2(s)}.${pad2(cs)}`;
}

// ── Tick marks on the bezel ────────────────────────────────────────────────────
function BezelTicks({ size }: { size: number }) {
  const r = size / 2;
  const ticks = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => {
      const isQuarter = i % 15 === 0;
      const isMajor   = i % 5 === 0;
      const tickLen   = isQuarter ? 18 : isMajor ? 13 : 7;
      const tickW     = isQuarter ? 3   : isMajor ? 2   : 1.5;
      const color     = isQuarter ? C.white : isMajor ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)";
      const outerR    = r - 5;
      const innerR    = outerR - tickLen;
      const angle     = (i / 60) * 2 * Math.PI - Math.PI / 2;
      const ox = r + outerR * Math.cos(angle);
      const oy = r + outerR * Math.sin(angle);
      const ix = r + innerR * Math.cos(angle);
      const iy = r + innerR * Math.sin(angle);
      const mx = (ox + ix) / 2;
      const my = (oy + iy) / 2;
      const rot = (i / 60) * 360;
      return { mx, my, tickLen, tickW, color, rot, key: i };
    });
  }, [size, r]);

  return (
    <>
      {ticks.map(({ key, mx, my, tickLen, tickW, color, rot }) => (
        <View
          key={key}
          pointerEvents="none"
          style={{
            position: "absolute",
            width: tickW,
            height: tickLen,
            backgroundColor: color,
            left: mx - tickW / 2,
            top:  my - tickLen / 2,
            transform: [{ rotate: `${rot}deg` }],
          }}
        />
      ))}
    </>
  );
}

// ── Pusher (side button) ───────────────────────────────────────────────────────
interface PusherProps {
  side: "left" | "right";
  label: string;
  disabled?: boolean;
  red?: boolean;
  onPress: () => void;
}
function Pusher({ side, label, disabled, red, onPress }: PusherProps) {
  const W = 22;
  const H = 64;
  const bg  = red ? C.red  : C.pusherBody;
  const top = red ? C.redLight : C.chromeHigh;
  const bot = red ? C.redDark  : C.pusherSide;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={{ opacity: disabled ? 0.35 : 1 }}
      accessible
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      {({ pressed }) => (
        <View
          style={{
            width: W,
            height: H,
            borderRadius: 5,
            backgroundColor: pressed ? bot : bg,
            // Chrome bevel via border trick
            borderTopWidth: 2,
            borderBottomWidth: 3,
            borderLeftWidth:   side === "right" ? 1 : 3,
            borderRightWidth:  side === "left"  ? 1 : 3,
            borderTopColor:    top,
            borderBottomColor: bot,
            borderLeftColor:   side === "right" ? top : bot,
            borderRightColor:  side === "left"  ? top : bot,
            shadowColor: "#000",
            shadowOpacity: 0.6,
            shadowRadius: 6,
            shadowOffset: { width: side === "left" ? -2 : 2, height: 3 },
            elevation: 8,
            transform: pressed ? [{ scaleX: 0.88 }] : [],
          }}
        />
      )}
    </Pressable>
  );
}

// ── Main stopwatch component ───────────────────────────────────────────────────
function Stopwatch() {
  useKeepAwake();
  const { width, height } = useWindowDimensions();

  // Case fills most of the narrow dimension; leave room for pushers
  const PUSHER_W   = 22;
  const PUSHER_GAP = 6;
  const caseSize   = Math.min(width - (PUSHER_W + PUSHER_GAP) * 2 - 16, height * 0.52, 340);

  // ── State ──────────────────────────────────────────────────────────────────
  const [swState, setSwState] = useState<SwState>("idle");
  const [displayMs, setDisplayMs] = useState(0);
  const [laps, setLaps] = useState<Lap[]>([]);

  const startAnchor  = useRef<number | null>(null);
  const accumulated  = useRef(0);
  const lastLapCum   = useRef(0);
  const tickRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef  = useRef<AppStateStatus>(AppState.currentState);

  // ── Background accuracy ────────────────────────────────────────────────────
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (appStateRef.current.match(/inactive|background/) && next === "active") {
        if (startAnchor.current !== null) {
          setDisplayMs(accumulated.current + Date.now() - startAnchor.current);
        }
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, []);

  // ── Tick ───────────────────────────────────────────────────────────────────
  const startTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (startAnchor.current !== null)
        setDisplayMs(accumulated.current + Date.now() - startAnchor.current);
    }, 30);
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  useEffect(() => () => stopTick(), [stopTick]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleStartStop = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSwState((prev) => {
      if (prev === "idle" || prev === "paused") {
        startAnchor.current = Date.now();
        startTick();
        return "running";
      } else {
        if (startAnchor.current !== null) {
          accumulated.current += Date.now() - startAnchor.current;
          startAnchor.current = null;
        }
        stopTick();
        setDisplayMs(accumulated.current);
        return "paused";
      }
    });
  }, [startTick, stopTick]);

  const handleLapReset = useCallback(() => {
    setSwState((prev) => {
      if (prev === "running") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const now = Date.now();
        const cum = accumulated.current + (startAnchor.current !== null ? now - startAnchor.current : 0);
        const split = cum - lastLapCum.current;
        lastLapCum.current = cum;
        setLaps((old) => [{ number: old.length + 1, splitMs: split, cumulativeMs: cum }, ...old]);
        return "running";
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        stopTick();
        startAnchor.current = null;
        accumulated.current = 0;
        lastLapCum.current = 0;
        setDisplayMs(0);
        setLaps([]);
        return "idle";
      }
    });
  }, [stopTick]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const isRunning  = swState === "running";
  const canAct     = swState !== "idle";
  const startLabel = isRunning ? "STOP" : swState === "paused" ? "RUN" : "START";
  const lapLabel   = isRunning ? "LAP" : "RESET";
  const bestNum    = laps.length < 2 ? null
    : laps.reduce((b, l) => l.splitMs < b.splitMs ? l : b, laps[0]).number;

  // ── Bezel geometry ─────────────────────────────────────────────────────────
  const CROWN_W = 18;
  const CROWN_H = 28;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.paper} />

      {/* ── Tiny logo strip ── */}
      <View style={styles.logoRow}>
        <View style={styles.logoChip}>
          <Text style={styles.logoSplit}>SPLIT</Text>
          <Text style={styles.logoSync}>SYNC</Text>
        </View>
        <Text style={styles.logoKicker}>STOPWATCH</Text>
      </View>

      {/* ── Watch body ── */}
      <View style={styles.watchWrapper}>

        {/* Crown at 12 o'clock */}
        <View style={[styles.crown, { width: CROWN_W, height: CROWN_H, alignSelf: "center" }]} />

        {/* Case row: [left pusher] [case] [right pusher] */}
        <View style={styles.caseRow}>

          {/* LEFT pusher: LAP / RESET */}
          <View style={[styles.pusherSlot, { marginRight: PUSHER_GAP }]}>
            <Pusher
              side="left"
              label={lapLabel}
              disabled={!canAct}
              onPress={handleLapReset}
            />
          </View>

          {/* ── Main case ── */}
          <View
            style={[
              styles.caseOuter,
              { width: caseSize, height: caseSize, borderRadius: caseSize / 2 },
            ]}
          >
            {/* Bezel ring with tick marks */}
            <View
              style={[
                styles.bezel,
                {
                  width: caseSize - 6,
                  height: caseSize - 6,
                  borderRadius: (caseSize - 6) / 2,
                },
              ]}
            >
              <BezelTicks size={caseSize - 6} />

              {/* Inner dial */}
              <View
                style={[
                  styles.dial,
                  {
                    width: caseSize - 56,
                    height: caseSize - 56,
                    borderRadius: (caseSize - 56) / 2,
                  },
                ]}
              >
                {/* Sub-label */}
                <Text style={styles.dialBrand}>SplitSync</Text>

                {/* Main time */}
                <Text style={styles.timeMain} numberOfLines={1} adjustsFontSizeToFit>
                  {formatTime(displayMs)}
                </Text>

                {/* Current lap indicator */}
                {laps.length > 0 && (
                  <Text style={styles.lapIndicator}>LAP {laps.length + 1}</Text>
                )}

                {/* State ring indicator */}
                <View
                  style={[
                    styles.stateRing,
                    isRunning  && styles.stateRingRun,
                    swState === "paused" && styles.stateRingPaused,
                  ]}
                />
              </View>
            </View>
          </View>

          {/* RIGHT pusher: START / STOP (red) */}
          <View style={[styles.pusherSlot, { marginLeft: PUSHER_GAP }]}>
            <Pusher
              side="right"
              label={startLabel}
              red
              onPress={handleStartStop}
            />
          </View>
        </View>

        {/* Bottom lug */}
        <View style={styles.lug} />
      </View>

      {/* ── Pusher labels under the pushers ── */}
      <View style={styles.pusherLabels}>
        <Text style={[styles.pusherLabelText, { opacity: canAct ? 1 : 0.35 }]}>{lapLabel}</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.pusherLabelText}>{startLabel}</Text>
      </View>

      {/* ── Lap list ── */}
      {laps.length > 0 ? (
        <View style={styles.lapTableWrapper}>
          <View style={styles.lapHeader}>
            <Text style={[styles.lapHeaderCell, styles.lapNumCol]}>LAP</Text>
            <Text style={[styles.lapHeaderCell, styles.lapSplitCol]}>SPLIT</Text>
            <Text style={[styles.lapHeaderCell, styles.lapCumCol]}>TIME</Text>
          </View>
          <FlatList
            data={laps}
            keyExtractor={(l) => String(l.number)}
            style={styles.lapList}
            renderItem={({ item }) => {
              const best = item.number === bestNum;
              return (
                <View style={[styles.lapRow, best && styles.lapRowBest]}>
                  <Text style={[styles.lapCell, styles.lapNumCol, styles.lapNum, best && styles.lapBest]}>
                    {item.number}
                  </Text>
                  <Text style={[styles.lapCell, styles.lapSplitCol, styles.lapTime, best && styles.lapBest]}>
                    {formatTime(item.splitMs)}
                  </Text>
                  <Text style={[styles.lapCell, styles.lapCumCol, styles.lapTime, best && styles.lapBest]}>
                    {formatTime(item.cumulativeMs)}
                  </Text>
                </View>
              );
            }}
          />
        </View>
      ) : (
        /* "Time together" stub — entry point for #184 */
        <View style={styles.togetherWrapper}>
          <Pressable
            disabled
            style={styles.togetherBtn}
            accessible
            accessibilityLabel="Time together — coming soon"
          >
            <Text style={styles.togetherLabel}>⏱  TIME TOGETHER</Text>
            <Text style={styles.togetherSub}>SHARE SESSION · COMING SOON</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
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
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.paper,
  },

  // Logo strip
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 6,
    gap: 8,
  },
  logoChip: {
    flexDirection: "row",
    backgroundColor: C.black,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 2,
    gap: 4,
  },
  logoSplit: {
    color: C.white,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  logoSync: {
    color: C.yellow,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  logoKicker: {
    color: C.black,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 3,
    opacity: 0.5,
  },

  // Watch body wrapper
  watchWrapper: {
    alignItems: "center",
    paddingTop: 0,
    paddingBottom: 4,
  },

  // Crown at 12 o'clock
  crown: {
    backgroundColor: C.caseLug,
    borderRadius: 4,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderTopWidth: 2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopColor: "rgba(255,255,255,0.15)",
    borderLeftColor: C.pusherSide,
    borderRightColor: C.pusherSide,
    marginBottom: -1,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: -2 },
    elevation: 4,
  },

  // Case row (pusher | case | pusher)
  caseRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  pusherSlot: {
    justifyContent: "center",
    alignItems: "center",
  },

  // Outer case ring (darkest, deepest layer)
  caseOuter: {
    backgroundColor: C.caseOuter,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.7,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 20,
    // High-specular edge highlight
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.08)",
  },

  // Bezel ring (contains tick marks and the inner dial)
  bezel: {
    backgroundColor: C.bezelRing,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.06)",
  },

  // Dial face
  dial: {
    backgroundColor: C.paper,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: C.black,
    // Slight inset shadow illusion
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },

  dialBrand: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 2,
    color: C.muted,
    textTransform: "uppercase",
    marginBottom: 2,
  },

  timeMain: {
    fontSize: 46,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    color: C.black,
    letterSpacing: 1,
    lineHeight: 54,
  },

  lapIndicator: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    color: C.muted,
    marginTop: 2,
  },

  stateRing: {
    position: "absolute",
    bottom: 18,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.muted,
    opacity: 0.3,
  },
  stateRingRun: {
    backgroundColor: C.red,
    opacity: 1,
  },
  stateRingPaused: {
    backgroundColor: C.yellow,
    opacity: 1,
  },

  // Bottom lug
  lug: {
    width: 20,
    height: 10,
    backgroundColor: C.caseLug,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    marginTop: -1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomColor: C.pusherSide,
    borderLeftColor: C.pusherSide,
    borderRightColor: C.pusherSide,
  },

  // Pusher labels
  pusherLabels: {
    flexDirection: "row",
    paddingHorizontal: 12,
    marginTop: 4,
    marginBottom: 10,
  },
  pusherLabelText: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
    color: C.black,
    opacity: 0.5,
  },

  // Lap table
  lapTableWrapper: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: C.black,
    backgroundColor: C.white,
    overflow: "hidden",
  },
  lapHeader: {
    flexDirection: "row",
    backgroundColor: C.black,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  lapHeaderCell: {
    color: C.white,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  lapList: { flex: 1 },
  lapRow: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderColor: C.line,
    alignItems: "center",
  },
  lapRowBest: { backgroundColor: "rgba(255,215,0,0.18)" },
  lapCell: { fontSize: 13, fontVariant: ["tabular-nums"] },
  lapNum:  { color: C.muted, fontWeight: "700" },
  lapTime: { color: C.black, fontWeight: "700" },
  lapBest: { color: C.yellowDark, fontWeight: "900" },
  lapNumCol:   { width: 40 },
  lapSplitCol: { flex: 1 },
  lapCumCol:   { flex: 1, textAlign: "right" },

  // Time together stub
  togetherWrapper: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  togetherBtn: {
    borderWidth: 1.5,
    borderColor: C.line,
    borderStyle: "dashed",
    paddingVertical: 16,
    alignItems: "center",
    opacity: 0.5,
  },
  togetherLabel: {
    color: C.black,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  togetherSub: {
    color: C.muted,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 3,
  },
});
