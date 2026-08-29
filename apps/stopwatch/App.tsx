/**
 * SplitSync Stopwatch
 *
 * Design: digitalized device feel in SplitSync's visual language.
 * - Dark device casing (masthead + button bar)
 * - Inset LCD instrument panel — DSEG7 amber digits on black
 * - Race-paper content area — dense lap table with Δ best
 * - Physical raised buttons with bevel + press-down shadow
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
import { useFonts } from "expo-font";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

// ── Palette ────────────────────────────────────────────────────────────────────
const C = {
  // Device casing
  casing:       "#1A1A1A",
  casingBorder: "#0A0A0A",

  // LCD instrument panel
  instrument:   "#0D0D0D",
  lcd:          "#FFA800",   // amber — Ultrak 4 / classic LCD
  lcdDim:       "#2C1A00",   // off-segment ghost
  lcdSmall:     "#FF7A00",   // session sub-display

  // SplitSync content surfaces
  paper:        "#F5F0E8",
  white:        "#FFFFFF",
  ink:          "#1A1A1A",
  rule:         "#1A1A1A",
  line:         "#D4D0C8",
  panelBg:      "#EDEAE0",
  muted:        "#888880",

  // Brand
  red:          "#CC0000",
  yellow:       "#FFD700",
  yellowBg:     "rgba(255,215,0,0.20)",
  yellowDark:   "#7A5C00",
  green:        "#007A30",
  worse:        "#CC3300",

  // Button surfaces — each has body / top-edge / bottom-edge
  btnRedBody:   "#BB1100",
  btnRedHi:     "#EE3322",
  btnRedLo:     "#770800",
  btnInkBody:   "#2A2A2A",
  btnInkHi:     "#555555",
  btnInkLo:     "#000000",
  btnPaperBody: "#E8E3D8",
  btnPaperHi:   "#F8F3E8",
  btnPaperLo:   "#B8B3A8",
  btnDimBody:   "#1E1E1E",
  btnDimHi:     "#2A2A2A",
  btnDimLo:     "#0A0A0A",
};

// ── Types ──────────────────────────────────────────────────────────────────────
interface Lap { number: number; splitMs: number; cumulativeMs: number; }
type SwState = "idle" | "running" | "paused";

// ── Helpers ────────────────────────────────────────────────────────────────────
const p2 = (n: number) => String(Math.floor(n)).padStart(2, "0");

function fmtParts(ms: number) {
  const cs = Math.floor(ms / 10) % 100;
  const s  = Math.floor(ms / 1000) % 60;
  const m  = Math.floor(ms / 60000);
  return { main: `${m}:${p2(s)}`, cs: p2(cs) };
}

function fmtCompact(ms: number) {
  const { main, cs } = fmtParts(ms);
  return `${main}.${cs}`;
}

function fmtDelta(d: number) {
  const abs  = Math.abs(d);
  const cs   = Math.floor(abs / 10) % 100;
  const s    = Math.floor(abs / 1000) % 60;
  const m    = Math.floor(abs / 60000);
  const sign = d >= 0 ? "+" : "-";
  return m > 0 ? `${sign}${m}:${p2(s)}.${p2(cs)}` : `${sign}${s}.${p2(cs)}`;
}

// ── LCD display — DSEG7 with ghost segments ───────────────────────────────────
// Two sibling Views in a nowrap row so centiseconds NEVER wrap.
function LcdDisplay({
  ms, mainSize, csRatio = 0.54, color = C.lcd, dimColor = C.lcdDim, fontLoaded,
}: {
  ms: number; mainSize: number; csRatio?: number; color?: string; dimColor?: string; fontLoaded: boolean;
}) {
  const { main, cs } = fmtParts(ms);
  const csSize  = Math.round(mainSize * csRatio);
  const font    = fontLoaded ? "DSEG7Classic-Regular" : "monospace";

  // Ghost dims: replace digits with "8" (all segments lit in DSEG7)
  const mainDim = main.replace(/\d/g, "8");  // "8:88"
  const csDim   = cs.replace(/\d/g, "8");    // "88"

  // Vertical baseline alignment: cs sits bottom-aligned with main
  const baselineOffset = Math.round((mainSize - csSize) * 0.78);

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", flexWrap: "nowrap" }}>
      {/* M:SS */}
      <View style={{ flexShrink: 0 }}>
        <Text style={{ fontFamily: font, fontSize: mainSize, color: dimColor, letterSpacing: 3, includeFontPadding: false }}
          numberOfLines={1} allowFontScaling={false}>
          {mainDim}
        </Text>
        <Text style={{ fontFamily: font, fontSize: mainSize, color, letterSpacing: 3, includeFontPadding: false, position: "absolute", top: 0, left: 0 }}
          numberOfLines={1} allowFontScaling={false}>
          {main}
        </Text>
      </View>

      {/* Decimal point separator */}
      <View style={{ flexShrink: 0, marginBottom: Math.round(mainSize * 0.08) }}>
        <Text style={{ fontFamily: font, fontSize: csSize, color: dimColor, includeFontPadding: false }}
          numberOfLines={1} allowFontScaling={false}>.</Text>
        <Text style={{ fontFamily: font, fontSize: csSize, color, includeFontPadding: false, position: "absolute", top: 0, left: 0 }}
          numberOfLines={1} allowFontScaling={false}>.</Text>
      </View>

      {/* CS */}
      <View style={{ flexShrink: 0 }}>
        <Text style={{ fontFamily: font, fontSize: csSize, color: dimColor, letterSpacing: 3, includeFontPadding: false }}
          numberOfLines={1} allowFontScaling={false}>
          {csDim}
        </Text>
        <Text style={{ fontFamily: font, fontSize: csSize, color, letterSpacing: 3, includeFontPadding: false, position: "absolute", top: 0, left: 0 }}
          numberOfLines={1} allowFontScaling={false}>
          {cs}
        </Text>
      </View>
    </View>
  );
}

// ── Device button — raised physical feel ─────────────────────────────────────
interface BtnProps {
  label: string;
  sub?: string;
  body: string; hi: string; lo: string;
  textColor?: string;
  disabled?: boolean;
  flex?: number;
  onPress: () => void;
}
function DeviceBtn({ label, sub, body, hi, lo, textColor = C.white, disabled, flex = 1, onPress }: BtnProps) {
  const bg  = disabled ? C.btnDimBody  : body;
  const top = disabled ? C.btnDimHi    : hi;
  const bot = disabled ? C.btnDimLo    : lo;
  const txt = disabled ? "#444444" : textColor;

  return (
    <Pressable onPress={disabled ? undefined : onPress} style={{ flex }}
      accessible accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => (
        <View style={{
          height: 68,
          borderRadius: 6,
          backgroundColor: pressed ? bot : bg,
          // Physical bevel: lighter top edge, darker bottom
          borderTopWidth:    pressed ? 1 : 3,
          borderBottomWidth: pressed ? 5 : 3,
          borderLeftWidth: 1.5,
          borderRightWidth: 1.5,
          borderTopColor:    pressed ? bg : top,
          borderBottomColor: bot,
          borderLeftColor:   pressed ? bg : top,
          borderRightColor:  bot,
          // Shadow lifts button off surface
          shadowColor:   "#000",
          shadowOpacity: pressed ? 0.1 : 0.55,
          shadowRadius:  pressed ? 1   : 5,
          shadowOffset:  { width: 0, height: pressed ? 1 : 4 },
          elevation:     pressed ? 1   : 8,
          // Translate down when pressed to sell the push
          transform: pressed ? [{ translateY: 2 }] : [{ translateY: 0 }],
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 4,
        }}>
          {sub && (
            <Text style={{ color: pressed ? "#888" : (disabled ? "#333" : "rgba(255,255,255,0.5)"), fontSize: 9, fontWeight: "900", letterSpacing: 2, marginBottom: 1 }}>
              {sub}
            </Text>
          )}
          <Text style={{ color: txt, fontSize: 14, fontWeight: "900", letterSpacing: 1.5 }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// ── Stopwatch ──────────────────────────────────────────────────────────────────
function Stopwatch() {
  useKeepAwake();
  const { width } = useWindowDimensions();

  const [fontsLoaded] = useFonts({
    "DSEG7Classic-Regular": require("./assets/fonts/DSEG7Classic-Regular.ttf"),
  });

  // ── Timing ─────────────────────────────────────────────────────────────────
  const [swState,   setSw]        = useState<SwState>("idle");
  const [sessionMs, setSession]   = useState(0);
  const [lapMs,     setLapMs]     = useState(0);
  const [laps,      setLaps]      = useState<Lap[]>([]);

  const anchor    = useRef<number | null>(null);
  const accum     = useRef(0);
  const lastLapCum= useRef(0);
  const tickRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const appState  = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (appState.current.match(/inactive|background/) && next === "active" && anchor.current !== null) {
        const t = accum.current + Date.now() - anchor.current;
        setSession(t); setLapMs(t - lastLapCum.current);
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  const startTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (anchor.current !== null) {
        const t = accum.current + Date.now() - anchor.current;
        setSession(t); setLapMs(t - lastLapCum.current);
      }
    }, 30);
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  useEffect(() => () => stopTick(), [stopTick]);

  const handleStart = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    anchor.current = Date.now(); startTick(); setSw("running");
  }, [startTick]);

  const handleStop = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (anchor.current !== null) { accum.current += Date.now() - anchor.current; anchor.current = null; }
    stopTick();
    setSession(accum.current); setLapMs(accum.current - lastLapCum.current);
    setSw("paused");
  }, [stopTick]);

  const handleLap = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const now = Date.now();
    const cum = accum.current + (anchor.current !== null ? now - anchor.current : 0);
    const split = cum - lastLapCum.current;
    lastLapCum.current = cum;
    setLapMs(0);
    setLaps((prev) => [{ number: prev.length + 1, splitMs: split, cumulativeMs: cum }, ...prev]);
  }, []);

  const handleReset = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    stopTick(); anchor.current = null; accum.current = 0; lastLapCum.current = 0;
    setSession(0); setLapMs(0); setLaps([]); setSw("idle");
  }, [stopTick]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const isRunning = swState === "running";
  const isPaused  = swState === "paused";
  const isIdle    = swState === "idle";
  const lapCount  = laps.length;
  const lastLap   = laps[0] ?? null;
  const bestMs    = useMemo(() =>
    laps.length < 2 ? null : Math.min(...laps.map(l => l.splitMs)), [laps]);

  // Scale LCD to screen width — leave horizontal padding for the panel
  const lcdMain = Math.min(Math.floor((width - 40) / 7.2), 72);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />

      {/* ── Device top casing ── */}
      <View style={s.casing}>
        <View style={s.casingLeft}>
          <View style={s.logoChip}>
            <Text style={s.logoSplit}>SPLIT</Text>
            <Text style={s.logoSync}>SYNC</Text>
          </View>
          <Text style={s.casingTitle}>STOPWATCH</Text>
        </View>
        {/* State indicator */}
        <View style={[s.pill,
          isRunning && { backgroundColor: C.red,    borderColor: C.red },
          isPaused  && { backgroundColor: C.yellow, borderColor: C.yellow },
        ]}>
          <Text style={[s.pillTxt,
            isRunning && { color: C.white },
            isPaused  && { color: C.ink },
          ]}>
            {isRunning ? "● RUN" : isPaused ? "‖ PAUSED" : "READY"}
          </Text>
        </View>
      </View>

      {/* ── LCD instrument panel ── */}
      <View style={s.instrument}>
        {/* Current lap label */}
        <View style={s.instrHeader}>
          <Text style={s.instrLabel}>
            {isIdle ? "LAP TIME" : `LAP ${lapCount + 1}`}
          </Text>
        </View>

        {/* Primary time — current lap, large */}
        <View style={s.instrMain}>
          <LcdDisplay
            ms={lapMs}
            mainSize={lcdMain}
            fontLoaded={!!fontsLoaded}
          />
        </View>

        {/* Session row — smaller, different hue */}
        <View style={s.instrFooter}>
          <Text style={s.instrLabel}>TOTAL SESSION</Text>
          <LcdDisplay
            ms={sessionMs}
            mainSize={Math.round(lcdMain * 0.42)}
            color={C.lcdSmall}
            dimColor="#1A0D00"
            fontLoaded={!!fontsLoaded}
          />
        </View>
      </View>

      {/* ── Last lap strip ── */}
      {lastLap && (
        <View style={s.lastLap}>
          <View>
            <Text style={s.lastLapTitle}>LAST LAP</Text>
            <Text style={s.lastLapSub}>Lap {lastLap.number}</Text>
          </View>
          <Text style={s.lastLapTime}>{fmtCompact(lastLap.splitMs)}</Text>
        </View>
      )}

      {/* ── Lap table ── */}
      {lapCount > 0 ? (
        <View style={s.table}>
          <View style={s.tableHead}>
            <Text style={[s.th, s.cLap]}>LAP</Text>
            <Text style={[s.th, s.cSplit]}>SPLIT</Text>
            <Text style={[s.th, s.cTime]}>TIME</Text>
            <Text style={[s.th, s.cDelta, { textAlign: "right" }]}>Δ BEST</Text>
          </View>
          <FlatList
            data={laps}
            keyExtractor={l => String(l.number)}
            style={{ flex: 1 }}
            renderItem={({ item }) => {
              const isBest = bestMs !== null && item.splitMs === bestMs;
              const delta  = bestMs !== null && !isBest ? item.splitMs - bestMs : null;
              return (
                <View style={[s.tableRow, isBest && s.rowBest]}>
                  <Text style={[s.td, s.cLap, { color: C.muted }]}>{item.number}</Text>
                  <Text style={[s.td, s.cSplit, isBest && { color: C.yellowDark, fontWeight: "900" }]}>
                    {fmtCompact(item.splitMs)}
                  </Text>
                  <Text style={[s.td, s.cTime, { color: C.muted }]}>
                    {fmtCompact(item.cumulativeMs)}
                  </Text>
                  <View style={[s.cDelta, { alignItems: "flex-end" }]}>
                    {isBest
                      ? <Text style={[s.td, { color: C.green, fontWeight: "900" }]}>BEST</Text>
                      : delta !== null
                        ? <Text style={[s.td, { color: delta > 0 ? C.worse : C.green }]}>{fmtDelta(delta)}</Text>
                        : <Text style={[s.td, { color: C.muted }]}>—</Text>
                    }
                  </View>
                </View>
              );
            }}
          />
        </View>
      ) : (
        <View style={s.together}>
          <Pressable disabled style={s.togetherBtn} accessible accessibilityLabel="Time together — coming soon">
            <Text style={s.togetherLabel}>⏱  TIME TOGETHER</Text>
            <Text style={s.togetherSub}>SHARE SESSION · COMING SOON</Text>
          </Pressable>
        </View>
      )}

      {/* ── Device bottom casing — button bar ── */}
      <View style={s.btnCasing}>
        <DeviceBtn
          label="LAP"
          sub={lapCount > 0 ? `0${lapCount + 1}`.slice(-2) : undefined}
          body={C.btnInkBody} hi={C.btnInkHi} lo={C.btnInkLo}
          disabled={!isRunning}
          onPress={handleLap}
        />
        <View style={{ width: 10 }} />
        {isRunning
          ? <DeviceBtn label="STOP"  body={C.btnRedBody}  hi={C.btnRedHi}  lo={C.btnRedLo}  onPress={handleStop}  flex={1.4} />
          : <DeviceBtn label={isPaused ? "RESUME" : "START"} body={C.btnInkBody} hi={C.btnInkHi} lo={C.btnInkLo} onPress={handleStart} flex={1.4} />
        }
        <View style={{ width: 10 }} />
        <DeviceBtn
          label="RESET"
          body={C.btnPaperBody} hi={C.btnPaperHi} lo={C.btnPaperLo}
          textColor={C.ink}
          disabled={isIdle}
          onPress={handleReset}
        />
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><Stopwatch /></SafeAreaProvider>;
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.paper },

  // Device casing — top
  casing: {
    backgroundColor: C.casing,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: 3,
    borderColor: C.casingBorder,
  },
  casingLeft:  { flexDirection: "row", alignItems: "center", gap: 10 },
  logoChip:    { flexDirection: "row", backgroundColor: "#000", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 2, gap: 3 },
  logoSplit:   { color: C.white,  fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  logoSync:    { color: C.yellow, fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  casingTitle: { color: "#555550", fontSize: 10, fontWeight: "900", letterSpacing: 3 },
  pill: {
    borderWidth: 1.5, borderColor: "#333", borderRadius: 20,
    paddingHorizontal: 9, paddingVertical: 3,
  },
  pillTxt: { color: "#555550", fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },

  // LCD instrument panel
  instrument: {
    backgroundColor: C.instrument,
    borderBottomWidth: 3,
    borderColor: C.casingBorder,
  },
  instrHeader: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  instrLabel: { color: "#555550", fontSize: 9, fontWeight: "900", letterSpacing: 2.5 },
  instrMain: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  instrFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderColor: "#1E1E1E",
    paddingTop: 10,
  },

  // Last lap
  lastLap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.panelBg,
    borderBottomWidth: 2,
    borderColor: C.rule,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  lastLapTitle: { fontSize: 12, fontWeight: "900", letterSpacing: 1, color: C.ink },
  lastLapSub:   { fontSize: 10, fontWeight: "700", color: C.muted, marginTop: 1 },
  lastLapTime:  { fontSize: 22, fontWeight: "900", fontVariant: ["tabular-nums"], color: C.ink, letterSpacing: 1 },

  // Lap table
  table: { flex: 1 },
  tableHead: {
    flexDirection: "row",
    backgroundColor: C.ink,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  th: { color: C.white, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderColor: C.line,
    backgroundColor: C.white,
  },
  rowBest: { backgroundColor: C.yellowBg },
  td:     { fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "700", color: C.ink },
  cLap:   { width: 36 },
  cSplit: { flex: 1 },
  cTime:  { flex: 1 },
  cDelta: { width: 70 },

  // Time together stub
  together:     { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
  togetherBtn:  { borderWidth: 1.5, borderColor: C.line, borderStyle: "dashed", borderRadius: 2, paddingVertical: 22, alignItems: "center", opacity: 0.45 },
  togetherLabel:{ color: C.ink, fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  togetherSub:  { color: C.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1, marginTop: 4 },

  // Button casing — bottom
  btnCasing: {
    flexDirection: "row",
    backgroundColor: C.casing,
    borderTopWidth: 3,
    borderColor: C.casingBorder,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
  },
});
