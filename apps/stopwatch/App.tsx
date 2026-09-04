/**
 * SplitSync Stopwatch
 *
 * Screens (state-machine navigation):
 *   solo     → standalone stopwatch (no auth required) — always the landing screen
 *   loading  → transient, shown only while a deep link is being resolved
 *   login    → email/password or Google sign-in, reached via "Time together" (no signup; accounts via web)
 *   home     → My Sessions + New Session + Solo option
 *   create   → name session + display name → creates session → session
 *   join     → display name prompt after deep-link lands
 *   session  → shared stopwatch (creator or joiner)
 *
 * The app opens directly on the solo stopwatch. Tapping "Time together" on
 * that screen is the only path into the shared-session / sign-in flow.
 *
 * Design: dark device casing (masthead/footer), DSEG7 LCD instrument,
 * SplitSync race-paper content areas, physical raised buttons.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import type { AppStateStatus } from "react-native";
import * as Crypto from "expo-crypto";
import { VolumeManager, addVolumeListener } from "react-native-volume-manager";
import * as ExpoLinking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useFonts } from "expo-font";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  ActivityIndicator as PaperActivityIndicator,
  Appbar,
  Button,
  Button as PaperButton,
  Card,
  Chip,
  DataTable,
  Dialog,
  Divider,
  HelperText,
  List,
  PaperProvider,
  Portal,
  SegmentedButtons,
  Surface,
  Switch as PaperSwitch,
  Text as PaperText,
  TextInput as PaperTextInput,
  TouchableRipple,
  useTheme,
} from "react-native-paper";
import { stopwatchTheme } from "./src/theme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "./src/supabase";
import {
  clearRunningNotification,
  showRunningNotification,
} from "./src/notification";
import {
  DEFAULT_CUE_SETTINGS,
  loadCueSettings,
  playCue,
  saveCueSettings,
} from "./src/cues";
import type { CueSettings } from "./src/cues";
import { palette } from "../../packages/palette/src/index";
import {
  resolveActiveSession,
  getSession,
  updateSession,
  updateSessionMeta,
  loadIndex,
  setActiveSessionId,
  listSessions,
  createSession,
  deleteSession,
  reorderSessions,
  SESSION_CAP,
} from "./src/storage/sessionStorage";
import type { PersistedStopwatchState, PersistedTimerState, RepeatConfig, SoloSessionMeta, SoloSessionPayload } from "./src/storage/sessionStorage";

// Required so the in-app browser session used for Google sign-in resolves
// its promise when redirected back into the app.
WebBrowser.maybeCompleteAuthSession();

// ── Palette ────────────────────────────────────────────────────────────────────
// Canonical tokens from @splitsync/palette; instrument-specific values kept inline.
const C = {
  // Canonical tokens from shared palette
  paper:    palette.paper,
  ink:      palette.ink,
  muted:    palette.muted,
  rule:     palette.ink,
  line:     palette.line,
  panelBg:  palette.panelAlt,
  red:      palette.red,
  yellow:   palette.yellow,
  yellowBg: palette.yellowBg,
  yellowDark: '#7A5C00',          // instrument-specific dark tone — keep inline
  // Signature instrument colors (canonical blue family)
  lcd:      palette.blueAccent,   // #5BC8F5
  lcdDim:   palette.blueDim,      // #00213A
  lcdSmall: '#FFFFFF',
  casing:       palette.instrumentCasing,
  casingBorder: '#0A0A0A',
  instrument:   palette.instrumentFace,
  white:    '#FFFFFF',
  black:    '#000000',            // pure black — shadow, logo chip bg, borders
  // Named dark-scale tokens (instrument / device chrome)
  deepDark:         '#111111',    // near-black strip backgrounds
  instrumentBorder: '#1E1E1E',    // separator inside instrument panel / btn dim lo
  lcdSmallDim:      '#222222',    // ghost-dim for small (total) LCD counter
  pillBg:           '#2A2A2A',    // participant pill background
  dark:             '#333333',    // default pill border, waiting-state chip
  pillBorder:       '#444444',    // participant pill border + disabled btn text
  dimGray:          '#555555',    // lock-icon (unlocked), waiting status badge
  casingMuted:      '#555550',    // instrument labels, casing title text
  faint:            '#888888',    // back-button text, navigation chevron
  inactive:         '#999999',    // waiting-state pill text
  pillText:         '#AAAAAA',    // participant pill text
  lcdBg:            '#0A2030',    // LCD dark bg — vol-key chip + participant-self pill
  errorBg:          '#FFF0F0',    // error box background tint
  // Semi-transparent overlays
  toastBg:          'rgba(0,0,0,0.85)',       // lock-hint floating toast
  btnSubLabel:      'rgba(255,255,255,0.5)',   // device-button sub-label (normal state)
  overrunLabel:     'rgba(255,255,255,0.75)',  // target-overrun strip label
  // Interactive / action color (blue family)
  bluePrimary: palette.bluePrimary,  // #0B6FB3 — buttons, links, focus rings
  blueTint:    "#EDF5FF",            // very light blue — active-row background tint
  // Status
  green:  palette.success,
  worse:  palette.red,
  // Button gradient shades — instrument-specific 3D gradients
  btnRedBody:   '#BB1100', btnRedHi:   '#EE3322', btnRedLo:   '#770800',
  btnInkBody:   '#2A2A2A', btnInkHi:   '#555555', btnInkLo:   '#000000',
  btnPaperBody: '#E8E3D8', btnPaperHi: '#F8F3E8', btnPaperLo: '#B8B3A8',
  btnDimBody:   '#1E1E1E', btnDimHi:   '#2A2A2A', btnDimLo:   '#0A0A0A',
  btnBlueBody:  '#5BC8F5', btnBlueHi:  '#8DDBFB', btnBlueLo:  '#2E86C1',
};

/**
 * Palette-derived colors selectable as session accent tags.
 * All values come from packages/palette/src/index.ts (AGENTS.md rule).
 * Color is always supplemental to the session name label (WCAG 1.4.1).
 */
export const SESSION_COLORS: { label: string; value: string }[] = [
  { label: "Blue",   value: palette.bluePrimary },
  { label: "Red",    value: palette.red },
  { label: "Yellow", value: palette.yellow },
  { label: "Green",  value: palette.success },
  { label: "Teal",   value: palette.blueAccent },
  { label: "Grey",   value: palette.muted },
];

// ── Touch target constant ─────────────────────────────────────────────────────
/** Minimum 44×44 pt touch target — apply to all icon-only controls. */
const ICON_BTN_SIZE = 44;

// ── Domain types ───────────────────────────────────────────────────────────────
type AppScreen =
  | "loading"
  | "login"
  | "home"
  | "create"
  | "join"
  | "viewer"
  | "session"
  | "solo";

type SessionStatus = "waiting" | "running" | "stopped" | "closed";
type SessionEventType = "start" | "lap" | "stop" | "reset";

interface CasualSession {
  id: string;
  code: string;
  name: string;
  status: SessionStatus;
  created_at: string;
  t0_server: string | null;
}

interface Participant {
  id: string;
  display_name: string;
  is_owner: boolean;
}

interface SessionEvent {
  id: string;
  event_type: SessionEventType;
  client_recorded_at: string;
  actor_participant_id: string;
  sequence: number;
  t0_server?: string | null;
}

interface DerivedLap {
  lapNum: number;
  splitMs: number;
  cumulativeMs: number;
  actorName: string;
}

interface SessionNavParams {
  sessionId: string;
  participantId: string;
  sessionCode: string;
  sessionName: string;
  isOwner: boolean;
  initialStatus: SessionStatus;
  initialT0Server: string | null;
  initialParticipants: Participant[];
  initialEvents: SessionEvent[];
}

interface JoinNavParams {
  code: string;
}

interface LiveViewNavParams {
  code: string;
}

// ── Utility helpers ────────────────────────────────────────────────────────────
function generateUUID(): string {
  // Crypto-strength UUID: these become idempotency keys
  // (casual_session_events.client_id), so weak randomness risks collisions.
  return Crypto.randomUUID();
}

function p2(n: number) {
  return String(Math.floor(n)).padStart(2, "0");
}

function fmtParts(ms: number) {
  const cs = Math.floor(ms / 10) % 100;
  const s = Math.floor(ms / 1000) % 60;
  const totalM = Math.floor(ms / 60000);
  const h = Math.floor(totalM / 60);
  const m = totalM % 60;
  // Roll over to H:MM:SS once elapsed >= 1 hour (#225)
  const main = h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
  return { main, cs: p2(cs) };
}

function fmtCompact(ms: number) {
  const { main, cs } = fmtParts(ms);
  return `${main}.${cs}`;
}

function fmtDelta(d: number) {
  const abs = Math.abs(d);
  const cs = Math.floor(abs / 10) % 100;
  const s = Math.floor(abs / 1000) % 60;
  const totalM = Math.floor(abs / 60000);
  const h = Math.floor(totalM / 60);
  const m = totalM % 60;
  const sign = d >= 0 ? "+" : "-";
  if (h > 0) return `${sign}${h}:${p2(m)}:${p2(s)}.${p2(cs)}`;
  return m > 0
    ? `${sign}${m}:${p2(s)}.${p2(cs)}`
    : `${sign}${s}.${p2(cs)}`;
}

function fmtAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * LCD main digit size for the current window (#230).
 * Portrait keeps the historical cap (72). Landscape lets the digits grow to
 * fill the available width — the large-display mode readable from a distance —
 * while capping against the short axis so the button bar and lap list keep
 * enough room and the layout never breaks.
 */
function lcdMainSize(width: number, height: number): number {
  const widthFit = Math.floor((width - 40) / 7.2);
  if (width > height) {
    return Math.max(48, Math.min(widthFit, Math.floor(height * 0.24)));
  }
  return Math.min(widthFit, 72);
}

// ── Lap export helpers (#226) ─────────────────────────────────────────────────
interface ExportLap {
  lapNum: number;
  splitMs: number;
  cumulativeMs: number;
  actorName?: string;
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Laps (ascending lap order) → CSV text. Mirrors apps/web stopwatchExport. */
function lapsToCsvText(laps: ExportLap[]): string {
  const withActor = laps.some((l) => l.actorName !== undefined);
  const header = withActor
    ? "lap,split,total,split_ms,total_ms,recorded_by"
    : "lap,split,total,split_ms,total_ms";
  const rows = laps.map((l) => {
    const base = [
      String(l.lapNum),
      fmtCompact(l.splitMs),
      fmtCompact(l.cumulativeMs),
      String(Math.round(l.splitMs)),
      String(Math.round(l.cumulativeMs)),
    ];
    if (withActor) base.push(csvField(l.actorName ?? ""));
    return base.join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}

/** Laps (ascending lap order) → human-readable share text. */
function lapsToShareText(
  title: string,
  totalMs: number | null,
  laps: ExportLap[]
): string {
  const bestMs =
    laps.length > 0 ? Math.min(...laps.map((l) => l.splitMs)) : null;
  const summary = [
    totalMs !== null ? `Total ${fmtCompact(totalMs)}` : null,
    `${laps.length} lap${laps.length === 1 ? "" : "s"}`,
    bestMs !== null ? `Best ${fmtCompact(bestMs)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = laps.map((l) => {
    const actor = l.actorName ? `  by ${l.actorName}` : "";
    return `Lap ${l.lapNum}  ${fmtCompact(l.splitMs)}  (${fmtCompact(l.cumulativeMs)})${actor}`;
  });
  return [`${title} — SplitSync Stopwatch`, summary, "", ...lines].join("\n");
}

function extractCodeFromUrl(url: string): string | null {
  // Handles:
  //   https://splitsync.org/stopwatch/s/<code>
  //   org.splitsync.stopwatch://s/<code>
  const m = url.match(/\/s\/([A-Z2-9]{6})(?:[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

function isLiveViewUrl(url: string): boolean {
  return /\/s\/[A-Z2-9]{6}\/live(?:[/?#]|$)/i.test(url);
}

// Consumes an `org.splitsync.stopwatch://auth/callback` deep link produced by
// Supabase's OAuth redirect, exchanging the PKCE `code` for a session. Mirrors
// the pattern used by the mobile tracker app (apps/mobile/App.tsx).
async function consumeAuthCallbackUrl(url: string): Promise<boolean> {
  if (!url.includes("auth/callback")) return false;
  const { queryParams } = ExpoLinking.parse(url);
  const code = typeof queryParams?.code === "string" ? queryParams.code : undefined;
  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
    return true;
  }
  const fragment = url.split("#")[1];
  if (!fragment) return false;
  const params = new URLSearchParams(fragment);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) {
    await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    return true;
  }
  return false;
}

// ── Lap trend chart (native) ───────────────────────────────────────────────────
function LapTrendChart<T>({
  laps,
  bestMs,
  worstMs,
  getLapMs,
  getLapNum,
}: {
  laps: T[];
  bestMs: number;
  worstMs: number;
  getLapMs: (lap: T) => number;
  getLapNum: (lap: T) => number;
}) {
  if (laps.length < 2) return null;
  return (
    <View style={sc.trendChart}>
      {laps.map((lap) => {
        const ms = getLapMs(lap);
        const num = getLapNum(lap);
        const isBest = ms === bestMs;
        const isWorst = ms === worstMs;
        const pct = worstMs > 0 ? (ms / worstMs) * 100 : 100;
        const barColor = isBest ? C.yellow : isWorst ? C.worse : C.muted;
        return (
          <View key={num} style={sc.trendRow}>
            <Text style={sc.trendNum}>{num}</Text>
            <View style={sc.trendTrack}>
              <View
                style={[
                  sc.trendFill,
                  { width: `${pct}%` as unknown as number, backgroundColor: barColor },
                ]}
              />
            </View>
            <Text style={sc.trendTime}>{fmtCompact(ms)}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Memoized lap table (shared session) ─────────────────────────────────────
// Isolated behind React.memo so the 30ms elapsed-time tick in the parent
// screen (which re-renders on every setElapsedMs call) does not force this
// list — and the per-row LapTrendChart — to re-render 33x/sec. It only
// re-renders when the derived `laps` array (or best/worst) actually changes,
// i.e. when a lap is recorded (#344).
const LapTable = memo(function LapTable({
  laps,
  bestMs,
  worstMs,
  showSessionStats,
  showDelta,
}: {
  laps: DerivedLap[];
  bestMs: number | null;
  worstMs: number | null;
  showSessionStats: boolean;
  showDelta: boolean;
}) {
  const renderItem = useCallback(
    ({ item }: { item: DerivedLap }) => {
      const isBest = bestMs !== null && item.splitMs === bestMs;
      const delta =
        showDelta && bestMs !== null && !isBest ? item.splitMs - bestMs : null;
      return (
        <View style={[s.tableRow, isBest && s.rowBest]}>
          <Text style={[s.td, s.cLap, { color: C.muted }]}>{item.lapNum}</Text>
          <Text
            style={[
              s.td,
              s.cSplit,
              isBest && { color: C.yellowDark, fontWeight: "900" },
            ]}
          >
            {fmtCompact(item.splitMs)}
          </Text>
          <Text style={[s.td, s.cTime, { color: C.muted }]}>
            {fmtCompact(item.cumulativeMs)}
          </Text>
          <Text style={[s.td, s.cActor, { color: C.muted }]} numberOfLines={1}>
            {item.actorName}
            {delta !== null ? ` ${fmtDelta(delta)}` : ""}
          </Text>
        </View>
      );
    },
    [bestMs, showDelta]
  );

  const reversedLaps = useMemo(() => [...laps].reverse(), [laps]);

  const listHeader = useMemo(
    () =>
      showSessionStats && bestMs !== null && worstMs !== null ? (
        <LapTrendChart
          laps={reversedLaps}
          bestMs={bestMs}
          worstMs={worstMs}
          getLapMs={(l) => l.splitMs}
          getLapNum={(l) => l.lapNum}
        />
      ) : null,
    [showSessionStats, bestMs, worstMs, reversedLaps]
  );

  return (
    <FlatList
      data={laps}
      keyExtractor={(l) => String(l.lapNum)}
      style={{ flex: 1 }}
      ListHeaderComponent={listHeader}
      renderItem={renderItem}
    />
  );
});

// ── Volume-key hardware control ────────────────────────────────────────────────

const STORAGE_KEY_VOL_KEYS = "stopwatch_volume_keys_enabled";

/**
 * useVolumeKeys — maps Android hardware volume keys to stopwatch actions.
 *
 * Volume DOWN (while running)     = LAP
 * Volume DOWN (while NOT running) = RESET
 * Volume UP                       = START / STOP (toggle)
 *
 * The system volume overlay is suppressed while the mapping is active.
 * While active, the media volume is pinned to a mid-level (0.5) so that both
 * keys always produce a volume-change event — even if the user's volume was
 * at 0 (volume-down would otherwise be dead) or at max (volume-up dead).
 * The user's original volume is restored when the mapping is deactivated.
 *
 * The enabled/disabled preference is persisted to AsyncStorage.
 */
function useVolumeKeys({
  isRunning,
  onLap,
  onStartStop,
  onReset,
}: {
  isRunning: boolean;
  onLap: () => void;
  onStartStop: () => void;
  onReset?: () => void;
}): { volumeKeysEnabled: boolean; toggleVolumeKeys: () => void } {
  const [enabled, setEnabled] = useState(true);

  // Load persisted preference once on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY_VOL_KEYS).then((val) => {
      if (val !== null) setEnabled(val === "true");
    });
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      AsyncStorage.setItem(STORAGE_KEY_VOL_KEYS, String(next)).catch(() => undefined);
      return next;
    });
  }, []);

  // Keep stable refs so the event listener closure never goes stale
  const isRunningRef = useRef(isRunning);
  const onLapRef = useRef(onLap);
  const onStartStopRef = useRef(onStartStop);
  const onResetRef = useRef(onReset);
  useEffect(() => { isRunningRef.current = isRunning; }, [isRunning]);
  useEffect(() => { onLapRef.current = onLap; }, [onLap]);
  useEffect(() => { onStartStopRef.current = onStartStop; }, [onStartStop]);
  useEffect(() => { onResetRef.current = onReset; }, [onReset]);

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;
    let subscription: ReturnType<typeof addVolumeListener> | null = null;
    // The user's volume before we pinned it; restored on cleanup.
    let originalVolume: number | null = null;

    // Pin point: mid-level so both keys always move the volume.
    // After each action we re-pin; the OS quantises the value to the nearest
    // hardware step (e.g. 7/15 ≈ 0.467 on a 15-step device), so the re-pin
    // echo can arrive at a value that is well outside any EPSILON band yet still
    // be our own echo — not a real press. A time-based cooldown is the only
    // reliable defence: we suppress all events for REPIN_COOLDOWN_MS after
    // issuing setVolume(PIN), which is long enough to absorb the OS round-trip
    // but short enough that genuine rapid presses are never lost.
    const PIN = 0.5;
    const REPIN_COOLDOWN_MS = 300;
    let repinAt = 0; // timestamp of the last re-pin call; 0 = none pending

    // Suppress the native volume overlay
    VolumeManager.showNativeVolumeUI({ enabled: false }).catch(() => undefined);

    VolumeManager.getVolume()
      .then(({ volume }) => {
        if (!mounted) return;
        originalVolume = volume;
        // Pin the media volume so volume keys work even at 0 or max
        return VolumeManager.setVolume(PIN, { showUI: false });
      })
      .then(() => {
        if (!mounted) return;

        subscription = addVolumeListener(({ volume: newVolume }) => {
          if (!mounted) return;
          // Ignore events that arrive during the re-pin cooldown window.
          // This handles the case where the OS quantises setVolume(0.5) to a
          // nearby step (e.g. 0.467) and fires the listener with a value that
          // is far enough from PIN to bypass any fixed EPSILON filter.
          if (repinAt !== 0 && Date.now() - repinAt < REPIN_COOLDOWN_MS) return;

          if (newVolume < PIN) {
            if (isRunningRef.current) {
              // Volume DOWN while running → LAP
              onLapRef.current();
            } else {
              // Volume DOWN while stopped → RESET
              onResetRef.current?.();
            }
          } else {
            // Volume UP → START / STOP
            onStartStopRef.current();
          }

          // Re-pin so the next press always produces a delta; record when so
          // the cooldown guard above can suppress the resulting echo event.
          repinAt = Date.now();
          VolumeManager.setVolume(PIN, { showUI: false }).catch(() => undefined);
        });
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
      subscription?.remove();
      // Restore the user's original volume now that the mapping is inactive
      if (originalVolume !== null) {
        VolumeManager.setVolume(originalVolume, { showUI: false }).catch(() => undefined);
      }
      // Re-enable system volume overlay when leaving the screen or disabling
      VolumeManager.showNativeVolumeUI({ enabled: true }).catch(() => undefined);
    };
  }, [enabled]);

  return { volumeKeysEnabled: enabled, toggleVolumeKeys: toggle };
}

// ── Shared UI components ───────────────────────────────────────────────────────

// LCD display with DSEG7 ghost segments
function LcdDisplay({
  ms,
  mainSize,
  csRatio = 0.54,
  color = C.lcd,
  dimColor = C.lcdDim,
  fontLoaded,
}: {
  ms: number;
  mainSize: number;
  csRatio?: number;
  color?: string;
  dimColor?: string;
  fontLoaded: boolean;
}) {
  const { main, cs } = fmtParts(ms);
  // The layout is sized for up to "MM:SS" (5 chars). Once hours kick in the
  // main string grows to "H:MM:SS" (7+ chars); shrink digits proportionally so
  // the 7-segment display still fits its row (#225).
  const fitSize =
    main.length > 5 ? Math.round((mainSize * 5) / main.length) : mainSize;
  const csSize = Math.round(fitSize * csRatio);
  const font = fontLoaded ? "DSEG7Classic-Regular" : "monospace";
  const mainDim = main.replace(/\d/g, "8");
  const csDim = cs.replace(/\d/g, "8");
  const baselineOffset = Math.round((fitSize - csSize) * 0.78);

  return (
    <View
      style={{ flexDirection: "row", alignItems: "flex-end", flexWrap: "nowrap" }}
    >
      <View style={{ flexShrink: 0 }}>
        <Text
          style={{
            fontFamily: font,
            fontSize: fitSize,
            color: dimColor,
            letterSpacing: 3,
            includeFontPadding: false,
          }}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {mainDim}
        </Text>
        <Text
          style={{
            fontFamily: font,
            fontSize: fitSize,
            color,
            letterSpacing: 3,
            includeFontPadding: false,
            position: "absolute",
            top: 0,
            left: 0,
          }}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {main}
        </Text>
      </View>
      <View
        style={{
          flexShrink: 0,
          marginBottom: Math.round(fitSize * 0.08),
          // baselineOffset is calculated but not used as a margin-bottom style here;
          // the parent alignItems:"flex-end" handles vertical alignment
          display: "flex",
        }}
      >
        <Text
          style={{
            fontFamily: font,
            fontSize: csSize,
            color: dimColor,
            includeFontPadding: false,
          }}
          numberOfLines={1}
          allowFontScaling={false}
        >
          .
        </Text>
        <Text
          style={{
            fontFamily: font,
            fontSize: csSize,
            color,
            includeFontPadding: false,
            position: "absolute",
            top: 0,
            left: 0,
          }}
          numberOfLines={1}
          allowFontScaling={false}
        >
          .
        </Text>
      </View>
      <View style={{ flexShrink: 0 }}>
        <Text
          style={{
            fontFamily: font,
            fontSize: csSize,
            color: dimColor,
            letterSpacing: 3,
            includeFontPadding: false,
          }}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {csDim}
        </Text>
        <Text
          style={{
            fontFamily: font,
            fontSize: csSize,
            color,
            letterSpacing: 3,
            includeFontPadding: false,
            position: "absolute",
            top: 0,
            left: 0,
          }}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {cs}
        </Text>
      </View>
    </View>
  );
}

// Physical raised device button
interface BtnProps {
  label: string;
  sub?: string;
  body: string;
  hi: string;
  lo: string;
  textColor?: string;
  disabled?: boolean;
  flex?: number;
  onPress: () => void;
}
// MD3 physical device control (#438). The raised-bezel skeuomorphic look
// used to live entirely in this component's hand-rolled borders/shadows;
// it now uses genuine MD3 primitives (`Surface` for tonal elevation,
// `TouchableRipple` for the MD3 state layer) while keeping each button's
// distinct body color so LAP/START/STOP/RESET stay visually distinguishable.
// NOTE: this is unrelated to `LcdDisplay`'s instrument face, which this
// change does not touch.
function DeviceBtn({
  label,
  sub,
  body,
  hi,
  lo,
  textColor = C.white,
  disabled,
  flex = 1,
  onPress,
}: BtnProps) {
  const bg = disabled ? C.btnDimBody : body;
  const edge = disabled ? C.btnDimLo : lo;
  const txt = disabled ? C.pillBorder : textColor;

  return (
    <Surface
      style={{ flex, borderRadius: 10, minHeight: 56 }}
      elevation={disabled ? 0 : 3}
    >
      <TouchableRipple
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        rippleColor={hi ? `${hi}55` : "rgba(255,255,255,0.24)"}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled }}
        style={{
          minHeight: 56,
          minWidth: 44,
          borderRadius: 10,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: edge,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 4,
          paddingVertical: 8,
        }}
      >
        <View style={{ alignItems: "center", justifyContent: "center" }}>
          {sub && (
            <Text
              style={{
                color: disabled ? C.dark : C.btnSubLabel,
                fontSize: 9,
                fontWeight: "900",
                letterSpacing: 2,
                marginBottom: 1,
              }}
            >
              {sub}
            </Text>
          )}
          <Text
            style={{ color: txt, fontSize: 14, fontWeight: "900", letterSpacing: 1.5 }}
          >
            {label}
          </Text>
        </View>
      </TouchableRipple>
    </Surface>
  );
}

// Shared casing header row (logo + title + right slot)
function CasingBar({
  title,
  rightSlot,
}: {
  title: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <View style={s.casing}>
      <View style={s.casingLeft}>
        <View style={s.logoChip}>
          <Text style={s.logoSplit}>SPLIT</Text>
          <Text style={s.logoSync}>SYNC</Text>
        </View>
        <Text style={s.casingTitle}>{title}</Text>
      </View>
      {rightSlot}
    </View>
  );
}

// ── Top bar redesign (#414) ──────────────────────────────────────────────────
// A single row of evenly distributed, identically sized buttons using a
// 3-color scheme: grey = neutral toggle (resting state), blue = primary
// navigation, yellow = active/warning state (locked, running).
type TopBarVariant = "grey" | "blue" | "yellow";

function topBarColors(variant: TopBarVariant) {
  switch (variant) {
    case "blue":
      return { bg: C.bluePrimary, fg: C.white };
    case "yellow":
      return { bg: C.yellow, fg: C.ink };
    default:
      return { bg: C.dark, fg: C.casingMuted };
  }
}

// MD3 chrome button (#438) — an `Appbar`-row action rendered with Paper's
// `Button` so it gets the standard MD3 state layer/ripple and a ≥44pt
// touch target, while keeping the existing 3-color variant scheme (grey
// neutral / blue navigation / yellow active-warning) and its text label
// (WCAG 1.4.1 — never color-only).
function TopBarButton({
  label,
  onPress,
  variant,
  accessibilityLabel,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant: TopBarVariant;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const { bg, fg } = topBarColors(variant);
  return (
    <Button
      mode="contained"
      onPress={onPress}
      buttonColor={bg}
      textColor={fg}
      compact
      uppercase={false}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      style={s.topBarBtn}
      contentStyle={s.topBarBtnContent}
      labelStyle={s.topBarBtnText}
    >
      {label}
    </Button>
  );
}

// Non-pressable status indicator (MD3 `Chip`), same footprint as
// TopBarButton so it sits evenly in the row. Always pairs its color with a
// text label — never color-only (WCAG 1.4.1) — and keeps the "syncing"
// pending dot as a supplemental indicator.
function TopBarStatus({
  label,
  variant,
  pending,
}: {
  label: string;
  variant: TopBarVariant;
  pending?: boolean;
}) {
  const { bg, fg } = topBarColors(variant);
  return (
    <View style={s.topBarBtn}>
      <Chip
        mode="flat"
        compact
        style={[s.topBarStatusChip, { backgroundColor: bg }]}
        textStyle={[s.topBarBtnText, { color: fg }]}
        accessibilityLabel={pending ? `${label} — syncing` : label}
      >
        {label}
      </Chip>
      {pending && (
        <View style={s.topBarPendingDot} accessibilityLabel="Syncing" />
      )}
    </View>
  );
}

// Text input with label (SplitSync styled)
function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: "default" | "email-address";
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize ?? "none"}
        keyboardType={keyboardType}
        style={s.textInput}
        autoCorrect={false}
      />
    </View>
  );
}

// ── Sound cues (issue #227) ────────────────────────────────────────────────────

/**
 * Loads persisted cue settings and exposes them as state + a ref (the ref is
 * safe to read inside timer callbacks without re-creating the tick loop).
 */
function useCueSettings() {
  const [cueSettings, setCueSettings] = useState<CueSettings>(DEFAULT_CUE_SETTINGS);
  const cueRef = useRef<CueSettings>(cueSettings);

  useEffect(() => {
    loadCueSettings().then((loaded) => {
      cueRef.current = loaded;
      setCueSettings(loaded);
    });
  }, []);

  const updateCueSettings = useCallback((patch: Partial<CueSettings>) => {
    setCueSettings((prev) => {
      const next = { ...prev, ...patch };
      cueRef.current = next;
      void saveCueSettings(next);
      return next;
    });
  }, []);

  return { cueSettings, cueRef, updateCueSettings };
}

// MD3 sound-cue toggle (#441) — an `react-native-paper` `Switch`. The ON/OFF
// state is still exposed as an accessible label (via `accessibilityLabel`)
// rather than relying on switch position/color alone (WCAG 1.4.1).
function CueSwitch({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <PaperSwitch
      value={on}
      onValueChange={onToggle}
      accessibilityLabel={`${label} — ${on ? "on" : "off"}`}
    />
  );
}

// Settings panel: sound cue toggles + target time (mm:ss). Rendered as an
// MD3 `Surface` bottom-sheet-style panel (#441) — it is toggled inline
// between the app bar and the instrument, not as a floating dialog, so a
// `Surface` with elevation (rather than a `Dialog`, which is reserved for
// screen-blocking prompts) is the correct MD3 pattern here. Rows use
// `List.Item` + `Switch` per the MD3 spec.
function CueSettingsPanel({
  settings,
  onChange,
}: {
  settings: CueSettings;
  onChange: (patch: Partial<CueSettings>) => void;
}) {
  const [mm, setMm] = useState(String(Math.floor(settings.targetMs / 60000)));
  const [ss, setSs] = useState(p2(Math.floor(settings.targetMs / 1000) % 60));

  const commitTarget = useCallback(
    (mmStr: string, ssStr: string) => {
      const m = parseInt(mmStr, 10);
      const sec = Math.min(parseInt(ssStr, 10) || 0, 59);
      const ms = (Number.isNaN(m) ? 0 : m) * 60000 + sec * 1000;
      if (ms > 0) onChange({ targetMs: ms });
    },
    [onChange]
  );

  return (
    <Surface style={s.cuePanel} elevation={2}>
      <List.Item
        title="Sound cues · start / stop / lap"
        titleStyle={s.cueLabel}
        titleNumberOfLines={2}
        style={s.cueListItem}
        right={() => (
          <CueSwitch
            on={settings.soundEnabled}
            label="Sound cues on start, stop, and lap"
            onToggle={() => onChange({ soundEnabled: !settings.soundEnabled })}
          />
        )}
      />
      <Divider />
      <List.Item
        title="Target-time beep"
        titleStyle={s.cueLabel}
        titleNumberOfLines={2}
        style={s.cueListItem}
        right={() => (
          <CueSwitch
            on={settings.targetEnabled}
            label="Beep once at target time"
            onToggle={() => onChange({ targetEnabled: !settings.targetEnabled })}
          />
        )}
      />
      {settings.targetEnabled && (
        <>
          <Divider />
          <View style={[s.cueListItem, s.cueTargetRow]}>
            <PaperText style={s.cueLabel}>TARGET (MM:SS)</PaperText>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <PaperTextInput
                mode="outlined"
                dense
                value={mm}
                onChangeText={(t) => {
                  const clean = t.replace(/[^0-9]/g, "").slice(0, 3);
                  setMm(clean);
                  commitTarget(clean, ss);
                }}
                keyboardType="number-pad"
                style={s.cueInputPaper}
                accessibilityLabel="Target minutes"
                maxLength={3}
              />
              <Text style={s.cueColon}>:</Text>
              <PaperTextInput
                mode="outlined"
                dense
                value={ss}
                onChangeText={(t) => {
                  const clean = t.replace(/[^0-9]/g, "").slice(0, 2);
                  setSs(clean);
                  commitTarget(mm, clean);
                }}
                keyboardType="number-pad"
                style={s.cueInputPaper}
                accessibilityLabel="Target seconds"
                maxLength={2}
              />
            </View>
          </View>
        </>
      )}
      <HelperText type="info" visible style={s.cueHint}>
        The stopwatch keeps running past the target — the overrun is shown in
        red. Cues are best-effort while the app is in the background.
      </HelperText>
    </Surface>
  );
}

// Red overrun strip shown once elapsed time passes the target. Rendered as
// an MD3 `Surface` (elevation-tinted alert strip) rather than a plain View
// (#438) — kept red per ADR 0021 (red reserved for errors/overrun states),
// with a text label alongside the color (WCAG 1.4.1).
function TargetOverrunStrip({
  elapsedMs,
  targetMs,
}: {
  elapsedMs: number;
  targetMs: number;
}) {
  if (elapsedMs < targetMs) return null;
  return (
    <Surface
      style={s.targetOverrun}
      elevation={2}
      accessible
      accessibilityLabel={`Past target by ${fmtCompact(elapsedMs - targetMs)}`}
    >
      <Text style={s.targetOverrunLabel}>TARGET {fmtCompact(targetMs)}</Text>
      <Text style={s.targetOverrunTime}>+{fmtCompact(elapsedMs - targetMs)}</Text>
    </Surface>
  );
}

// ── Double-tap hook ────────────────────────────────────────────────────────────
/**
 * Returns a tap handler that distinguishes a double-tap from a single tap.
 * - Two taps within `delay` ms → calls `onDoubleTap`.
 * - A tap with no second tap within `delay` ms → calls `onSingleTap`.
 */
function useDoubleTap(
  onDoubleTap: () => void,
  onSingleTap: () => void,
  delay = 300
): () => void {
  const lastTapRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current <= delay) {
      // Double-tap detected — cancel pending single-tap callback
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      lastTapRef.current = 0;
      onDoubleTap();
    } else {
      lastTapRef.current = now;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onSingleTap();
      }, delay);
    }
  }, [onDoubleTap, onSingleTap, delay]);
}

// Subtle SplitSync logo footer — shown at the bottom of control-dense screens
function LogoFooter() {
  return (
    <View style={s.logoFooter}>
      <View style={s.logoChip}>
        <Text style={s.logoSplit}>SPLIT</Text>
        <Text style={s.logoSync}>SYNC</Text>
      </View>
    </View>
  );
}

// ── Fullscreen overlay (#422) ──────────────────────────────────────────────────
/**
 * A full-screen, high-contrast modal overlay displaying large elapsed/remaining
 * digits. Usable at a distance (propped-up phone during a workout). Dismissed
 * by a tap anywhere on the screen, an explicit MD3 dismiss control (#441), or
 * the Android back button.
 *
 * The overlay is intentionally a React Native `Modal` (not a View on top of
 * the screen) so the OS bars (status/navigation) are hidden via `StatusBar`.
 * The instrument content (`LcdDisplay`) it wraps is untouched by the MD3
 * redesign — only the surrounding chrome (labels + dismiss control) is
 * restyled.
 */
function FullscreenOverlay({
  visible,
  onDismiss,
  ms,
  label,
  subLabel,
  alerting,
  fontsLoaded,
}: {
  visible: boolean;
  onDismiss: () => void;
  ms: number;
  label: string;
  subLabel: string;
  alerting?: boolean;
  fontsLoaded: boolean;
}) {
  const { width, height } = useWindowDimensions();
  // Choose a digit size that fills the long axis comfortably (readable from ~3m)
  const longAxis = Math.max(width, height);
  const shortAxis = Math.min(width, height);
  const mainSize = Math.min(Math.floor(longAxis * 0.18), Math.floor(shortAxis * 0.35));

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <StatusBar barStyle="light-content" backgroundColor={C.black} />
      <Pressable
        style={{
          flex: 1,
          backgroundColor: C.black,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
        onPress={onDismiss}
        accessible={false}
      >
        {/* Explicit MD3 dismiss control (#441) — a contained-tonal chip in
            the corner, in addition to the existing tap-anywhere/back
            dismissal, so the exit affordance is discoverable without
            relying on the hint text alone. */}
        <Button
          mode="contained-tonal"
          compact
          onPress={onDismiss}
          style={s.fullscreenDismissBtn}
          labelStyle={s.fullscreenDismissLabel}
          accessibilityLabel="Exit fullscreen"
        >
          ✕ Exit
        </Button>

        {/* Readable state label above the digits */}
        <PaperText
          style={{
            color: alerting ? C.red : C.casingMuted,
            fontSize: 11,
            fontWeight: "900",
            letterSpacing: 3,
            textTransform: "uppercase",
            marginBottom: 16,
          }}
          accessibilityRole="text"
        >
          {label}
        </PaperText>

        {/* Large LCD digits — instrument content, untouched by MD3 (#441) */}
        <LcdDisplay
          ms={ms}
          mainSize={mainSize}
          color={alerting ? C.red : C.lcd}
          dimColor={alerting ? C.btnRedLo : C.lcdDim}
          fontLoaded={fontsLoaded}
        />

        {/* Sub-label (e.g. "Counting down", "Paused") */}
        <PaperText
          style={{
            color: alerting ? C.red : C.casingMuted,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 2,
            textTransform: "uppercase",
            marginTop: 20,
          }}
          accessibilityRole="text"
        >
          {subLabel}
        </PaperText>

        {/* Dismiss hint */}
        <PaperText
          style={{
            color: C.dimGray,
            fontSize: 10,
            fontWeight: "600",
            letterSpacing: 1.5,
            textTransform: "uppercase",
            marginTop: 40,
          }}
        >
          Tap anywhere or press back to exit
        </PaperText>
      </Pressable>
    </Modal>
  );
}

// ── Screen: Loading ────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <SafeAreaView style={[s.screen, { justifyContent: "center", alignItems: "center" }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />
      <CasingBar title="STOPWATCH" />
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={C.red} />
        <Text style={[s.mutedText, { marginTop: 12 }]}>Loading…</Text>
      </View>
    </SafeAreaView>
  );
}

// ── Screen: Login ──────────────────────────────────────────────────────────────
function LoginScreen({
  onLogin,
  onSolo,
}: {
  onLogin: () => void;
  onSolo: () => void;
}) {
  const theme = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = useCallback(async () => {
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (authError) {
      setError(authError.message);
    } else {
      onLogin();
    }
  }, [email, password, onLogin]);

  const handleGoogleSignIn = useCallback(async () => {
    setError(null);
    setGoogleLoading(true);
    const redirectTo = ExpoLinking.createURL("auth/callback");
    const { data, error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (authError || !data.url) {
      setGoogleLoading(false);
      setError(authError?.message ?? "Could not start Google sign-in.");
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === "success") {
      const ok = await consumeAuthCallbackUrl(result.url);
      setGoogleLoading(false);
      if (ok) {
        onLogin();
      } else {
        setError("Google sign-in did not complete. Try again.");
      }
    } else {
      setGoogleLoading(false);
      if (result.type !== "cancel") {
        setError("Google sign-in was interrupted. Try again.");
      }
    }
  }, [onLogin]);

  // Shared timing sessions need Supabase credentials. Without them, there is
  // nothing useful a sign-in form can do — go straight to a solo-only prompt.
  if (!isSupabaseConfigured) {
    return (
      <SafeAreaView style={[s.screen, { backgroundColor: theme.colors.background }]}>
        <StatusBar barStyle="light-content" backgroundColor={C.casing} />
        <Appbar.Header style={{ backgroundColor: theme.colors.surface }} elevated>
          <Appbar.Content title="Stopwatch" />
        </Appbar.Header>
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <Card mode="outlined">
            <Card.Content>
              <PaperText variant="headlineSmall" style={{ marginBottom: 8 }}>
                Solo mode only
              </PaperText>
              <PaperText variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 20 }}>
                Shared timing sessions aren&apos;t configured for this build.
                You can still use the solo stopwatch.
              </PaperText>
              <Button mode="contained" onPress={onSolo}>
                Continue solo
              </Button>
            </Card.Content>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.screen, { backgroundColor: theme.colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />
      <Appbar.Header style={{ backgroundColor: theme.colors.surface }} elevated>
        <Appbar.Content title="Sign in" />
      </Appbar.Header>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 28 }}
        keyboardShouldPersistTaps="handled"
      >
        <PaperText variant="headlineSmall" style={{ marginBottom: 8 }}>
          Session Creator
        </PaperText>
        <PaperText variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 24 }}>
          Sign in to create and manage shared timing sessions. Joining a
          session requires no account.
        </PaperText>

        <Button
          mode="outlined"
          onPress={handleGoogleSignIn}
          loading={googleLoading}
          disabled={googleLoading || loading}
          style={{ marginBottom: 20 }}
        >
          Continue with Google
        </Button>

        <View style={s.dividerRow}>
          <Divider style={{ flex: 1 }} />
          <PaperText variant="labelSmall" style={{ marginHorizontal: 12, color: theme.colors.onSurfaceVariant }}>
            OR
          </PaperText>
          <Divider style={{ flex: 1 }} />
        </View>

        <PaperTextInput
          mode="outlined"
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={{ marginBottom: 14 }}
        />
        <PaperTextInput
          mode="outlined"
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={{ marginBottom: 4 }}
        />

        <HelperText type="error" visible={!!error}>
          {error}
        </HelperText>

        <Button
          mode="contained"
          onPress={handleSignIn}
          loading={loading}
          disabled={loading}
          style={{ marginTop: 8, marginBottom: 16 }}
        >
          Sign in
        </Button>

        <Button mode="text" onPress={onSolo}>
          Use without account →
        </Button>

        <Button
          mode="text"
          compact
          style={{ marginTop: 4 }}
          onPress={() => ExpoLinking.openURL("https://splitsync.org/help")}
        >
          Help &amp; about
        </Button>

        <Button
          mode="text"
          compact
          onPress={() => ExpoLinking.openURL("https://splitsync.org/privacy")}
        >
          Privacy Policy
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Screen: Home ───────────────────────────────────────────────────────────────
function HomeScreen({
  userEmail,
  userName,
  onNewSession,
  onSolo,
  onRejoinSession,
  onSignOut,
}: {
  userEmail: string;
  userName: string | null;
  onNewSession: () => void;
  onSolo: () => void;
  onRejoinSession: (params: SessionNavParams) => void;
  onSignOut: () => void;
}) {
  const theme = useTheme();
  const [sessions, setSessions] = useState<CasualSession[]>([]);
  const [loading, setLoading] = useState(true);
  // Which session row has a close/delete request in flight (#345).
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    const { data } = await supabase
      .from("casual_sessions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setSessions(data as CasualSession[]);
    setLoading(false);
  }, []);

  const handleCloseSession = useCallback((session: CasualSession) => {
    Alert.alert(
      "Close session?",
      `No one will be able to join or record new laps in "${session.name || "Untitled Session"}".`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Close session",
          style: "destructive",
          onPress: async () => {
            setActionPendingId(session.id);
            const { error } = await supabase.rpc("close_casual_session", {
              p_session_id: session.id,
            });
            if (error) {
              Alert.alert("Error", error.message ?? "Failed to close session.");
            } else {
              setSessions((prev) =>
                prev.map((s) =>
                  s.id === session.id ? { ...s, status: "closed" } : s
                )
              );
            }
            setActionPendingId(null);
          },
        },
      ]
    );
  }, []);

  const handleDeleteSession = useCallback((session: CasualSession) => {
    Alert.alert(
      "Delete session?",
      `This permanently removes "${session.name || "Untitled Session"}" and all its laps. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setActionPendingId(session.id);
            const { error } = await supabase.rpc("delete_casual_session", {
              p_session_id: session.id,
            });
            if (error) {
              Alert.alert("Error", error.message ?? "Failed to delete session.");
            } else {
              setSessions((prev) => prev.filter((s) => s.id !== session.id));
            }
            setActionPendingId(null);
          },
        },
      ]
    );
  }, []);

  useEffect(() => {
    fetchSessions();

    const channel = supabase
      .channel("my-sessions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "casual_sessions" },
        () => fetchSessions()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchSessions]);

  const handleRejoin = useCallback(
    async (session: CasualSession) => {
      // Stopped sessions have no interactive controls — send directly to public results page.
      if (session.status === "stopped") {
        await ExpoLinking.openURL(
          `https://splitsync.org/stopwatch/s/${session.code}/results`
        );
        return;
      }

      // Load owner participant_id from storage
      const storedId = await AsyncStorage.getItem(
        `session_participant_${session.id}`
      );
      if (!storedId) {
        Alert.alert("Session not found", "Could not find your participant ID for this session.");
        return;
      }

      // Fetch current state via RPC
      const { data, error } = await supabase.rpc("get_session_state", {
        p_session_id: session.id,
        p_participant_id: storedId,
      });

      if (error || !data) {
        Alert.alert("Error", error?.message ?? "Failed to load session.");
        return;
      }

      const state = data as {
        status: SessionStatus;
        t0_server: string | null;
        events: SessionEvent[];
        participants: Participant[];
      };

      onRejoinSession({
        sessionId: session.id,
        participantId: storedId,
        sessionCode: session.code,
        sessionName: session.name,
        isOwner: true,
        initialStatus: state.status,
        initialT0Server: state.t0_server,
        initialParticipants: state.participants ?? [],
        initialEvents: state.events ?? [],
      });
    },
    [onRejoinSession]
  );

  const greeting = userName
    ? `Hi, ${userName.split(" ")[0]}`
    : userEmail
    ? `Hi, ${userEmail.split("@")[0]}`
    : "Hi";

  // Session status → MD3 theme color roles. Every state also renders its own
  // text label (WCAG 1.4.1) — color is never the only signal.
  const statusColors: Record<
    CasualSession["status"],
    { background: string; text: string; label: string }
  > = {
    running: {
      background: theme.colors.errorContainer,
      text: theme.colors.onErrorContainer,
      label: "Running",
    },
    stopped: {
      background: theme.colors.inverseSurface,
      text: theme.colors.inverseOnSurface,
      label: "Stopped",
    },
    waiting: {
      background: theme.colors.surfaceVariant,
      text: theme.colors.onSurfaceVariant,
      label: "Waiting",
    },
    closed: {
      background: theme.colors.surfaceVariant,
      text: theme.colors.onSurfaceVariant,
      label: "Closed",
    },
  };

  return (
    <SafeAreaView style={[s.screen, { backgroundColor: theme.colors.background }]}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />
      <Appbar.Header style={{ backgroundColor: theme.colors.surface }} elevated>
        <Appbar.Content title="Stopwatch" />
      </Appbar.Header>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <PaperText variant="headlineSmall" style={{ marginBottom: 4 }}>
          {greeting}
        </PaperText>
        <PaperText variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 24 }}>
          Create a shared timing session or go solo.
        </PaperText>

        {/* Primary actions */}
        <Button mode="contained" onPress={onNewSession} style={{ marginBottom: 10 }}>
          + New session
        </Button>

        <Button mode="outlined" onPress={onSolo} style={{ marginBottom: 28 }}>
          Solo stopwatch
        </Button>

        {/* Session history */}
        <PaperText variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
          MY SESSIONS
        </PaperText>

        {loading ? (
          <PaperActivityIndicator style={{ marginTop: 24 }} />
        ) : sessions.length === 0 ? (
          <PaperText
            variant="bodyMedium"
            style={{ marginTop: 16, textAlign: "center", color: theme.colors.onSurfaceVariant }}
          >
            No sessions yet. Create one above.
          </PaperText>
        ) : (
          sessions.map((session) => {
            const status = statusColors[session.status];
            const actionLabel =
              session.status === "stopped"
                ? "View results →"
                : session.status === "closed"
                ? "View →"
                : "Rejoin →";
            return (
              <Card key={session.id} mode="outlined" style={{ marginBottom: 10 }}>
                <List.Item
                  title={session.name || "Untitled Session"}
                  titleNumberOfLines={1}
                  onPress={() => handleRejoin(session)}
                  description={() => (
                    <View>
                      <PaperText variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                        {fmtAge(session.created_at)} · Code {session.code}
                      </PaperText>
                      <PaperText variant="bodySmall" style={{ color: theme.colors.primary, fontWeight: "600", marginTop: 2 }}>
                        {actionLabel}
                      </PaperText>
                    </View>
                  )}
                  right={() => (
                    <Chip
                      compact
                      style={{ backgroundColor: status.background, alignSelf: "center" }}
                      textStyle={{ color: status.text, fontWeight: "700", fontSize: 11 }}
                    >
                      {status.label}
                    </Chip>
                  )}
                />
                <View style={s.sessionActionsRow}>
                  {session.status !== "closed" && (
                    <Button
                      mode="text"
                      compact
                      disabled={actionPendingId === session.id}
                      onPress={() => handleCloseSession(session)}
                    >
                      Close
                    </Button>
                  )}
                  <Button
                    mode="text"
                    compact
                    textColor={theme.colors.error}
                    disabled={actionPendingId === session.id}
                    onPress={() => handleDeleteSession(session)}
                  >
                    Delete
                  </Button>
                </View>
              </Card>
            );
          })
        )}

        {/* Sign out */}
        <Button mode="text" onPress={onSignOut} style={{ marginTop: 32 }}>
          Sign out
        </Button>

        {/* Help */}
        <Button
          mode="text"
          compact
          onPress={() => ExpoLinking.openURL("https://splitsync.org/help")}
        >
          Help &amp; about
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Screen: Create ─────────────────────────────────────────────────────────────
function CreateScreen({
  onCreated,
  onBack,
}: {
  onCreated: (params: SessionNavParams) => void;
  onBack: () => void;
}) {
  const [sessionName, setSessionName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!sessionName.trim()) {
      setError("Session name is required.");
      return;
    }
    if (!displayName.trim()) {
      setError("Your display name is required.");
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc(
      "create_casual_session",
      {
        p_name: sessionName.trim(),
        p_display_name: displayName.trim(),
      }
    );

    if (rpcError || !data) {
      setError(rpcError?.message ?? "Failed to create session.");
      setLoading(false);
      return;
    }

    const result = data as {
      session_id: string;
      participant_id: string;
      code: string;
    };

    // Persist participant_id so owner can rejoin
    await AsyncStorage.setItem(
      `session_participant_${result.session_id}`,
      result.participant_id
    );

    // Show share sheet
    const shareUrl = `https://splitsync.org/stopwatch/s/${result.code}`;
    await Share.share({
      message: `Join my SplitSync timing session: ${shareUrl}`,
      url: shareUrl,
    }).catch(() => undefined); // non-fatal if user dismisses

    setLoading(false);
    onCreated({
      sessionId: result.session_id,
      participantId: result.participant_id,
      sessionCode: result.code,
      sessionName: sessionName.trim(),
      isOwner: true,
      initialStatus: "waiting",
      initialT0Server: null,
      initialParticipants: [
        { id: result.participant_id, display_name: displayName.trim(), is_owner: true },
      ],
      initialEvents: [],
    });
  }, [sessionName, displayName, onCreated]);

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />
      <CasingBar
        title="NEW SESSION"
        rightSlot={
          <Pressable onPress={onBack} style={s.backBtn}>
            <Text style={s.backBtnText}>← Back</Text>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 28 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[s.mutedText, { marginBottom: 24 }]}>
          Name your session and choose a display name. Others join via the link
          you share.
        </Text>

        <PaperTextInput
          mode="outlined"
          label="Session name"
          value={sessionName}
          onChangeText={setSessionName}
          placeholder="e.g. Tuesday Hill Climb"
          autoCapitalize="words"
          autoCorrect={false}
          error={!!error}
          style={{ marginBottom: 4 }}
        />
        <View style={{ marginBottom: 14 }} />

        <PaperTextInput
          mode="outlined"
          label="Your display name"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="e.g. Coach Alex"
          autoCapitalize="words"
          autoCorrect={false}
          error={!!error}
          style={{ marginBottom: 4 }}
        />

        <HelperText type="error" visible={!!error}>
          {error ?? ""}
        </HelperText>

        <PaperButton
          mode="contained"
          onPress={handleCreate}
          disabled={loading}
          loading={loading}
          style={{ marginTop: 8 }}
          contentStyle={{ paddingVertical: 4 }}
        >
          Start session
        </PaperButton>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Screen: Join ───────────────────────────────────────────────────────────────
function JoinScreen({
  pendingCode,
  onJoined,
  onView,
  onBack,
}: {
  pendingCode: string | null;
  onJoined: (params: SessionNavParams) => void;
  onView: (code: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState(pendingCode ?? "");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = useCallback(async () => {
    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode.length !== 6) {
      setError("Session code must be 6 characters.");
      return;
    }
    if (!displayName.trim()) {
      setError("Display name is required.");
      return;
    }
    setLoading(true);
    setError(null);

    // Get or generate a stable client_id for this device+session combination
    const clientIdKey = `client_id_${trimmedCode}`;
    let clientId = await AsyncStorage.getItem(clientIdKey);
    if (!clientId) {
      clientId = generateUUID();
      await AsyncStorage.setItem(clientIdKey, clientId);
    }

    const { data, error: rpcError } = await supabase.rpc(
      "join_casual_session",
      {
        p_code: trimmedCode,
        p_display_name: displayName.trim(),
        p_client_id: clientId,
      }
    );

    if (rpcError || !data) {
      setError(
        rpcError?.message ?? "Failed to join session. Check the code and try again."
      );
      setLoading(false);
      return;
    }

    const result = data as {
      session_id: string;
      participant_id: string;
      session_name: string;
      status: SessionStatus;
      t0_server: string | null;
      participants: Participant[];
      events: SessionEvent[];
    };

    // Persist participant_id for this session
    await AsyncStorage.setItem(
      `session_participant_${result.session_id}`,
      result.participant_id
    );

    setLoading(false);
    onJoined({
      sessionId: result.session_id,
      participantId: result.participant_id,
      sessionCode: trimmedCode,
      sessionName: result.session_name ?? trimmedCode,
      isOwner: false,
      initialStatus: result.status ?? "waiting",
      initialT0Server: result.t0_server ?? null,
      initialParticipants: result.participants ?? [],
      initialEvents: result.events ?? [],
    });
  }, [code, displayName, onJoined]);

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />
      <CasingBar
        title="JOIN SESSION"
        rightSlot={
          <Pressable onPress={onBack} style={s.backBtn}>
            <Text style={s.backBtnText}>← Back</Text>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 28 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[s.mutedText, { marginBottom: 24 }]}>
          Enter the 6-character session code and choose a name others will see.
        </Text>

        <PaperTextInput
          mode="outlined"
          label="Session code"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="AB3K9X"
          autoCapitalize="characters"
          autoCorrect={false}
          error={!!error}
          style={{ marginBottom: 4 }}
        />
        <View style={{ marginBottom: 14 }} />

        <PaperTextInput
          mode="outlined"
          label="Your display name"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="e.g. Jamie"
          autoCapitalize="words"
          autoCorrect={false}
          error={!!error}
          style={{ marginBottom: 4 }}
        />

        <HelperText type="error" visible={!!error}>
          {error ?? ""}
        </HelperText>

        <PaperButton
          mode="contained"
          onPress={handleJoin}
          disabled={loading}
          loading={loading}
          style={{ marginTop: 8 }}
          contentStyle={{ paddingVertical: 4 }}
        >
          Join
        </PaperButton>
        <PaperButton
          mode="outlined"
          onPress={() => onView(code.trim().toUpperCase())}
          disabled={code.trim().length !== 6}
          style={{ marginTop: 12 }}
          contentStyle={{ paddingVertical: 4 }}
        >
          View only
        </PaperButton>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Screen: Live viewer ───────────────────────────────────────────────────────
// A viewer has only a code. The live-view RPC omits all bearer identifiers, and
// Broadcast is used solely to prompt an authoritative RPC refresh.
function LiveViewerScreen({ code, fontsLoaded, onBack }: { code: string; fontsLoaded: boolean; onBack: () => void }) {
  useKeepAwake();
  const { width, height } = useWindowDimensions();
  const [payload, setPayload] = useState<{
    session: { name: string; status: "waiting" | "running" | "stopped"; t0_server: string | null };
    participants: { display_name: string; is_owner: boolean }[];
    events: { event_type: SessionEventType; client_recorded_at: string; actor_name: string; sequence: number }[];
  } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_casual_session_live_view", { p_code: code });
    if (error || !data) { setUnavailable(true); return; }
    setPayload(data as NonNullable<typeof payload>);
  }, [code]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const channel = supabase.channel(`stopwatch:${code}`)
      .on("broadcast", { event: "session_event" }, refresh)
      .on("broadcast", { event: "participant_joined" }, refresh)
      .on("broadcast", { event: "participant_left" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [code, refresh]);
  useEffect(() => {
    const tick = setInterval(() => {
      if (payload?.session.status === "running" && payload.session.t0_server) setElapsedMs(Math.max(0, Date.now() - new Date(payload.session.t0_server).getTime()));
    }, 30);
    return () => clearInterval(tick);
  }, [payload?.session.status, payload?.session.t0_server]);
  const laps = useMemo(() => {
    let previous: string | null = null;
    let total = 0;
    const derived: DerivedLap[] = [];
    for (const event of [...(payload?.events ?? [])].sort((a, b) => a.sequence - b.sequence)) {
      if (event.event_type === "reset") { previous = null; total = 0; derived.length = 0; }
      else if (event.event_type === "start") previous = event.client_recorded_at;
      else if (event.event_type === "lap" && previous) {
        const splitMs = new Date(event.client_recorded_at).getTime() - new Date(previous).getTime();
        total += splitMs;
        derived.push({ lapNum: derived.length + 1, splitMs, cumulativeMs: total, actorName: event.actor_name });
        previous = event.client_recorded_at;
      }
    }
    return derived.reverse();
  }, [payload]);
  return <SafeAreaView style={s.screen}>
    <StatusBar barStyle="light-content" backgroundColor={C.casing} />
    <CasingBar title={payload?.session.name ?? "LIVE VIEW"} rightSlot={<Pressable onPress={onBack} style={s.backBtn}><Text style={s.backBtnText}>← Back</Text></Pressable>} />
    {unavailable ? <View style={s.together}><Text style={s.mutedText}>This live session is unavailable.</Text></View> : !payload ? <View style={s.together}><ActivityIndicator color={C.ink} /></View> : <>
      <ScrollView horizontal style={s.participantStrip} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6 }}><Text style={s.instrLabel}>VIEW ONLY · {payload.session.status.toUpperCase()}</Text>{payload.participants.map((participant, index) => <View key={`${participant.display_name}-${index}`} style={s.participantPill}><Text style={s.participantPillText}>{participant.display_name}{participant.is_owner ? " ★" : ""}</Text></View>)}</ScrollView>
      <View style={s.instrument}><View style={s.instrHeader}><Text style={s.instrLabel}>LIVE RIDER DISPLAY</Text><Text style={[s.instrLabel, { marginLeft: "auto" as unknown as number }]}>{code}</Text></View><View style={s.instrMain}><LcdDisplay ms={elapsedMs} mainSize={lcdMainSize(width, height)} fontLoaded={fontsLoaded} /></View></View>
      {laps.length ? <View style={s.table}><View style={s.tableHead}><Text style={[s.th, s.cLap]}>LAP</Text><Text style={[s.th, s.cSplit]}>SPLIT</Text><Text style={[s.th, s.cTime]}>TIME</Text><Text style={[s.th, s.cActor]}>BY</Text></View><FlatList data={laps} keyExtractor={(lap) => String(lap.lapNum)} renderItem={({ item }) => <View style={s.tableRow}><Text style={[s.td, s.cLap]}>{item.lapNum}</Text><Text style={[s.td, s.cSplit]}>{fmtCompact(item.splitMs)}</Text><Text style={[s.td, s.cTime]}>{fmtCompact(item.cumulativeMs)}</Text><Text style={[s.td, s.cActor]}>{item.actorName}</Text></View>} /></View> : <View style={s.together}><Text style={s.mutedText}>Waiting for laps…</Text></View>}
    </>}
  </SafeAreaView>;
}

// ── Durable offline queue ──────────────────────────────────────────────────────
// Events are persisted to AsyncStorage keyed by session code so they survive
// app kill during a connectivity gap. The idempotency key (client_event_id)
// ensures the server upsert is safe to replay (ON CONFLICT DO NOTHING).
// See ADR docs/adr/0018-stopwatch-durable-offline-queue.md.

interface DurableQueueEntry {
  client_event_id: string;
  event_type: SessionEventType;
  client_recorded_at: string;
  /** Local monotonic sequence — preserves recording order across replay. */
  sequence: number;
  sessionCode: string;
}

function durableQueueKey(sessionCode: string): string {
  return `pending_events_${sessionCode}`;
}

async function loadDurableQueue(sessionCode: string): Promise<DurableQueueEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(durableQueueKey(sessionCode));
    return raw ? (JSON.parse(raw) as DurableQueueEntry[]) : [];
  } catch {
    return [];
  }
}

async function saveDurableQueue(
  sessionCode: string,
  queue: DurableQueueEntry[]
): Promise<void> {
  try {
    await AsyncStorage.setItem(durableQueueKey(sessionCode), JSON.stringify(queue));
  } catch (err) {
    // Non-fatal: in-memory optimistic queue still handles the current run.
    console.warn("Failed to persist durable event queue", err);
  }
}

async function addToDurableQueue(
  sessionCode: string,
  entry: DurableQueueEntry
): Promise<void> {
  const queue = await loadDurableQueue(sessionCode);
  queue.push(entry);
  await saveDurableQueue(sessionCode, queue);
}

async function removeFromDurableQueue(
  sessionCode: string,
  clientEventId: string
): Promise<void> {
  const queue = await loadDurableQueue(sessionCode);
  const filtered = queue.filter((e) => e.client_event_id !== clientEventId);
  await saveDurableQueue(sessionCode, filtered);
}

// ── Screen: Session (shared stopwatch) ────────────────────────────────────────
function SessionScreen({
  params,
  fontsLoaded,
  onBack,
}: {
  params: SessionNavParams;
  fontsLoaded: boolean;
  onBack: () => void;
}) {
  useKeepAwake();
  const { width, height } = useWindowDimensions();

  // ── State ───────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<SessionStatus>(params.initialStatus);
  const [t0Server, setT0Server] = useState<string | null>(params.initialT0Server);
  const [participants, setParticipants] = useState<Participant[]>(
    params.initialParticipants
  );
  const [events, setEvents] = useState<SessionEvent[]>(params.initialEvents);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pendingQueue, setPendingQueue] = useState<
    Array<{
      type: SessionEventType;
      clientEventId: string;
      clientRecordedAt: string;
    }>
  >([]);
  /** Tracks durable (AsyncStorage) queue depth for the pending indicator. */
  const [durableQueueDepth, setDurableQueueDepth] = useState(0);

  // Lock state — local to this device, never broadcast
  const [isLocked, setIsLocked] = useState(false);
  const [showLockHint, setShowLockHint] = useState(false);
  const lockHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stop-while-locked confirmation: ms captured at the tap instant, or null.
  const [pendingStopMs, setPendingStopMs] = useState<number | null>(null);
  // ISO timestamp captured at the Stop tap — used as client_recorded_at on confirm.
  const pendingStopAtRef = useRef<string | null>(null);

  // Sound cues (#227)
  const { cueSettings, cueRef, updateCueSettings } = useCueSettings();
  const [showCuePanel, setShowCuePanel] = useState(false);
  const targetFiredRef = useRef(false);

  // Clock sync: clientT0 = Date.now() when we first learn t0_server
  const clientT0Ref = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSequenceRef = useRef(
    events.length > 0 ? Math.max(...events.map((e) => e.sequence)) : 0
  );
  // The realtime channel effect deliberately does not depend on `events`
  // (re-subscribing on every event would churn the channel), so broadcast
  // handlers must read the current event list through this ref.
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  /** Local monotonic counter — ensures replay order is preserved after app kill. */
  const localSeqRef = useRef(0);
  // ── Reconnect-storm guards (#344) ─────────────────────────────────────────
  // Supabase's realtime client retries the socket/channel join internally;
  // every failed retry re-fires our `CHANNEL_ERROR` status callback. Without
  // these guards, a flaky connection triggers overlapping rebuild/flush
  // cycles in a tight loop, saturating the JS thread with state updates.
  const recoveryInFlightRef = useRef(false);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryBackoffMsRef = useRef(0);
  const rebuildInFlightRef = useRef(false);
  const flushInFlightRef = useRef(false);

  // ── Derived lap table ───────────────────────────────────────────────────────
  const laps = useMemo<DerivedLap[]>(() => {
    // Ordered events (ascending sequence)
    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    // Find start event (the one right after last reset, or the first start)
    let baseAt: Date | null = null;
    let prevAt: Date | null = null;
    const derived: DerivedLap[] = [];

    for (const ev of sorted) {
      if (ev.event_type === "reset") {
        baseAt = null;
        prevAt = null;
        derived.length = 0;
      } else if (ev.event_type === "start") {
        baseAt = new Date(ev.client_recorded_at);
        prevAt = baseAt;
      } else if (ev.event_type === "lap" && baseAt && prevAt) {
        const now = new Date(ev.client_recorded_at);
        const splitMs = now.getTime() - prevAt.getTime();
        const cumulativeMs = now.getTime() - baseAt.getTime();
        const actor = participants.find(
          (p) => p.id === ev.actor_participant_id
        );
        derived.push({
          lapNum: derived.length + 1,
          splitMs,
          cumulativeMs,
          actorName: actor?.display_name ?? "Unknown",
        });
        prevAt = now;
      }
    }
    return derived.reverse(); // newest first
  }, [events, participants]);

  // Best / worst / avg laps (derived, never persisted — invariant #2)
  const showSessionStats = laps.length >= 2;
  const bestMs = useMemo(
    () =>
      laps.length < 2
        ? null
        : Math.min(...laps.map((l) => l.splitMs)),
    [laps]
  );
  const worstMs = useMemo(
    () =>
      laps.length < 2
        ? null
        : Math.max(...laps.map((l) => l.splitMs)),
    [laps]
  );
  const avgMs = useMemo(
    () =>
      laps.length < 2
        ? null
        : laps.reduce((sum, l) => sum + l.splitMs, 0) / laps.length,
    [laps]
  );

  // Fire the target cue once when elapsed time crosses the target (#227)
  const checkTarget = useCallback(
    (elapsed: number) => {
      const cfg = cueRef.current;
      if (!cfg.targetEnabled || targetFiredRef.current) return;
      if (elapsed >= cfg.targetMs) {
        targetFiredRef.current = true;
        playCue("target");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    },
    [cueRef]
  );

  // Final total (start → stop) derived from the event log — for result export
  const finalTotalMs = useMemo<number | null>(() => {
    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    let baseAt: Date | null = null;
    let total: number | null = null;
    for (const ev of sorted) {
      if (ev.event_type === "reset") {
        baseAt = null;
        total = null;
      } else if (ev.event_type === "start") {
        baseAt = new Date(ev.client_recorded_at);
      } else if (ev.event_type === "stop" && baseAt) {
        total = new Date(ev.client_recorded_at).getTime() - baseAt.getTime();
      }
    }
    return total;
  }, [events]);

  // ── Clock tick ──────────────────────────────────────────────────────────────
  const startTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (clientT0Ref.current !== null) {
        const elapsed = Date.now() - clientT0Ref.current;
        setElapsedMs(elapsed);
        checkTarget(elapsed);
      }
    }, 30);
  }, [checkTarget]);

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => () => stopTick(), [stopTick]);

  // ── Process incoming event ──────────────────────────────────────────────────
  const applyEvent = useCallback(
    (ev: SessionEvent) => {
      setEvents((prev) => {
        if (prev.some((e) => e.id === ev.id)) return prev;
        return [...prev, ev];
      });

      if (ev.sequence > lastSequenceRef.current) {
        lastSequenceRef.current = ev.sequence;
      }

      if (ev.event_type === "start") {
        // `record_session_event` returns a row from `casual_session_events`,
        // which has no `t0_server` column (that lives on `casual_sessions`
        // only) — so `ev.t0_server` is always absent here. Only refine the
        // clock-sync timestamp when present; never gate the status
        // transition on it, or Start silently does nothing (#339).
        if (ev.t0_server) {
          setT0Server(ev.t0_server);
        }
        clientT0Ref.current = Date.now();
        targetFiredRef.current = false;
        setStatus("running");
        startTick();
      } else if (ev.event_type === "stop") {
        setStatus("stopped");
        stopTick();
      } else if (ev.event_type === "reset") {
        setT0Server(null);
        clientT0Ref.current = null;
        targetFiredRef.current = false;
        setStatus("waiting");
        setElapsedMs(0);
        stopTick();
      }
      // lap events just update the events list; laps are derived
    },
    [startTick, stopTick]
  );

  // Batched counterpart to `applyEvent`, used for `sync_response` catch-up
  // payloads (#344). A single `setEvents` call merges the whole batch instead
  // of one state update (and one full FlatList re-render pass) per event —
  // important because a resync burst after a reconnect can carry many events
  // at once, and naive per-event application is O(n²) in the number of laps.
  const applyEventsBatch = useCallback(
    (incoming: SessionEvent[]) => {
      if (incoming.length === 0) return;

      setEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const toAdd = incoming.filter((e) => !existingIds.has(e.id));
        if (toAdd.length === 0) return prev;
        return [...prev, ...toAdd];
      });

      // Replay status-affecting event types (start/stop/reset) in sequence
      // order, but only commit the final resulting state once.
      const sorted = [...incoming].sort((a, b) => a.sequence - b.sequence);
      let nextStatus: SessionStatus | null = null;
      let nextT0Server: string | null | undefined; // undefined = no change
      let nextClientT0: number | null | undefined;
      let clearElapsed = false;

      for (const ev of sorted) {
        if (ev.sequence > lastSequenceRef.current) {
          lastSequenceRef.current = ev.sequence;
        }
        if (ev.event_type === "start") {
          if (ev.t0_server) nextT0Server = ev.t0_server;
          nextClientT0 = Date.now();
          nextStatus = "running";
          clearElapsed = false;
        } else if (ev.event_type === "stop") {
          nextStatus = "stopped";
        } else if (ev.event_type === "reset") {
          nextT0Server = null;
          nextClientT0 = null;
          nextStatus = "waiting";
          clearElapsed = true;
        }
      }

      if (nextStatus === "running") {
        targetFiredRef.current = false;
        if (nextT0Server !== undefined) setT0Server(nextT0Server);
        clientT0Ref.current = nextClientT0 ?? Date.now();
        setStatus("running");
        startTick();
      } else if (nextStatus === "stopped") {
        setStatus("stopped");
        stopTick();
      } else if (nextStatus === "waiting") {
        setT0Server(null);
        clientT0Ref.current = null;
        targetFiredRef.current = false;
        setStatus("waiting");
        if (clearElapsed) setElapsedMs(0);
        stopTick();
      }
    },
    [startTick, stopTick]
  );

  // If session was already running on mount, start ticking from known offset.
  // Also initialise the durable queue depth indicator from AsyncStorage.
  useEffect(() => {
    if (status === "running" && t0Server) {
      clientT0Ref.current = Date.now() - (Date.now() - new Date(t0Server).getTime());
      // Simplified: clientT0 = mount time, elapsed from server T0
      clientT0Ref.current =
        Date.now() - Math.max(0, Date.now() - new Date(t0Server).getTime());
      startTick();
    }
    // Load the durable queue depth so the pending indicator is correct immediately
    // on relaunch (the channel subscription will trigger flushDurableQueue shortly).
    loadDurableQueue(params.sessionCode).then((q) => {
      setDurableQueueDepth(q.length);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // ── Ongoing Android notification while running (#231) ──────────────────────
  useEffect(() => {
    if (status === "running" && clientT0Ref.current !== null) {
      showRunningNotification(params.sessionName, clientT0Ref.current);
    } else {
      clearRunningNotification();
    }
  }, [status, params.sessionName]);
  useEffect(() => () => clearRunningNotification(), []);

  // ── Realtime subscription ───────────────────────────────────────────────────
  const rebuildFromServer = useCallback(async () => {
    // Guard: a rebuild already in flight (e.g. from an overlapping reconnect)
    // should not be duplicated — the caller that's already running will
    // leave state consistent.
    if (rebuildInFlightRef.current) return;
    rebuildInFlightRef.current = true;
    try {
      const { data } = await supabase.rpc("get_session_state", {
        p_session_id: params.sessionId,
        p_participant_id: params.participantId,
      });
      if (!data) return;
      const state = data as {
        status: SessionStatus;
        t0_server: string | null;
        events: SessionEvent[];
        participants: Participant[];
      };
      setStatus(state.status);
      setT0Server(state.t0_server ?? null);
      setParticipants(state.participants ?? []);
      setEvents(state.events ?? []);
      if (state.status === "running" && state.t0_server) {
        clientT0Ref.current =
          Date.now() -
          Math.max(0, Date.now() - new Date(state.t0_server).getTime());
        startTick();
      } else {
        stopTick();
      }
      return state;
    } finally {
      rebuildInFlightRef.current = false;
    }
  }, [params.sessionId, params.participantId, startTick, stopTick]);

  // ── Durable queue flush ──────────────────────────────────────────────────────
  // Called on mount and on channel reconnect. Reconciles the durable queue
  // against server state, drops events the server already accepted, then
  // replays the rest in local-sequence order (preserving original timestamps).
  const flushDurableQueue = useCallback(async () => {
    // Guard: prevent overlapping flushes racing each other during a
    // reconnect storm — each would otherwise replay/dedupe the same queue.
    if (flushInFlightRef.current) return;
    flushInFlightRef.current = true;
    try {
      const queue = await loadDurableQueue(params.sessionCode);
      if (queue.length === 0) {
        setDurableQueueDepth(0);
        return;
      }

      // Fetch server state to reconcile (reuse rebuildFromServer side-effects).
      const { data } = await supabase.rpc("get_session_state", {
        p_session_id: params.sessionId,
        p_participant_id: params.participantId,
      });

      const serverEventIds = new Set<string>();
      if (data) {
        const state = data as { events: SessionEvent[] };
        (state.events ?? []).forEach((e) => serverEventIds.add(e.id));
      }

      // Filter out events the server already accepted (idempotency reconciliation).
      const toReplay = queue
        .filter((e) => !serverEventIds.has(e.client_event_id))
        .sort((a, b) => a.sequence - b.sequence);

      // Drop already-acknowledged entries from durable storage right away.
      const alreadyAcked = queue.filter((e) => serverEventIds.has(e.client_event_id));
      for (const e of alreadyAcked) {
        await removeFromDurableQueue(params.sessionCode, e.client_event_id);
      }

      // Replay unacknowledged events in order.
      for (const entry of toReplay) {
        const { data: evData, error } = await supabase.rpc("record_session_event", {
          p_session_id: params.sessionId,
          p_participant_id: params.participantId,
          p_event_type: entry.event_type,
          p_client_recorded_at: entry.client_recorded_at,
          p_client_event_id: entry.client_event_id,
        });

        if (!error) {
          await removeFromDurableQueue(params.sessionCode, entry.client_event_id);
          if (evData) {
            const accepted = evData as SessionEvent;
            channelRef.current?.send({
              type: "broadcast",
              event: "session_event",
              payload: accepted,
            });
            applyEvent(accepted);
          }
        } else {
          // Concurrency or permission error — stop replay; full rebuild will sync state.
          break;
        }
      }

      // Update the indicator to reflect what's left.
      const remaining = await loadDurableQueue(params.sessionCode);
      setDurableQueueDepth(remaining.length);
    } finally {
      flushInFlightRef.current = false;
    }
  }, [params.sessionCode, params.sessionId, params.participantId, applyEvent]);

  useEffect(() => {
    const channel = supabase.channel(`stopwatch:${params.sessionCode}`);

    channel
      .on(
        "broadcast",
        { event: "session_event" },
        (msg: { type: string; event: string; payload: Record<string, unknown> }) => {
          const ev = msg.payload as unknown as SessionEvent;
          applyEvent(ev);
        }
      )
      .on(
        "broadcast",
        { event: "participant_joined" },
        (msg: { type: string; event: string; payload: Record<string, unknown> }) => {
          const p = msg.payload as unknown as Participant;
          setParticipants((prev) => {
            if (prev.some((x) => x.id === p.id)) return prev;
            return [...prev, p];
          });
        }
      )
      .on(
        "broadcast",
        { event: "sync_request" },
        (msg: { type: string; event: string; payload: Record<string, unknown> }) => {
          const lastSeq = (msg.payload as { last_sequence: number }).last_sequence ?? 0;
          // Respond with events this client has that are newer.
          // Read through eventsRef: the closure's `events` would be stale
          // because this effect doesn't re-run on event changes.
          const missing = eventsRef.current.filter((e) => e.sequence > lastSeq);
          if (missing.length > 0) {
            channel.send({
              type: "broadcast",
              event: "sync_response",
              payload: { events: missing },
            });
          }
        }
      )
      .on(
        "broadcast",
        { event: "sync_response" },
        (msg: { type: string; event: string; payload: Record<string, unknown> }) => {
          const incoming = (msg.payload as { events: SessionEvent[] }).events ?? [];
          applyEventsBatch(incoming);
        }
      )
      .on("broadcast", { event: "session_closed" }, () => {
        // Owner closed the session from this device or another one (#345).
        setStatus("closed");
        stopTick();
      })
      .on("broadcast", { event: "session_deleted" }, () => {
        Alert.alert(
          "Session deleted",
          "The host deleted this session.",
          [{ text: "OK", onPress: () => onBack() }]
        );
      })
      .subscribe((subscribeStatus) => {
        if (subscribeStatus === "SUBSCRIBED") {
          // A successful (re)subscribe means the connection is healthy again —
          // reset the backoff so the next transient error starts fresh.
          recoveryBackoffMsRef.current = 0;
          if (recoveryTimerRef.current) {
            clearTimeout(recoveryTimerRef.current);
            recoveryTimerRef.current = null;
          }
          // Announce presence
          channel.send({
            type: "broadcast",
            event: "participant_joined",
            payload: {
              id: params.participantId,
              display_name:
                participants.find((p) => p.id === params.participantId)
                  ?.display_name ?? "",
              is_owner: params.isOwner,
            },
          });
          // Request catch-up
          if (lastSequenceRef.current > 0) {
            channel.send({
              type: "broadcast",
              event: "sync_request",
              payload: { last_sequence: lastSequenceRef.current },
            });
          }
          // Flush any events that were queued offline / during a previous kill.
          flushDurableQueue();
        } else if (
          subscribeStatus === "CHANNEL_ERROR" ||
          subscribeStatus === "TIMED_OUT"
        ) {
          // Supabase's client already retries the underlying socket/channel
          // join on its own; this callback can re-fire on every failed retry.
          // Debounce with exponential backoff and a single in-flight guard so
          // a flaky connection can't spawn overlapping rebuild/flush cycles
          // (#344 — this was the primary cause of the shared-session freeze).
          if (recoveryTimerRef.current || recoveryInFlightRef.current) return;
          const delay = Math.min(
            recoveryBackoffMsRef.current || 1000,
            30000
          );
          recoveryTimerRef.current = setTimeout(() => {
            recoveryTimerRef.current = null;
            recoveryInFlightRef.current = true;
            rebuildFromServer()
              .then(() => flushDurableQueue())
              .finally(() => {
                recoveryInFlightRef.current = false;
              });
          }, delay);
          recoveryBackoffMsRef.current = Math.min(
            (recoveryBackoffMsRef.current || 1000) * 2,
            30000
          );
        }
      });

    channelRef.current = channel;

    return () => {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
      channel.send({
        type: "broadcast",
        event: "participant_left",
        payload: { participant_id: params.participantId },
      });
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.sessionCode, params.sessionId, params.participantId]);

  // ── Send event to server ────────────────────────────────────────────────────
  const sendEvent = useCallback(
    async (eventType: SessionEventType, recordedAt?: string) => {
      const clientEventId = generateUUID();
      const clientRecordedAt = recordedAt ?? new Date().toISOString();
      const localSeq = ++localSeqRef.current;

      // 1. Persist to durable queue BEFORE the network attempt — survives app kill.
      const durableEntry: DurableQueueEntry = {
        client_event_id: clientEventId,
        event_type: eventType,
        client_recorded_at: clientRecordedAt,
        sequence: localSeq,
        sessionCode: params.sessionCode,
      };
      await addToDurableQueue(params.sessionCode, durableEntry);
      setDurableQueueDepth((d) => d + 1);

      // 2. Optimistic in-memory queue (drives spinner while inflight).
      setPendingQueue((q) => [...q, { type: eventType, clientEventId, clientRecordedAt }]);

      const { data, error } = await supabase.rpc("record_session_event", {
        p_session_id: params.sessionId,
        p_participant_id: params.participantId,
        p_event_type: eventType,
        p_client_recorded_at: clientRecordedAt,
        p_client_event_id: clientEventId,
      });

      setPendingQueue((q) => q.filter((e) => e.clientEventId !== clientEventId));

      if (error) {
        if (error.message?.includes("SESSION_CLOSED")) {
          // Permanent rejection — the host closed the session. Unlike
          // transient/concurrency errors, retrying this on reconnect would
          // fail forever, so drop it from the durable queue instead of
          // leaving it to be replayed indefinitely (#345).
          await removeFromDurableQueue(params.sessionCode, clientEventId);
          setStatus("closed");
          stopTick();
          const remaining = await loadDurableQueue(params.sessionCode);
          setDurableQueueDepth(remaining.length);
          return;
        }
        // Network error or concurrency rejection.
        // The event stays in the durable queue and will be replayed on reconnect.
        // Rebuild server state to stay consistent for concurrency errors.
        await rebuildFromServer();
        // Re-sync the depth indicator from durable storage.
        const remaining = await loadDurableQueue(params.sessionCode);
        setDurableQueueDepth(remaining.length);
        return;
      }

      // 3. Success: remove from durable queue.
      await removeFromDurableQueue(params.sessionCode, clientEventId);
      setDurableQueueDepth((d) => Math.max(0, d - 1));

      if (data) {
        const accepted = data as SessionEvent;
        // Broadcast to peers
        channelRef.current?.send({
          type: "broadcast",
          event: "session_event",
          payload: accepted,
        });
        applyEvent(accepted);
      }
    },
    [
      params.sessionId,
      params.participantId,
      params.sessionCode,
      applyEvent,
      rebuildFromServer,
      stopTick,
    ]
  );

  // ── Lock helpers ────────────────────────────────────────────────────────────
  const showLockedHint = useCallback(() => {
    setShowLockHint(true);
    if (lockHintTimerRef.current) clearTimeout(lockHintTimerRef.current);
    lockHintTimerRef.current = setTimeout(() => setShowLockHint(false), 2000);
  }, []);

  const handleLockToggle = useCallback(() => {
    if (!isLocked) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsLocked(true);
    }
  }, [isLocked]);

  const handleUnlock = useCallback(() => {
    if (isLocked) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setIsLocked(false);
      setShowLockHint(false);
      if (lockHintTimerRef.current) clearTimeout(lockHintTimerRef.current);
    }
  }, [isLocked]);

  const handleLockTap = useDoubleTap(handleUnlock, handleLockToggle);

  // ── Button handlers ─────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (cueRef.current.soundEnabled) playCue("start");
    await sendEvent("start");
  }, [sendEvent, cueRef]);

  const handleStop = useCallback(async () => {
    if (isLocked) {
      // Capture the exact moment the user tapped Stop, then ask for
      // confirmation. If they confirm we send the event with the captured
      // timestamp so the split is accurate regardless of dialog latency.
      const capturedAt = new Date().toISOString();
      pendingStopAtRef.current = capturedAt;
      setPendingStopMs(elapsedMs);
      Alert.alert(
        "Stop timer?",
        `Stop at ${fmtCompact(elapsedMs)}?\n\nThe split will be recorded at this exact time.`,
        [
          {
            text: "Keep running",
            style: "cancel",
            onPress: () => {
              pendingStopAtRef.current = null;
              setPendingStopMs(null);
            },
          },
          {
            text: "Stop",
            style: "destructive",
            onPress: async () => {
              const at = pendingStopAtRef.current;
              pendingStopAtRef.current = null;
              setPendingStopMs(null);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              if (cueRef.current.soundEnabled) playCue("stop");
              await sendEvent("stop", at ?? undefined);
            },
          },
        ],
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (cueRef.current.soundEnabled) playCue("stop");
    await sendEvent("stop");
  }, [isLocked, elapsedMs, sendEvent, cueRef]);

  const handleLap = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (cueRef.current.soundEnabled) playCue("lap");
    await sendEvent("lap");
  }, [sendEvent, cueRef]);

  const handleReset = useCallback(async () => {
    if (isLocked) { showLockedHint(); return; }
    if (!params.isOwner) {
      Alert.alert("Owner only", "Only the session creator can reset.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await sendEvent("reset");
  }, [params.isOwner, sendEvent]);

  // ── Owner session management: close/delete (#345) ──────────────────────────
  const handleCloseSession = useCallback(() => {
    if (!params.isOwner) return;
    Alert.alert(
      "Close session?",
      "No one will be able to join or record new laps.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Close session",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase.rpc("close_casual_session", {
              p_session_id: params.sessionId,
            });
            if (error) {
              Alert.alert("Error", error.message ?? "Failed to close session.");
              return;
            }
            setStatus("closed");
            stopTick();
            // Notify connected peers immediately rather than waiting for
            // them to hit SESSION_CLOSED on their next action.
            channelRef.current?.send({
              type: "broadcast",
              event: "session_closed",
              payload: {},
            });
          },
        },
      ]
    );
  }, [params.isOwner, params.sessionId, stopTick]);

  const handleDeleteSession = useCallback(() => {
    if (!params.isOwner) return;
    Alert.alert(
      "Delete session?",
      "This permanently removes it and all its laps. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            channelRef.current?.send({
              type: "broadcast",
              event: "session_deleted",
              payload: {},
            });
            const { error } = await supabase.rpc("delete_casual_session", {
              p_session_id: params.sessionId,
            });
            if (error) {
              Alert.alert("Error", error.message ?? "Failed to delete session.");
              return;
            }
            onBack();
          },
        },
      ]
    );
  }, [params.isOwner, params.sessionId, onBack]);

  // Laps in ascending order for export (#226)
  const exportLaps = useCallback(
    (): ExportLap[] => [...laps].reverse(),
    [laps]
  );

  // Share the permanent results page + lap summary text (survives expiry)
  const handleShareResult = useCallback(async () => {
    const resultsUrl = `https://splitsync.org/stopwatch/s/${params.sessionCode}/results`;
    const text =
      lapsToShareText(params.sessionName, finalTotalMs, exportLaps()) +
      `\n\nFull results: ${resultsUrl}`;
    await Share.share({ message: text, url: resultsUrl }).catch(() => undefined);
  }, [params.sessionCode, params.sessionName, finalTotalMs, exportLaps]);

  // Share the lap table as CSV via the share sheet
  const handleShareCsv = useCallback(async () => {
    await Share.share({ message: lapsToCsvText(exportLaps()) }).catch(
      () => undefined
    );
  }, [exportLaps]);

  // Volume-key hardware control
  // Volume UP  = START (waiting) or STOP (running)
  // Volume DOWN = LAP (running only, goes through handleLap → same event pipeline)
  const handleVolumeStartStop = useCallback(() => {
    if (status === "running") {
      handleStop();
    } else if (status === "waiting") {
      handleStart();
    }
    // stopped is terminal in shared sessions — do nothing
  }, [status, handleStart, handleStop]);

  const { volumeKeysEnabled, toggleVolumeKeys } = useVolumeKeys({
    isRunning: status === "running",
    onLap: handleLap,
    onStartStop: handleVolumeStartStop,
    onReset: handleReset,
  });

  // Changing the target re-arms the cue (unless the new target already passed)
  const handleCueChange = useCallback(
    (patch: Partial<CueSettings>) => {
      updateCueSettings(patch);
      if (patch.targetEnabled !== undefined || patch.targetMs !== undefined) {
        const next = { ...cueRef.current, ...patch };
        const elapsedNow =
          clientT0Ref.current !== null ? Date.now() - clientT0Ref.current : 0;
        targetFiredRef.current = elapsedNow >= next.targetMs;
      }
    },
    [updateCueSettings, cueRef]
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  const lcdMain = lcdMainSize(width, height);
  const lapCount = laps.length;
  const lastLap = laps[0] ?? null;
  const isRunning = status === "running";
  const isStopped = status === "stopped";
  const isWaiting = status === "waiting";
  const isClosed = status === "closed";
  // Pending indicator: show spinner whenever there are unacknowledged events,
  // whether inflight (pendingQueue) or queued for replay (durableQueueDepth).
  const pendingCount = Math.max(pendingQueue.length, durableQueueDepth);

  // Current lap elapsed (time since last lap event or since start)
  const lastLapCumMs = laps[0]?.cumulativeMs ?? 0;
  const currentLapMs = isRunning ? Math.max(0, elapsedMs - lastLapCumMs) : 0;

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />

      {/* ── Top chrome (#438) — MD3 Appbar.Header replacing the ad-hoc
          top-bar View from #414. Back navigation uses Appbar.BackAction;
          the toggle/status controls stay the shared TopBarButton/
          TopBarStatus components (now MD3 Button/Chip internally, #438)
          so Solo/Timer screens keep the same look without needing their
          own JSX changes. ── */}
      <Appbar.Header style={s.topBar} elevated dark statusBarHeight={0}>
        <Appbar.BackAction
          onPress={onBack}
          accessibilityLabel="Back"
          color={C.white}
        />
        <TopBarButton
          label={isLocked ? "UNLOCK" : "LOCK"}
          onPress={handleLockTap}
          variant={isLocked ? "yellow" : "grey"}
          accessibilityLabel={isLocked ? "Controls locked — double-tap to unlock" : "Tap to lock controls"}
        />
        <TopBarButton
          label={volumeKeysEnabled ? "VOL ON" : "VOL OFF"}
          onPress={toggleVolumeKeys}
          variant={volumeKeysEnabled ? "yellow" : "grey"}
          accessibilityLabel={volumeKeysEnabled ? "Volume keys active — tap to disable" : "Volume keys disabled — tap to enable"}
        />
        <TopBarButton
          label="CUES"
          onPress={() => setShowCuePanel((v) => !v)}
          variant={cueSettings.soundEnabled || cueSettings.targetEnabled ? "yellow" : "grey"}
          accessibilityLabel="Sound cue settings"
        />
        <TopBarStatus
          label={
            status === "running" ? "● RUN"
              : status === "stopped" ? "■ STOP"
              : status === "waiting" ? "◌ WAIT"
              : "READY"
          }
          variant={status === "running" ? "yellow" : "grey"}
          pending={pendingCount > 0}
        />
      </Appbar.Header>

      {/* ── Sound cue settings (#227) ── */}
      {showCuePanel && (
        <CueSettingsPanel settings={cueSettings} onChange={handleCueChange} />
      )}

      {/* ── Participant strip ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.participantStrip}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6, gap: 6 }}
      >
        {participants.map((p) => (
          <View
            key={p.id}
            style={[
              s.participantPill,
              p.id === params.participantId && s.participantPillSelf,
              p.is_owner && s.participantPillOwner,
            ]}
          >
            <Text style={s.participantPillText} numberOfLines={1}>
              {p.display_name}
              {p.is_owner ? " ★" : ""}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* ── LCD instrument panel ── */}
      <View style={s.instrument}>
        <View style={s.instrHeader}>
          <Text style={s.instrLabel}>
            {isWaiting ? "WAITING" : `LAP ${lapCount + 1}`}
          </Text>
          <Text style={[s.instrLabel, { marginLeft: "auto" as unknown as number }]}>
            {params.sessionCode}
          </Text>
        </View>
        <View style={s.instrMain}>
          <LcdDisplay ms={currentLapMs} mainSize={lcdMain} fontLoaded={fontsLoaded} />
        </View>
        <View style={s.instrFooter}>
          <Text style={s.instrLabel}>TOTAL SESSION</Text>
          <LcdDisplay
            ms={elapsedMs}
            mainSize={Math.round(lcdMain * 0.42)}
            color={C.lcdSmall}
            dimColor={C.lcdSmallDim}
            fontLoaded={fontsLoaded}
          />
        </View>
      </View>

      {/* ── Target overrun (#227) ── */}
      {cueSettings.targetEnabled && (
        <TargetOverrunStrip elapsedMs={elapsedMs} targetMs={cueSettings.targetMs} />
      )}

      {/* ── Last lap strip ── */}
      {lastLap && (
        <View style={s.lastLap}>
          <View>
            <Text style={s.lastLapTitle}>
              LAP {lastLap.lapNum} — {lastLap.actorName}
            </Text>
            <Text style={s.lastLapSub}>
              {fmtCompact(lastLap.cumulativeMs)} total
            </Text>
          </View>
          <Text style={s.lastLapTime}>{fmtCompact(lastLap.splitMs)}</Text>
        </View>
      )}

      {/* ── Stats strip (≥ 2 laps) ── */}
      {showSessionStats && (
        <View style={s.statsStrip} accessibilityLabel="Lap statistics">
          <View style={[s.statCell, s.statCellBest]}>
            <Text style={s.statLabel}>BEST</Text>
            <Text style={[s.statValue, s.statValueBest]}>
              {fmtCompact(bestMs!)}
            </Text>
          </View>
          <View style={[s.statCell, s.statCellMid]}>
            <Text style={s.statLabel}>WORST</Text>
            <Text style={[s.statValue, s.statValueWorst]}>
              {fmtCompact(worstMs!)}
            </Text>
          </View>
          <View style={s.statCell}>
            <Text style={s.statLabel}>AVG</Text>
            <Text style={s.statValue}>{fmtCompact(Math.round(avgMs!))}</Text>
          </View>
        </View>
      )}

      {/* ── Closed banner (visible even if laps were already recorded) ── */}
      {isClosed && lapCount > 0 && (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Text style={s.mutedText}>This session was closed by the host.</Text>
        </View>
      )}

      {/* ── Lap table or stopped summary ── */}
      {isStopped ? (
        <View style={{ flex: 1 }}>
          {laps.length > 0 ? (
            <View style={s.table}>
              <View style={s.tableHead}>
                <Text style={[s.th, s.cLap]}>LAP</Text>
                <Text style={[s.th, s.cSplit]}>SPLIT</Text>
                <Text style={[s.th, s.cTime]}>TIME</Text>
                <Text style={[s.th, s.cActor]}>BY</Text>
              </View>
              <LapTable
                laps={laps}
                bestMs={bestMs}
                worstMs={worstMs}
                showSessionStats={showSessionStats}
                showDelta={false}
              />
            </View>
          ) : null}

          {/* Stopped CTA */}
          <View style={{ padding: 16, gap: 10 }}>
            <Pressable
              onPress={handleShareResult}
              style={({ pressed }) => [
                s.secondaryBtn,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={s.secondaryBtnText}>Share Result</Text>
            </Pressable>
            {laps.length > 0 && (
              <Pressable
                onPress={handleShareCsv}
                style={({ pressed }) => [
                  s.outlineBtn,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={s.outlineBtnText}>Share CSV</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() =>
                ExpoLinking.openURL("https://splitsync.org/new")
              }
              style={({ pressed }) => [
                s.ghostBtn,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={s.ghostBtnText}>
                Create a full SplitSync event →
              </Text>
            </Pressable>
          </View>
        </View>
      ) : lapCount > 0 ? (
        <View style={s.table}>
          <View style={s.tableHead}>
            <Text style={[s.th, s.cLap]}>LAP</Text>
            <Text style={[s.th, s.cSplit]}>SPLIT</Text>
            <Text style={[s.th, s.cTime]}>TIME</Text>
            <Text style={[s.th, s.cActor]}>BY</Text>
          </View>
          <LapTable
            laps={laps}
            bestMs={bestMs}
            worstMs={worstMs}
            showSessionStats={showSessionStats}
            showDelta={true}
          />
        </View>
      ) : (
        <View style={s.together}>
          <Text style={s.mutedText}>
            {isClosed
              ? "This session was closed by the host."
              : isWaiting
              ? "Waiting for the session to start…"
              : "No laps yet. Press LAP to record a split."}
          </Text>
        </View>
      )}

      {/* ── Logo footer ── */}
      <LogoFooter />

      {/* ── Device bottom button bar ── */}
      <View style={s.btnCasing}>
        <DeviceBtn
          label="LAP"
          sub={lapCount > 0 ? `0${lapCount + 1}`.slice(-2) : undefined}
          body={C.btnInkBody}
          hi={C.btnInkHi}
          lo={C.btnInkLo}
          disabled={!isRunning}
          onPress={handleLap}
        />
        <View style={{ width: 10 }} />
        {isRunning ? (
          <View style={{ flex: 1.4, opacity: isLocked ? 0.4 : 1 }}>
            <DeviceBtn
              label="STOP"
              body={C.btnRedBody}
              hi={C.btnRedHi}
              lo={C.btnRedLo}
              onPress={handleStop}
              flex={1}
            />
          </View>
        ) : (
          <DeviceBtn
            label={isClosed ? "CLOSED" : isStopped ? "STOPPED" : "START"}
            body={C.btnBlueBody}
            hi={C.btnBlueHi}
            lo={C.btnBlueLo}
            textColor={C.ink}
            disabled={isStopped || isClosed}
            onPress={handleStart}
            flex={1.4}
          />
        )}
        <View style={{ width: 10 }} />
        <View style={{ flex: 1, opacity: isLocked && params.isOwner && !isWaiting ? 0.4 : 1 }}>
          <DeviceBtn
            label="RESET"
            body={C.btnPaperBody}
            hi={C.btnPaperHi}
            lo={C.btnPaperLo}
            textColor={C.ink}
            flex={1}
            disabled={!params.isOwner || isWaiting || isClosed}
            onPress={handleReset}
          />
        </View>
      </View>

      {/* ── Owner session management (#345) ── */}
      {params.isOwner && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            gap: 16,
            paddingVertical: 6,
            backgroundColor: C.casing,
          }}
        >
          {!isClosed && (
            <Pressable onPress={handleCloseSession} hitSlop={8}>
              <Text style={{ color: C.faint, fontSize: 11, fontWeight: "700" }}>
                Close session
              </Text>
            </Pressable>
          )}
          <Pressable onPress={handleDeleteSession} hitSlop={8}>
            <Text style={{ color: C.red, fontSize: 11, fontWeight: "700" }}>
              Delete session
            </Text>
          </Pressable>
        </View>
      )}

      {/* ── Lock hint toast ── */}
      {showLockHint && (
        <View
          style={s.lockHintToast}
          accessibilityLiveRegion="assertive"
          accessibilityLabel="Controls locked — double-tap the lock icon to unlock"
        >
          <Text style={s.lockHintText}>Controls locked — double-tap 🔒 to unlock</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Solo persistence (state survives app kill / reboot) ───────────────────────
const SOLO_STORAGE_KEY = "solo_stopwatch_v1";

type PersistedSolo = {
  /** Only running/paused are persisted; idle clears storage. */
  state: "running" | "paused";
  /** Milliseconds accumulated before the last resume (or total, if paused). */
  accumMs: number;
  /** Wall-clock (Date.now()) at last start/resume; null when paused. */
  anchorWall: number | null;
  /** Cumulative ms at the most recent recorded lap. */
  lastLapCumMs: number;
  laps: { number: number; splitMs: number; cumulativeMs: number }[];
};

function parsePersistedSolo(raw: string | null): PersistedSolo | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as PersistedSolo;
    if (
      (data.state !== "running" && data.state !== "paused") ||
      typeof data.accumMs !== "number" ||
      typeof data.lastLapCumMs !== "number" ||
      !Array.isArray(data.laps)
    ) {
      return null;
    }
    if (data.state === "running" && typeof data.anchorWall !== "number") {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

// ── Screen: Solo (existing standalone stopwatch) ───────────────────────────────

// Delay options for solo mode (shared session keeps instant start)
type DelayOption = 0 | 3 | 5 | 10;
const SOLO_DELAY_OPTIONS: DelayOption[] = [0, 3, 5, 10];
const SOLO_DELAY_LABELS: Record<DelayOption, string> = { 0: "OFF", 3: "3s", 5: "5s", 10: "10s" };
const SOLO_DELAY_STORAGE_KEY = "sw_delay_seconds";

// ── Solo mode: stopwatch (count up) vs single countdown timer (#232) ─────────
// One timer only — multi-timer boards are a deliberate no-go (ADR 0018).
type SoloMode = "stopwatch" | "timer";
const SOLO_MODE_STORAGE_KEY = "solo_mode_v1";

// MD3 `SegmentedButtons` — replaces the old hand-rolled pill toggle (#439).
function ModeToggleStrip({
  mode,
  onSelect,
}: {
  mode: SoloMode;
  onSelect: (m: SoloMode) => void;
}) {
  return (
    <View style={s.modeToggleWrap}>
      <Text style={s.delayLabel}>MODE</Text>
      <SegmentedButtons
        style={s.modeToggleButtons}
        value={mode}
        onValueChange={(v) => onSelect(v as SoloMode)}
        density="small"
        buttons={[
          {
            value: "stopwatch",
            label: "STOPWATCH",
            accessibilityLabel: "Stopwatch mode",
            checkedColor: stopwatchTheme.colors.onPrimary,
            uncheckedColor: stopwatchTheme.colors.onSurfaceVariant,
          },
          {
            value: "timer",
            label: "TIMER",
            accessibilityLabel: "Countdown timer mode",
            checkedColor: stopwatchTheme.colors.onPrimary,
            uncheckedColor: stopwatchTheme.colors.onSurfaceVariant,
          },
        ]}
      />
    </View>
  );
}

function SoloScreen({
  fontsLoaded,
  onBack,
  onSelectMode,
  onGoShared,
  activeSessionId,
  onOpenSessions,
}: {
  fontsLoaded: boolean;
  onBack: () => void;
  onSelectMode: (m: SoloMode) => void;
  onGoShared: () => void;
  activeSessionId: string | null;
  onOpenSessions: () => void;
}) {
  useKeepAwake();
  const { width, height } = useWindowDimensions();

  // Fullscreen overlay state (#422)
  const [fsVisible, setFsVisible] = useState(false);

  type SwState = "idle" | "countdown" | "running" | "paused";

  const [swState, setSw] = useState<SwState>("idle");
  const [sessionMs, setSession] = useState(0);
  const [lapMs, setLapMs] = useState(0);
  const [laps, setLaps] = useState<
    { number: number; splitMs: number; cumulativeMs: number }[]
  >([]);

  // Delayed start
  const [delaySeconds, setDelaySeconds] = useState<DelayOption>(0);
  const [countdownSec, setCountdownSec] = useState(0);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownEndRef = useRef<number>(0);

  // ── Lock state (local to this device — never broadcast) ─────────────────────
  const [isLocked, setIsLocked] = useState(false);
  const [showLockHint, setShowLockHint] = useState(false);
  const lockHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const anchor = useRef<number | null>(null);
  const accum = useRef(0);
  const lastLapCum = useRef(0);
  const lapsRef = useRef<
    { number: number; splitMs: number; cumulativeMs: number }[]
  >([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  // ── Load persisted delay from AsyncStorage ──────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(SOLO_DELAY_STORAGE_KEY).then((val) => {
      if (val !== null) {
        const n = Number(val) as DelayOption;
        if (SOLO_DELAY_OPTIONS.includes(n)) setDelaySeconds(n);
      }
    }).catch(() => undefined);
  }, []);

  const handleSelectDelay = useCallback((opt: DelayOption) => {
    setDelaySeconds(opt);
    AsyncStorage.setItem(SOLO_DELAY_STORAGE_KEY, String(opt)).catch(() => undefined);
  }, []);

  // ── Persistence: save on state transitions, restore on mount ────────────────
  const persistSolo = useCallback((state: "running" | "paused") => {
    const data: PersistedStopwatchState = {
      state,
      accumMs: accum.current,
      anchorWall: state === "running" ? anchor.current : null,
      lastLapCumMs: lastLapCum.current,
      laps: lapsRef.current,
    };
    if (activeSessionId) {
      // Multi-session path: read current payload then patch stopwatchState
      getSession(activeSessionId)
        .then((current) =>
          updateSession(activeSessionId, { ...current, stopwatchState: data })
        )
        .catch(() => {});
    } else {
      // Fallback (pre-migration or race condition) — write to legacy key
      AsyncStorage.setItem(SOLO_STORAGE_KEY, JSON.stringify(data)).catch(() => {});
    }
  }, [activeSessionId]);

  const clearPersistedSolo = useCallback(() => {
    if (activeSessionId) {
      getSession(activeSessionId)
        .then((current) => {
          const next = { ...(current ?? {}) };
          delete next.stopwatchState;
          return updateSession(activeSessionId, next);
        })
        .catch(() => {});
    } else {
      AsyncStorage.removeItem(SOLO_STORAGE_KEY).catch(() => {});
    }
  }, [activeSessionId]);

  // Sound cues (#227)
  const { cueSettings, cueRef, updateCueSettings } = useCueSettings();
  const [showCuePanel, setShowCuePanel] = useState(false);
  const targetFiredRef = useRef(false);

  // Fire the target cue once when elapsed time crosses the target (#227)
  const checkTarget = useCallback(
    (elapsed: number) => {
      const cfg = cueRef.current;
      if (!cfg.targetEnabled || targetFiredRef.current) return;
      if (elapsed >= cfg.targetMs) {
        targetFiredRef.current = true;
        playCue("target");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    },
    [cueRef]
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (
        appState.current.match(/inactive|background/) &&
        next === "active" &&
        anchor.current !== null
      ) {
        const t = accum.current + Date.now() - anchor.current;
        setSession(t);
        setLapMs(t - lastLapCum.current);
        // Best-effort: if the target passed while backgrounded and the JS
        // timer was suspended, fire the cue on resume.
        checkTarget(t);
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [checkTarget]);

  const startTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (anchor.current !== null) {
        const t = accum.current + Date.now() - anchor.current;
        setSession(t);
        setLapMs(t - lastLapCum.current);
        checkTarget(t);
      }
    }, 30);
  }, [checkTarget]);

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const clearCountdown = useCallback(() => {
    if (countdownIntervalRef.current !== null) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  // ── Ongoing Android notification while running (#231) ──────────────────────
  useEffect(() => {
    if (swState === "running" && anchor.current !== null) {
      // Chronometer zero point = now - elapsed = anchor - accumulated.
      showRunningNotification("Solo Stopwatch", anchor.current - accum.current);
    } else {
      clearRunningNotification();
    }
  }, [swState]);
  useEffect(() => () => clearRunningNotification(), []);

  const showLockedHint = useCallback(() => {
    setShowLockHint(true);
    if (lockHintTimerRef.current) clearTimeout(lockHintTimerRef.current);
    lockHintTimerRef.current = setTimeout(() => setShowLockHint(false), 2000);
  }, []);

  const handleLockToggle = useCallback(() => {
    if (!isLocked) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setIsLocked(true);
    }
  }, [isLocked]);

  const handleUnlock = useCallback(() => {
    if (isLocked) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setIsLocked(false);
      setShowLockHint(false);
      if (lockHintTimerRef.current) clearTimeout(lockHintTimerRef.current);
    }
  }, [isLocked]);

  const handleLockTap = useDoubleTap(handleUnlock, handleLockToggle);

  // Restore persisted solo state on mount (survives app kill / reboot).
  useEffect(() => {
    let cancelled = false;
    const loadRaw = activeSessionId
      ? getSession(activeSessionId).then((payload) => {
          const s = payload?.stopwatchState;
          return s ? JSON.stringify(s) : null;
        })
      : AsyncStorage.getItem(SOLO_STORAGE_KEY);
    loadRaw
      .then((raw) => {
        if (cancelled) return;
        const saved = parsePersistedSolo(raw);
        if (!saved) return;

        accum.current = saved.accumMs;
        lastLapCum.current = saved.lastLapCumMs;
        lapsRef.current = saved.laps;
        setLaps(saved.laps);

        // Restoring is not a user action: never beep on mount. If the
        // restored elapsed time already crossed the target, mark it fired
        // so the tick loop doesn't play the target cue retroactively.
        const restoredElapsed =
          saved.state === "running" && saved.anchorWall !== null
            ? saved.accumMs + Math.max(0, Date.now() - saved.anchorWall)
            : saved.accumMs;
        if (restoredElapsed >= cueRef.current.targetMs) {
          targetFiredRef.current = true;
        }

        if (saved.state === "running" && saved.anchorWall !== null) {
          // The persisted anchor is a Date.now() wall-clock value — reuse it
          // directly so elapsed time keeps counting across the kill,
          // consistent with the drift-free backgrounding approach.
          anchor.current = saved.anchorWall;
          const t = accum.current + Date.now() - anchor.current;
          setSession(t);
          setLapMs(t - lastLapCum.current);
          setSw("running");
          startTick();
        } else {
          anchor.current = null;
          setSession(saved.accumMs);
          setLapMs(saved.accumMs - saved.lastLapCumMs);
          setSw("paused");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Commit to running after countdown ends
  const commitStart = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (cueRef.current.soundEnabled) playCue("start");
    anchor.current = Date.now();
    startTick();
    setSw("running");
    persistSolo("running");
  }, [startTick, persistSolo, cueRef]);

  const beginCountdown = useCallback((seconds: number) => {
    const endsAt = Date.now() + seconds * 1000;
    countdownEndRef.current = endsAt;
    setCountdownSec(seconds);
    setSw("countdown");
    // Initial haptic + audio tick for the first second
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (cueRef.current.soundEnabled) playCue("tick");

    let lastTicked = seconds;
    countdownIntervalRef.current = setInterval(() => {
      const remaining = Math.ceil((countdownEndRef.current - Date.now()) / 1000);
      if (remaining <= 0) {
        clearCountdown();
        setCountdownSec(0);
        commitStart();
      } else {
        if (remaining !== lastTicked) {
          lastTicked = remaining;
          // Haptic + audio tick for each subsequent countdown second
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          if (cueRef.current.soundEnabled) playCue("tick");
        }
        setCountdownSec(remaining);
      }
    }, 100);
  }, [clearCountdown, commitStart, cueRef]);

  useEffect(() => () => { stopTick(); clearCountdown(); }, [stopTick, clearCountdown]);

  const handleStart = useCallback(() => {
    if (delaySeconds > 0) {
      beginCountdown(delaySeconds);
    } else {
      commitStart();
    }
  }, [delaySeconds, beginCountdown, commitStart]);

  const handleCancelCountdown = useCallback(() => {
    clearCountdown();
    setCountdownSec(0);
    // Return to the pre-countdown state: a delayed resume (accumulated time
    // present) goes back to "paused" so RESET stays reachable; a delayed
    // fresh start goes back to "idle".
    setSw(accum.current > 0 ? "paused" : "idle");
  }, [clearCountdown]);

  const handleStop = useCallback(() => {
    if (isLocked) {
      // Capture the exact elapsed ms at the tap instant. If the user confirms
      // we stop at that time, not at the dialog-dismiss time.
      const capturedElapsed =
        accum.current + (anchor.current !== null ? Date.now() - anchor.current : 0);
      Alert.alert(
        "Stop timer?",
        `Stop at ${fmtCompact(capturedElapsed)}?\n\nThe split will be recorded at this exact time.`,
        [
          { text: "Keep running", style: "cancel" },
          {
            text: "Stop",
            style: "destructive",
            onPress: () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              if (cueRef.current.soundEnabled) playCue("stop");
              // Apply the captured elapsed, not Date.now() (dialog may have
              // taken a second or two to dismiss).
              accum.current = capturedElapsed;
              anchor.current = null;
              stopTick();
              setSession(capturedElapsed);
              setLapMs(capturedElapsed - lastLapCum.current);
              setSw("paused");
              persistSolo("paused");
            },
          },
        ],
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (cueRef.current.soundEnabled) playCue("stop");
    if (anchor.current !== null) {
      accum.current += Date.now() - anchor.current;
      anchor.current = null;
    }
    stopTick();
    setSession(accum.current);
    setLapMs(accum.current - lastLapCum.current);
    setSw("paused");
    persistSolo("paused");
  }, [isLocked, stopTick, persistSolo, cueRef]);

  const handleLap = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (cueRef.current.soundEnabled) playCue("lap");
    const now = Date.now();
    const cum =
      accum.current + (anchor.current !== null ? now - anchor.current : 0);
    const split = cum - lastLapCum.current;
    lastLapCum.current = cum;
    setLapMs(0);
    setLaps((prev) => {
      const next = [
        { number: prev.length + 1, splitMs: split, cumulativeMs: cum },
        ...prev,
      ];
      lapsRef.current = next;
      persistSolo(anchor.current !== null ? "running" : "paused");
      return next;
    });
  }, [persistSolo]);

  const handleReset = useCallback(() => {
    if (isLocked) { showLockedHint(); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    clearCountdown();
    setCountdownSec(0);
    stopTick();
    anchor.current = null;
    accum.current = 0;
    lastLapCum.current = 0;
    lapsRef.current = [];
    targetFiredRef.current = false;
    setSession(0);
    setLapMs(0);
    setLaps([]);
    setSw("idle");
    clearPersistedSolo();
  }, [isLocked, showLockedHint, stopTick, clearCountdown, clearPersistedSolo]);

  // Changing the target re-arms the cue (unless the new target already passed)
  const handleCueChange = useCallback(
    (patch: Partial<CueSettings>) => {
      updateCueSettings(patch);
      if (patch.targetEnabled !== undefined || patch.targetMs !== undefined) {
        const next = { ...cueRef.current, ...patch };
        const elapsedNow =
          accum.current +
          (anchor.current !== null ? Date.now() - anchor.current : 0);
        targetFiredRef.current = elapsedNow >= next.targetMs;
      }
    },
    [updateCueSettings, cueRef]
  );

  // Share laps as text / CSV via the share sheet (#226)
  const soloExportLaps = useCallback(
    (): ExportLap[] =>
      [...laps]
        .reverse()
        .map((l) => ({
          lapNum: l.number,
          splitMs: l.splitMs,
          cumulativeMs: l.cumulativeMs,
        })),
    [laps]
  );

  const handleShareLaps = useCallback(async () => {
    await Share.share({
      message: lapsToShareText("Solo stopwatch", accum.current, soloExportLaps()),
    }).catch(() => undefined);
  }, [soloExportLaps]);

  const handleShareCsv = useCallback(async () => {
    await Share.share({ message: lapsToCsvText(soloExportLaps()) }).catch(
      () => undefined
    );
  }, [soloExportLaps]);

  const isRunning = swState === "running";
  const isPaused = swState === "paused";
  const isIdle = swState === "idle";
  const isCountdown = swState === "countdown";

  // Volume-key hardware control
  // Volume UP  = START / RESUME (idle/paused), CANCEL (countdown) or STOP (running)
  // Volume DOWN = LAP (running only)
  // Mirrors the on-screen primary button path: a delayed start begins the
  // countdown, and STOP respects the control lock (handleStop no-ops with a
  // hint while locked).
  const handleVolumeStartStop = useCallback(() => {
    if (isRunning) {
      handleStop();
    } else if (isCountdown) {
      handleCancelCountdown();
    } else {
      handleStart();
    }
  }, [isRunning, isCountdown, handleStart, handleStop, handleCancelCountdown]);

  const { volumeKeysEnabled, toggleVolumeKeys } = useVolumeKeys({
    isRunning,
    onLap: handleLap,
    onStartStop: handleVolumeStartStop,
    onReset: handleReset,
  });
  const lapCount = laps.length;
  const lastLap = laps[0] ?? null;
  const showSoloStats = laps.length >= 2;
  const bestMs = useMemo(
    () =>
      laps.length < 2 ? null : Math.min(...laps.map((l) => l.splitMs)),
    [laps]
  );
  const worstMs = useMemo(
    () =>
      laps.length < 2 ? null : Math.max(...laps.map((l) => l.splitMs)),
    [laps]
  );
  const avgMs = useMemo(
    () =>
      laps.length < 2
        ? null
        : laps.reduce((sum, l) => sum + l.splitMs, 0) / laps.length,
    [laps]
  );
  const lcdMain = lcdMainSize(width, height);

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />

      {/* ── Top bar (#414) ── */}
      <View style={s.topBar}>
        <TopBarButton label="‹ BACK" onPress={onBack} variant="blue" accessibilityLabel="Back" />
        <TopBarButton
          label="SESSIONS"
          onPress={onOpenSessions}
          variant="blue"
          accessibilityLabel="Open sessions list"
        />
        <TopBarButton
          label={isLocked ? "UNLOCK" : "LOCK"}
          onPress={handleLockTap}
          variant={isLocked ? "yellow" : "grey"}
          accessibilityLabel={isLocked ? "Controls locked — double-tap to unlock" : "Tap to lock controls"}
        />
        <TopBarButton
          label={volumeKeysEnabled ? "VOL ON" : "VOL OFF"}
          onPress={toggleVolumeKeys}
          variant={volumeKeysEnabled ? "yellow" : "grey"}
          accessibilityLabel={volumeKeysEnabled ? "Volume keys active — tap to disable" : "Volume keys disabled — tap to enable"}
        />
        <TopBarButton
          label="CUES"
          onPress={() => setShowCuePanel((v) => !v)}
          variant={cueSettings.soundEnabled || cueSettings.targetEnabled ? "yellow" : "grey"}
          accessibilityLabel="Sound cue settings"
        />
        <TopBarButton
          label="FULL"
          onPress={() => setFsVisible(true)}
          variant="grey"
          accessibilityLabel="Open fullscreen stopwatch view"
          testID="solo-fullscreen-btn"
        />
        <TopBarStatus
          label={
            isRunning ? "● RUN"
              : isPaused ? "‖ PAUSE"
              : isCountdown ? `◷ ${countdownSec}`
              : "READY"
          }
          variant={isRunning || isCountdown || isPaused ? "yellow" : "grey"}
        />
      </View>

      {/* ── Fullscreen overlay (#422) ── */}
      <FullscreenOverlay
        visible={fsVisible}
        onDismiss={() => setFsVisible(false)}
        ms={sessionMs}
        label={
          isRunning ? "Stopwatch · Running"
            : isPaused ? "Stopwatch · Paused"
            : isCountdown ? "Stopwatch · Get ready"
            : "Stopwatch"
        }
        subLabel={
          isRunning ? `Lap ${laps.length + 1} · ${fmtCompact(lapMs)}`
            : isPaused ? "Paused"
            : isIdle ? "Ready"
            : `${countdownSec}s`
        }
        fontsLoaded={fontsLoaded}
      />

      {/* ── Sound cue settings (#227) ── */}
      {showCuePanel && (
        <CueSettingsPanel settings={cueSettings} onChange={handleCueChange} />
      )}

      {/* ── LCD instrument panel (shows countdown overlay or normal display) ── */}
      {isCountdown ? (
        /* Countdown overlay — full instrument area */
        <View style={[s.instrument, { alignItems: "center", justifyContent: "center", paddingVertical: 24 }]}>
          <Text style={{ color: C.casingMuted, fontSize: 9, fontWeight: "900", letterSpacing: 2.5, marginBottom: 8 }}>
            GET READY
          </Text>
          <Text
            style={{
              fontFamily: fontsLoaded ? "DSEG7Classic-Regular" : "monospace",
              fontSize: lcdMain * 1.5,
              color: C.red,
              letterSpacing: 4,
              includeFontPadding: false,
            }}
            numberOfLines={1}
            allowFontScaling={false}
            accessibilityLabel={`Countdown: ${countdownSec}`}
          >
            {countdownSec}
          </Text>
          <Text style={{ color: C.casingMuted, fontSize: 9, fontWeight: "900", letterSpacing: 2, marginTop: 8 }}>
            TAP CANCEL TO ABORT
          </Text>
        </View>
      ) : (
        <View style={s.instrument}>
          <View style={s.instrHeader}>
            <Text style={s.instrLabel}>
              {isIdle ? "LAP TIME" : `LAP ${lapCount + 1}`}
            </Text>
            {cueSettings.targetEnabled && (
              <Text style={s.instrLabel}>
                TGT {fmtParts(cueSettings.targetMs).main}
              </Text>
            )}
          </View>
          <View style={s.instrMain}>
            <LcdDisplay ms={lapMs} mainSize={lcdMain} fontLoaded={fontsLoaded} />
          </View>
          <View style={s.instrFooter}>
            <Text style={s.instrLabel}>TOTAL SESSION</Text>
            <LcdDisplay
              ms={sessionMs}
              mainSize={Math.round(lcdMain * 0.42)}
              color={C.lcdSmall}
              dimColor={C.lcdSmallDim}
              fontLoaded={fontsLoaded}
            />
          </View>
        </View>
      )}

      {/* ── Mode toggle (#232) — shown only in idle ── */}
      {isIdle && (
        <ModeToggleStrip mode="stopwatch" onSelect={onSelectMode} />
      )}

      {/* ── Delay selector (shown only in idle/paused) ── */}
      {(isIdle || isPaused) && (
        <View style={s.delaySelector}>
          <Text style={s.delayLabel}>DELAY</Text>
          <View style={s.delayOptions}>
            {SOLO_DELAY_OPTIONS.map((opt) => (
              <Pressable
                key={opt}
                onPress={() => handleSelectDelay(opt)}
                style={[
                  s.delayOption,
                  delaySeconds === opt && s.delayOptionActive,
                ]}
                accessible
                accessibilityRole="radio"
                accessibilityLabel={`Delayed start ${SOLO_DELAY_LABELS[opt]}`}
                accessibilityState={{ selected: delaySeconds === opt }}
              >
                <Text
                  style={[
                    s.delayOptionText,
                    delaySeconds === opt && s.delayOptionTextActive,
                  ]}
                >
                  {SOLO_DELAY_LABELS[opt]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* ── Target overrun (#227) ── */}
      {cueSettings.targetEnabled && (
        <TargetOverrunStrip elapsedMs={sessionMs} targetMs={cueSettings.targetMs} />
      )}

      {/* ── Last lap strip ── */}
      {lastLap && !isCountdown && (
        <View style={s.lastLap}>
          <View>
            <Text style={s.lastLapTitle}>LAST LAP</Text>
            <Text style={s.lastLapSub}>Lap {lastLap.number}</Text>
          </View>
          <Text style={s.lastLapTime}>{fmtCompact(lastLap.splitMs)}</Text>
        </View>
      )}

      {/* ── Stats strip (≥ 2 laps) ── */}
      {showSoloStats && (
        <View style={s.statsStrip} accessibilityLabel="Lap statistics">
          <View style={[s.statCell, s.statCellBest]}>
            <Text style={s.statLabel}>BEST</Text>
            <Text style={[s.statValue, s.statValueBest]}>
              {fmtCompact(bestMs!)}
            </Text>
          </View>
          <View style={[s.statCell, s.statCellMid]}>
            <Text style={s.statLabel}>WORST</Text>
            <Text style={[s.statValue, s.statValueWorst]}>
              {fmtCompact(worstMs!)}
            </Text>
          </View>
          <View style={s.statCell}>
            <Text style={s.statLabel}>AVG</Text>
            <Text style={s.statValue}>{fmtCompact(Math.round(avgMs!))}</Text>
          </View>
        </View>
      )}

      {/* ── Share row (paused with laps) — #226 ── */}
      {isPaused && lapCount > 0 && (
        <View style={s.shareRow}>
          <Pressable
            onPress={handleShareLaps}
            style={({ pressed }) => [
              s.shareRowBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Share lap times"
          >
            <Text style={s.shareRowBtnText}>SHARE LAPS</Text>
          </Pressable>
          <Pressable
            onPress={handleShareCsv}
            style={({ pressed }) => [
              s.shareRowBtn,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Share lap times as CSV"
          >
            <Text style={s.shareRowBtnText}>SHARE CSV</Text>
          </Pressable>
        </View>
      )}

      {/* ── Lap table (MD3 `Card` + `DataTable` chrome, #439) ── */}
      {lapCount > 0 && !isCountdown ? (
        <Card style={[s.table, s.lapCard]} mode="elevated">
          <DataTable.Header style={s.lapTableHeader}>
            <DataTable.Title style={s.cLap} textStyle={s.lapHeaderText}>
              LAP
            </DataTable.Title>
            <DataTable.Title style={s.cSplit} textStyle={s.lapHeaderText}>
              SPLIT
            </DataTable.Title>
            <DataTable.Title style={s.cTime} textStyle={s.lapHeaderText}>
              TIME
            </DataTable.Title>
            <DataTable.Title
              style={s.cDelta}
              textStyle={s.lapHeaderText}
              numeric
            >
              Δ BEST
            </DataTable.Title>
          </DataTable.Header>
          <FlatList
            data={laps}
            keyExtractor={(l) => String(l.number)}
            style={{ flex: 1 }}
            ListHeaderComponent={
              showSoloStats ? (
                <LapTrendChart
                  laps={[...laps].reverse()}
                  bestMs={bestMs!}
                  worstMs={worstMs!}
                  getLapMs={(l) => l.splitMs}
                  getLapNum={(l) => l.number}
                />
              ) : null
            }
            renderItem={({ item }) => {
              const isBest = bestMs !== null && item.splitMs === bestMs;
              const delta =
                bestMs !== null && !isBest ? item.splitMs - bestMs : null;
              return (
                <View style={[s.tableRow, isBest && s.rowBest]}>
                  <Text style={[s.td, s.cLap, { color: C.muted }]}>
                    {item.number}
                  </Text>
                  <Text
                    style={[
                      s.td,
                      s.cSplit,
                      isBest && { color: C.yellowDark, fontWeight: "900" },
                    ]}
                  >
                    {fmtCompact(item.splitMs)}
                  </Text>
                  <Text style={[s.td, s.cTime, { color: C.muted }]}>
                    {fmtCompact(item.cumulativeMs)}
                  </Text>
                  <View style={[s.cDelta, { alignItems: "flex-end" }]}>
                    {isBest ? (
                      <Text
                        style={[s.td, { color: C.green, fontWeight: "900" }]}
                      >
                        BEST
                      </Text>
                    ) : delta !== null ? (
                      <Text
                        style={[
                          s.td,
                          { color: delta > 0 ? C.worse : C.green },
                        ]}
                      >
                        {fmtDelta(delta)}
                      </Text>
                    ) : (
                      <Text style={[s.td, { color: C.muted }]}>—</Text>
                    )}
                  </View>
                </View>
              );
            }}
          />
        </Card>
      ) : !isCountdown ? (
        <View style={s.together}>
          <Card
            style={s.togetherCard}
            mode="outlined"
            onPress={onGoShared}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Time together"
          >
            <Card.Content style={s.togetherCardContent}>
              <Text style={s.togetherLabel}>⏱  TIME TOGETHER</Text>
              <Text style={s.togetherSub}>
                TAP TO CREATE A SHARED SESSION
              </Text>
            </Card.Content>
          </Card>
        </View>
      ) : (
        /* Countdown: flex spacer so button bar stays anchored */
        <View style={{ flex: 1 }} />
      )}

      {/* ── Logo footer ── */}
      <LogoFooter />

      {/* ── Device bottom button bar ── */}
      <View style={s.btnCasing}>
        {isCountdown ? (
          /* During countdown: show CANCEL prominently instead of LAP */
          <>
            <DeviceBtn
              label="CANCEL"
              body={C.btnPaperBody}
              hi={C.btnPaperHi}
              lo={C.btnPaperLo}
              textColor={C.ink}
              onPress={handleCancelCountdown}
              flex={1}
            />
            <View style={{ width: 10 }} />
            <DeviceBtn
              label={String(countdownSec)}
              sub="COUNTING"
              body={C.btnRedBody}
              hi={C.btnRedHi}
              lo={C.btnRedLo}
              onPress={handleCancelCountdown}
              flex={1.4}
            />
            <View style={{ width: 10 }} />
            <DeviceBtn
              label="RESET"
              body={C.btnPaperBody}
              hi={C.btnPaperHi}
              lo={C.btnPaperLo}
              textColor={C.ink}
              onPress={handleReset}
            />
          </>
        ) : (
          <>
            <DeviceBtn
              label="LAP"
              sub={lapCount > 0 ? `0${lapCount + 1}`.slice(-2) : undefined}
              body={C.btnInkBody}
              hi={C.btnInkHi}
              lo={C.btnInkLo}
              disabled={!isRunning}
              onPress={handleLap}
            />
            <View style={{ width: 10 }} />
            {isRunning ? (
              /* Stop dims when locked (#235) */
              <View style={{ flex: 1.4, opacity: isLocked ? 0.4 : 1 }}>
                <DeviceBtn
                  label="STOP"
                  body={C.btnRedBody}
                  hi={C.btnRedHi}
                  lo={C.btnRedLo}
                  onPress={handleStop}
                  flex={1}
                />
              </View>
            ) : (
              <DeviceBtn
                label={isPaused ? "RESUME" : "START"}
                body={C.btnBlueBody}
                hi={C.btnBlueHi}
                lo={C.btnBlueLo}
                textColor={C.ink}
                onPress={handleStart}
                flex={1.4}
              />
            )}
            <View style={{ width: 10 }} />
            {/* Reset dims when locked (#235) */}
            <View style={{ flex: 1, opacity: isLocked && !isIdle ? 0.4 : 1 }}>
              <DeviceBtn
                label="RESET"
                body={C.btnPaperBody}
                hi={C.btnPaperHi}
                lo={C.btnPaperLo}
                textColor={C.ink}
                flex={1}
                disabled={isIdle}
                onPress={handleReset}
              />
            </View>
          </>
        )}
      </View>

      {/* ── Lock hint toast ── */}
      {showLockHint && (
        <View
          style={s.lockHintToast}
          accessibilityLiveRegion="assertive"
          accessibilityLabel="Controls locked — double-tap the lock icon to unlock"
        >
          <Text style={s.lockHintText}>Controls locked — double-tap 🔒 to unlock</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Countdown timer persistence (#232 — survives app kill via wall-clock) ─────
const TIMER_STORAGE_KEY = "solo_timer_v1";
const TIMER_DURATION_STORAGE_KEY = "timer_duration_v1";
const TIMER_DEFAULT_DURATION_MS = 5 * 60_000;
/** Fallback AsyncStorage key for repeat config when no active session is set. */
const TIMER_REPEAT_CONFIG_KEY = "timer_repeat_config_v1";

type PersistedTimer = {
  /** Only running/paused are persisted; idle clears storage. */
  state: "running" | "paused";
  /** The originally set duration — completion resets back to this. */
  durationMs: number;
  /** Wall-clock (Date.now()) when the countdown reaches zero; null when paused. */
  endAtWall: number | null;
  /** Remaining ms when paused; null when running. */
  remainingMs: number | null;
};

function parsePersistedTimer(raw: string | null): PersistedTimer | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as PersistedTimer;
    if (
      (data.state !== "running" && data.state !== "paused") ||
      typeof data.durationMs !== "number" ||
      data.durationMs <= 0
    ) {
      return null;
    }
    if (data.state === "running" && typeof data.endAtWall !== "number") return null;
    if (data.state === "paused" && typeof data.remainingMs !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

/** Finite completion alert: at most this many repeats, then silence. */
const TIMER_ALARM_MAX_REPEATS = 6;
const TIMER_ALARM_REPEAT_MS = 1_400;

// ── Screen: Countdown Timer (#232) ─────────────────────────────────────────────
function TimerScreen({
  fontsLoaded,
  onBack,
  onSelectMode,
  activeSessionId,
  onOpenSessions,
}: {
  fontsLoaded: boolean;
  onBack: () => void;
  onSelectMode: (m: SoloMode) => void;
  activeSessionId: string | null;
  onOpenSessions: () => void;
}) {
  useKeepAwake();
  const { width, height } = useWindowDimensions();

  // Fullscreen overlay state (#422) — also auto-opens when alerting
  const [fsVisible, setFsVisible] = useState(false);

  type TimerState = "idle" | "running" | "paused" | "alerting";

  const [timerState, setTimerState] = useState<TimerState>("idle");
  const [durationMs, setDurationMs] = useState(TIMER_DEFAULT_DURATION_MS);
  const [remainingMs, setRemainingMs] = useState(TIMER_DEFAULT_DURATION_MS);
  const [finishedWhileAway, setFinishedWhileAway] = useState(false);

  // Duration inputs (H : MM : SS)
  const [hh, setHh] = useState("0");
  const [mm, setMm] = useState("05");
  const [ss, setSs] = useState("00");

  // ── Repeat / Pomodoro mode (ADR 0025) ────────────────────────────────────────
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [restDurationMs, setRestDurationMs] = useState(60_000);
  const [restHh, setRestHh] = useState("0");
  const [restMm, setRestMm] = useState("01");
  const [restSs, setRestSs] = useState("00");
  const [repeatCount, setRepeatCount] = useState<number | null>(null);
  const [repeatCountStr, setRepeatCountStr] = useState("");
  const [currentPhase, setCurrentPhase] = useState<"work" | "rest">("work");
  const [completedCycles, setCompletedCycles] = useState(0);

  // Repeat refs — mirror state for use inside callbacks
  const repeatEnabledRef = useRef(false);
  const repeatCountRef = useRef<number | null>(null);
  const restDurationMsRef = useRef(60_000);
  const currentPhaseRef = useRef<"work" | "rest">("work");
  const completedCyclesRef = useRef(0);

  // Timing refs — wall-clock anchors, never accumulated intervals
  const endAtWallRef = useRef<number | null>(null);
  const remainingRef = useRef<number>(TIMER_DEFAULT_DURATION_MS);
  const durationRef = useRef<number>(TIMER_DEFAULT_DURATION_MS);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmCountRef = useRef(0);
  const appState = useRef<AppStateStatus>(AppState.currentState);
  // Ref to latest startTick — avoids circular useCallback dep with complete.
  const startTickRef = useRef<() => void>(() => undefined);

  // Sound cues (#227) — completion alarm respects the shared soundEnabled flag
  const { cueSettings, cueRef, updateCueSettings } = useCueSettings();

  const setDurationInputsFromMs = useCallback((ms: number) => {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    setHh(String(Math.floor(totalSeconds / 3600)));
    setMm(p2(Math.floor((totalSeconds % 3600) / 60)));
    setSs(p2(totalSeconds % 60));
  }, []);

  const setRestDurationInputsFromMs = useCallback((ms: number) => {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    setRestHh(String(Math.floor(totalSeconds / 3600)));
    setRestMm(p2(Math.floor((totalSeconds % 3600) / 60)));
    setRestSs(p2(totalSeconds % 60));
  }, []);

  const applyDuration = useCallback((ms: number) => {
    durationRef.current = ms;
    remainingRef.current = ms;
    setDurationMs(ms);
    setRemainingMs(ms);
  }, []);

  const persistTimer = useCallback((state: "running" | "paused") => {
    const data: PersistedTimerState = {
      state,
      durationMs: durationRef.current,
      endAtWall: state === "running" ? endAtWallRef.current : null,
      remainingMs: state === "paused" ? remainingRef.current : null,
    };
    if (activeSessionId) {
      getSession(activeSessionId)
        .then((current) =>
          updateSession(activeSessionId, { ...current, timerState: data })
        )
        .catch(() => undefined);
    } else {
      AsyncStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(data)).catch(() => undefined);
    }
  }, [activeSessionId]);

  const clearPersistedTimer = useCallback(() => {
    if (activeSessionId) {
      getSession(activeSessionId)
        .then((current) => {
          const next = { ...(current ?? {}) };
          delete next.timerState;
          return updateSession(activeSessionId, next);
        })
        .catch(() => undefined);
    } else {
      AsyncStorage.removeItem(TIMER_STORAGE_KEY).catch(() => undefined);
    }
  }, [activeSessionId]);

  const persistRepeatConfig = useCallback((config: RepeatConfig | null) => {
    if (activeSessionId) {
      getSession(activeSessionId)
        .then((current) => {
          const next = { ...(current ?? {}) };
          if (config === null) {
            delete next.repeatConfig;
          } else {
            next.repeatConfig = config;
          }
          return updateSession(activeSessionId, next);
        })
        .catch(() => undefined);
    } else {
      if (config === null) {
        AsyncStorage.removeItem(TIMER_REPEAT_CONFIG_KEY).catch(() => undefined);
      } else {
        AsyncStorage.setItem(TIMER_REPEAT_CONFIG_KEY, JSON.stringify(config)).catch(() => undefined);
      }
    }
  }, [activeSessionId]);

  // ── Alarm — finite repeats, single tap dismisses ────────────────────────────
  const stopAlarm = useCallback(() => {
    if (alarmTimerRef.current !== null) {
      clearInterval(alarmTimerRef.current);
      alarmTimerRef.current = null;
    }
    alarmCountRef.current = 0;
  }, []);

  const fireAlarmPulse = useCallback(() => {
    // Haptic only when vibration is enabled (default on).
    if (cueRef.current.vibrationEnabled) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    if (cueRef.current.soundEnabled) playCue("alarm");
  }, [cueRef]);

  const startAlarm = useCallback(() => {
    stopAlarm();
    fireAlarmPulse();
    alarmCountRef.current = 1;
    alarmTimerRef.current = setInterval(() => {
      if (alarmCountRef.current >= TIMER_ALARM_MAX_REPEATS) {
        stopAlarm();
        return;
      }
      alarmCountRef.current += 1;
      fireAlarmPulse();
    }, TIMER_ALARM_REPEAT_MS);
  }, [stopAlarm, fireAlarmPulse]);

  // ── Tick loop ───────────────────────────────────────────────────────────────
  const stopTick = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const complete = useCallback(() => {
    stopTick();
    endAtWallRef.current = null;

    if (!repeatEnabledRef.current) {
      // ── Original single-shot behavior ──────────────────────────────────────
      remainingRef.current = durationRef.current;
      setRemainingMs(durationRef.current);
      setTimerState("alerting");
      // Auto-enter fullscreen so the alert is visible from a distance (#422).
      setFsVisible(true);
      clearPersistedTimer();
      startAlarm();
      return;
    }

    // ── Repeat mode: transition based on current phase ─────────────────────
    if (currentPhaseRef.current === "work") {
      const newCycles = completedCyclesRef.current + 1;
      completedCyclesRef.current = newCycles;
      setCompletedCycles(newCycles);

      const isLastCycle =
        repeatCountRef.current !== null && newCycles >= repeatCountRef.current;

      if (isLastCycle) {
        // Final cycle complete — reset and alert.
        currentPhaseRef.current = "work";
        setCurrentPhase("work");
        completedCyclesRef.current = 0;
        setCompletedCycles(0);
        remainingRef.current = durationRef.current;
        setRemainingMs(durationRef.current);
        setTimerState("alerting");
        // Auto-enter fullscreen so the alert is visible from a distance (#422).
        setFsVisible(true);
        clearPersistedTimer();
        startAlarm();
      } else {
        // Work phase done — start rest phase automatically.
        const restMs = restDurationMsRef.current;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        if (restMs <= 0) {
          // No rest: start next work phase immediately.
          currentPhaseRef.current = "work";
          setCurrentPhase("work");
          endAtWallRef.current = Date.now() + durationRef.current;
          remainingRef.current = durationRef.current;
          setRemainingMs(durationRef.current);
          setTimerState("running");
          startTickRef.current();
        } else {
          // Start rest phase.
          currentPhaseRef.current = "rest";
          setCurrentPhase("rest");
          endAtWallRef.current = Date.now() + restMs;
          remainingRef.current = restMs;
          setRemainingMs(restMs);
          setTimerState("running");
          startTickRef.current();
        }
      }
    } else {
      // Rest phase done — start next work phase.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      currentPhaseRef.current = "work";
      setCurrentPhase("work");
      endAtWallRef.current = Date.now() + durationRef.current;
      remainingRef.current = durationRef.current;
      setRemainingMs(durationRef.current);
      setTimerState("running");
      startTickRef.current();
    }
  }, [stopTick, clearPersistedTimer, startAlarm]);

  const startTick = useCallback(() => {
    stopTick();
    tickRef.current = setInterval(() => {
      if (endAtWallRef.current === null) return;
      const remaining = endAtWallRef.current - Date.now();
      if (remaining <= 0) {
        setRemainingMs(0);
        complete();
      } else {
        setRemainingMs(remaining);
      }
    }, 50);
  }, [stopTick, complete]);

  // Keep startTickRef current so complete() can call it without circular dep.
  // useEffect without deps runs after every render.
  useEffect(() => {
    startTickRef.current = startTick;
  });

  // Foregrounding: snap remaining from the wall-clock anchor; if the timer
  // crossed zero while backgrounded, complete now (the alarm fires on return).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (
        appState.current.match(/inactive|background/) &&
        next === "active" &&
        endAtWallRef.current !== null
      ) {
        const remaining = endAtWallRef.current - Date.now();
        if (remaining <= 0) {
          setRemainingMs(0);
          complete();
        } else {
          setRemainingMs(remaining);
        }
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [complete]);

  // ── Restore persisted state on mount (#224 pattern) ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    const loadTimerRaw = activeSessionId
      ? getSession(activeSessionId).then((payload) => {
          const t = payload?.timerState;
          return t ? JSON.stringify(t) : null;
        })
      : AsyncStorage.getItem(TIMER_STORAGE_KEY);
    const loadRepeatConfigRaw = activeSessionId
      ? getSession(activeSessionId).then((payload) => {
          const r = payload?.repeatConfig;
          return r ? JSON.stringify(r) : null;
        })
      : AsyncStorage.getItem(TIMER_REPEAT_CONFIG_KEY);
    Promise.all([
      AsyncStorage.getItem(TIMER_DURATION_STORAGE_KEY),
      loadTimerRaw,
      loadRepeatConfigRaw,
    ])
      .then(([rawDuration, rawTimer, rawRepeat]) => {
        if (cancelled) return;

        const parsedDuration = rawDuration !== null ? Number(rawDuration) : NaN;
        if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
          applyDuration(parsedDuration);
          setDurationInputsFromMs(parsedDuration);
        }

        // Restore repeat config.
        if (rawRepeat) {
          try {
            const rc = JSON.parse(rawRepeat) as RepeatConfig;
            if (typeof rc.restDurationMs === "number") {
              setRepeatEnabled(true);
              repeatEnabledRef.current = true;
              setRestDurationMs(rc.restDurationMs);
              restDurationMsRef.current = rc.restDurationMs;
              setRestDurationInputsFromMs(rc.restDurationMs);
              const n = rc.repeatCount;
              setRepeatCount(n);
              repeatCountRef.current = n;
              setRepeatCountStr(n === null ? "" : String(n));
            }
          } catch {
            // Corrupt — ignore.
          }
        }

        const saved = parsePersistedTimer(rawTimer);
        if (!saved) return;

        applyDuration(saved.durationMs);
        setDurationInputsFromMs(saved.durationMs);

        if (saved.state === "running" && saved.endAtWall !== null) {
          const remaining = saved.endAtWall - Date.now();
          if (remaining > 0) {
            endAtWallRef.current = saved.endAtWall;
            setRemainingMs(remaining);
            setTimerState("running");
            startTick();
          } else {
            // Finished while the app was dead. Restoring is not a user
            // action: never alarm on mount — reset quietly and say so.
            setFinishedWhileAway(true);
            clearPersistedTimer();
          }
        } else if (saved.state === "paused" && saved.remainingMs !== null) {
          remainingRef.current = saved.remainingMs;
          setRemainingMs(saved.remainingMs);
          setTimerState("paused");
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { stopTick(); stopAlarm(); }, [stopTick, stopAlarm]);

  // ── Controls ────────────────────────────────────────────────────────────────
  const commitDurationInputs = useCallback(
    (hStr: string, mStr: string, sStr: string) => {
      const h = parseInt(hStr, 10) || 0;
      const m = Math.min(parseInt(mStr, 10) || 0, 59);
      const sec = Math.min(parseInt(sStr, 10) || 0, 59);
      const ms = h * 3_600_000 + m * 60_000 + sec * 1_000;
      if (ms > 0) {
        applyDuration(ms);
        AsyncStorage.setItem(TIMER_DURATION_STORAGE_KEY, String(ms)).catch(
          () => undefined
        );
      }
    },
    [applyDuration]
  );

  const commitRestDurationInputs = useCallback(
    (hStr: string, mStr: string, sStr: string) => {
      const h = parseInt(hStr, 10) || 0;
      const m = Math.min(parseInt(mStr, 10) || 0, 59);
      const sec = Math.min(parseInt(sStr, 10) || 0, 59);
      const ms = h * 3_600_000 + m * 60_000 + sec * 1_000;
      setRestDurationMs(ms);
      restDurationMsRef.current = ms;
      persistRepeatConfig({ restDurationMs: ms, repeatCount: repeatCountRef.current });
    },
    [persistRepeatConfig]
  );

  const handleStart = useCallback(() => {
    if (durationRef.current <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFinishedWhileAway(false);
    stopAlarm();
    // Reset cycle tracking when starting fresh from idle or alerting.
    if (timerState === "idle" || timerState === "alerting") {
      currentPhaseRef.current = "work";
      setCurrentPhase("work");
      completedCyclesRef.current = 0;
      setCompletedCycles(0);
    }
    const startFrom =
      timerState === "paused" ? remainingRef.current : durationRef.current;
    if (startFrom <= 0) return;
    endAtWallRef.current = Date.now() + startFrom;
    setRemainingMs(startFrom);
    setTimerState("running");
    startTick();
    persistTimer("running");
  }, [timerState, startTick, stopAlarm, persistTimer]);

  const handlePause = useCallback(() => {
    if (endAtWallRef.current === null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    remainingRef.current = Math.max(0, endAtWallRef.current - Date.now());
    endAtWallRef.current = null;
    stopTick();
    setRemainingMs(remainingRef.current);
    setTimerState("paused");
    persistTimer("paused");
  }, [stopTick, persistTimer]);

  const handleReset = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    stopTick();
    stopAlarm();
    endAtWallRef.current = null;
    remainingRef.current = durationRef.current;
    setRemainingMs(durationRef.current);
    setTimerState("idle");
    setFinishedWhileAway(false);
    clearPersistedTimer();
    // Reset repeat cycle tracking.
    currentPhaseRef.current = "work";
    setCurrentPhase("work");
    completedCyclesRef.current = 0;
    setCompletedCycles(0);
  }, [stopTick, stopAlarm, clearPersistedTimer]);

  /** Single tap silences the completion alert without restarting. */
  const handleDismissAlert = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    stopAlarm();
    setTimerState("idle");
  }, [stopAlarm]);

  const isRunning = timerState === "running";
  const isPaused = timerState === "paused";
  const isIdle = timerState === "idle";
  const isAlerting = timerState === "alerting";
  const lcdMain = lcdMainSize(width, height);

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />

      {/* ── Top bar (#414, MD3 chrome #440) ── */}
      <Appbar.Header style={s.topBar} statusBarHeight={0} elevated={false} mode="small">
        <TopBarButton label="‹ BACK" onPress={onBack} variant="blue" accessibilityLabel="Back" />
        <TopBarButton
          label="SESSIONS"
          onPress={onOpenSessions}
          variant="blue"
          accessibilityLabel="Open sessions list"
        />
        <TopBarButton
          label="FULL"
          onPress={() => setFsVisible(true)}
          variant="grey"
          accessibilityLabel="Open fullscreen timer view"
          testID="timer-fullscreen-btn"
        />
        <TopBarStatus
          label={
            isRunning ? "▼ RUN"
              : isPaused ? "‖ PAUSE"
              : isAlerting ? "◉ DONE"
              : "READY"
          }
          variant={isRunning || isAlerting || isPaused ? "yellow" : "grey"}
        />
      </Appbar.Header>

      {/* ── Fullscreen overlay (#422) ── */}
      <FullscreenOverlay
        visible={fsVisible}
        onDismiss={() => setFsVisible(false)}
        ms={remainingMs}
        label={
          isAlerting ? "Timer · Time's Up!"
            : isRunning ? "Timer · Counting Down"
            : isPaused ? "Timer · Paused"
            : "Countdown Timer"
        }
        subLabel={
          isAlerting ? `Reset to ${fmtParts(durationMs).main}`
            : `Set: ${fmtParts(durationMs).main}`
        }
        alerting={isAlerting}
        fontsLoaded={fontsLoaded}
      />

      {/* ── LCD instrument panel — remaining time ── */}
      <View style={s.instrument}>
        <View style={s.instrHeader}>
          <Text style={s.instrLabel}>
            {isAlerting
              ? "TIME'S UP"
              : repeatEnabled && (isRunning || isPaused)
              ? `${currentPhase === "work" ? "WORK" : "REST"} — TIME REMAINING`
              : "TIME REMAINING"}
          </Text>
          <Text style={s.instrLabel}>
            {repeatEnabled && (isRunning || isPaused)
              ? `CYCLE ${currentPhase === "work" ? completedCycles + 1 : completedCycles}${repeatCount !== null ? ` OF ${repeatCount}` : ""}`
              : `SET ${fmtParts(durationMs).main}`}
          </Text>
        </View>
        <View
          style={s.instrMain}
          accessible
          accessibilityLabel={
            isAlerting
              ? "Time's up"
              : `Time remaining: ${fmtCompact(remainingMs)}`
          }
        >
          <LcdDisplay
            ms={remainingMs}
            mainSize={lcdMain}
            color={isAlerting ? C.red : C.lcd}
            fontLoaded={fontsLoaded}
          />
        </View>
        <View style={s.instrFooter}>
          <Text style={s.instrLabel}>
            {isAlerting
              ? "RESET TO SET VALUE — START TO GO AGAIN"
              : "COUNTDOWN TIMER"}
          </Text>
        </View>
      </View>

      {/* ── Mode toggle (#232) — shown only in idle ── */}
      {isIdle && <ModeToggleStrip mode="timer" onSelect={onSelectMode} />}

      {/* ── Duration inputs (idle only) — MD3 chrome #440 ── */}
      {isIdle && (
        <Card mode="outlined" style={s.cuePanel}>
          <View style={[s.cueRow, { borderBottomWidth: 0 }]}>
            <Text style={s.cueLabel}>DURATION (H : MM : SS)</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <PaperTextInput
                mode="outlined"
                dense
                value={hh}
                onChangeText={(t) => {
                  const clean = t.replace(/[^0-9]/g, "").slice(0, 2);
                  setHh(clean);
                  commitDurationInputs(clean, mm, ss);
                }}
                keyboardType="number-pad"
                style={s.timerInput}
                contentStyle={s.timerInputContent}
                accessibilityLabel="Timer hours"
                maxLength={2}
              />
              <Text style={s.cueColon}>:</Text>
              <PaperTextInput
                mode="outlined"
                dense
                value={mm}
                onChangeText={(t) => {
                  const clean = t.replace(/[^0-9]/g, "").slice(0, 2);
                  setMm(clean);
                  commitDurationInputs(hh, clean, ss);
                }}
                keyboardType="number-pad"
                style={s.timerInput}
                contentStyle={s.timerInputContent}
                accessibilityLabel="Timer minutes"
                maxLength={2}
              />
              <Text style={s.cueColon}>:</Text>
              <PaperTextInput
                mode="outlined"
                dense
                value={ss}
                onChangeText={(t) => {
                  const clean = t.replace(/[^0-9]/g, "").slice(0, 2);
                  setSs(clean);
                  commitDurationInputs(hh, mm, clean);
                }}
                keyboardType="number-pad"
                style={s.timerInput}
                contentStyle={s.timerInputContent}
                accessibilityLabel="Timer seconds"
                maxLength={2}
              />
            </View>
          </View>
          <View style={s.cueRow}>
            <Text style={s.cueLabel}>SOUND ON COMPLETION</Text>
            <PaperSwitch
              value={cueSettings.soundEnabled}
              accessibilityLabel="Sound on timer completion"
              onValueChange={() =>
                updateCueSettings({ soundEnabled: !cueSettings.soundEnabled })
              }
            />
          </View>
          <View style={[s.cueRow, { borderBottomWidth: 0 }]}>
            <Text style={s.cueLabel}>VIBRATION ON COMPLETION</Text>
            <PaperSwitch
              value={cueSettings.vibrationEnabled}
              accessibilityLabel="Vibration on timer completion"
              onValueChange={() =>
                updateCueSettings({ vibrationEnabled: !cueSettings.vibrationEnabled })
              }
            />
          </View>
          <Text style={s.cueHint}>
            On completion the timer resets to the set value, ready to restart
            with one tap. The alert repeats a few times, then goes quiet — one
            tap dismisses it.{"\n"}
            {!cueSettings.soundEnabled && !cueSettings.vibrationEnabled
              ? "Both sound and vibration are off — watch for the visual alert (the dial flashes)."
              : !cueSettings.soundEnabled
              ? "Sound off — vibration only."
              : !cueSettings.vibrationEnabled
              ? "Vibration off — sound only."
              : null}
          </Text>

          {/* ── Repeat / Pomodoro mode (ADR 0025) ──────────────────────── */}
          <View style={[s.cueRow, { borderTopWidth: 1, borderTopColor: C.ink, flexDirection: "column", alignItems: "stretch", gap: 8 }]}>
            <Text style={s.cueLabel}>MODE</Text>
            <SegmentedButtons
              value={repeatEnabled ? "repeat" : "single"}
              onValueChange={(value) => {
                const on = value === "repeat";
                setRepeatEnabled(on);
                repeatEnabledRef.current = on;
                persistRepeatConfig(
                  on
                    ? { restDurationMs: restDurationMsRef.current, repeatCount: repeatCountRef.current }
                    : null
                );
              }}
              buttons={[
                { value: "single", label: "SINGLE", accessibilityLabel: "Single countdown" },
                { value: "repeat", label: "REPEAT", accessibilityLabel: "Enable repeat / Pomodoro mode" },
              ]}
            />
          </View>
          {repeatEnabled && (
            <>
              <View style={[s.cueRow, { borderBottomWidth: 0 }]}>
                <Text style={s.cueLabel}>REST (H : MM : SS)</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <PaperTextInput
                    mode="outlined"
                    dense
                    value={restHh}
                    onChangeText={(t) => {
                      const clean = t.replace(/[^0-9]/g, "").slice(0, 2);
                      setRestHh(clean);
                      commitRestDurationInputs(clean, restMm, restSs);
                    }}
                    keyboardType="number-pad"
                    style={s.timerInput}
                    contentStyle={s.timerInputContent}
                    accessibilityLabel="Rest hours"
                    maxLength={2}
                  />
                  <Text style={s.cueColon}>:</Text>
                  <PaperTextInput
                    mode="outlined"
                    dense
                    value={restMm}
                    onChangeText={(t) => {
                      const clean = t.replace(/[^0-9]/g, "").slice(0, 2);
                      setRestMm(clean);
                      commitRestDurationInputs(restHh, clean, restSs);
                    }}
                    keyboardType="number-pad"
                    style={s.timerInput}
                    contentStyle={s.timerInputContent}
                    accessibilityLabel="Rest minutes"
                    maxLength={2}
                  />
                  <Text style={s.cueColon}>:</Text>
                  <PaperTextInput
                    mode="outlined"
                    dense
                    value={restSs}
                    onChangeText={(t) => {
                      const clean = t.replace(/[^0-9]/g, "").slice(0, 2);
                      setRestSs(clean);
                      commitRestDurationInputs(restHh, restMm, clean);
                    }}
                    keyboardType="number-pad"
                    style={s.timerInput}
                    contentStyle={s.timerInputContent}
                    accessibilityLabel="Rest seconds"
                    maxLength={2}
                  />
                </View>
              </View>
              <View style={[s.cueRow, { borderBottomWidth: 0 }]}>
                <Text style={s.cueLabel}>CYCLES (blank = ∞)</Text>
                <PaperTextInput
                  mode="outlined"
                  dense
                  value={repeatCountStr}
                  onChangeText={(t) => {
                    const raw = t.replace(/[^0-9]/g, "").slice(0, 2);
                    setRepeatCountStr(raw);
                    const n =
                      raw === ""
                        ? null
                        : Math.max(1, Math.min(99, parseInt(raw, 10)));
                    setRepeatCount(n);
                    repeatCountRef.current = n;
                    persistRepeatConfig({
                      restDurationMs: restDurationMsRef.current,
                      repeatCount: n,
                    });
                  }}
                  keyboardType="number-pad"
                  placeholder="∞"
                  style={[s.timerInput, { width: 60 }]}
                  contentStyle={s.timerInputContent}
                  accessibilityLabel="Repeat cycles (blank for infinite)"
                  maxLength={2}
                />
              </View>
              <Text style={s.cueHint}>
                Work uses the duration above. Rest follows automatically. Stop is
                always available.
              </Text>
            </>
          )}
        </Card>
      )}

      {finishedWhileAway && (
        <View style={s.cuePanel}>
          <Text style={s.cueHint}>
            Timer finished while the app was closed — reset to the set value.
          </Text>
        </View>
      )}

      {/* Spacer keeps the button bar anchored */}
      <View style={{ flex: 1 }} />

      {/* ── Logo footer ── */}
      <LogoFooter />

      {/* ── Device bottom button bar ── */}
      <View style={s.btnCasing}>
        {isAlerting ? (
          <>
            <DeviceBtn
              label="DISMISS"
              body={C.btnPaperBody}
              hi={C.btnPaperHi}
              lo={C.btnPaperLo}
              textColor={C.ink}
              onPress={handleDismissAlert}
              flex={1}
            />
            <View style={{ width: 10 }} />
            <DeviceBtn
              label="START"
              sub="GO AGAIN"
              body={C.btnBlueBody}
              hi={C.btnBlueHi}
              lo={C.btnBlueLo}
              textColor={C.ink}
              onPress={handleStart}
              flex={1.4}
            />
          </>
        ) : (
          <>
            <DeviceBtn
              label="RESET"
              body={C.btnPaperBody}
              hi={C.btnPaperHi}
              lo={C.btnPaperLo}
              textColor={C.ink}
              disabled={isIdle}
              onPress={handleReset}
              flex={1}
            />
            <View style={{ width: 10 }} />
            {isRunning ? (
              <DeviceBtn
                label="PAUSE"
                body={C.btnRedBody}
                hi={C.btnRedHi}
                lo={C.btnRedLo}
                onPress={handlePause}
                flex={1.4}
              />
            ) : (
              <DeviceBtn
                label={isPaused ? "RESUME" : "START"}
                body={C.btnBlueBody}
                hi={C.btnBlueHi}
                lo={C.btnBlueLo}
                textColor={C.ink}
                onPress={handleStart}
                flex={1.4}
              />
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Name input modal (cross-platform) — used for session create/rename ────────
/**
 * Simple modal with a TextInput for entering a session name.
 * Uses React Native Modal so it works on both iOS and Android without
 * relying on Alert.prompt (iOS-only).
 */
function NameInputModal({
  visible,
  title,
  initialValue,
  placeholder,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  placeholder: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  // Reset the input value whenever the modal opens with a new initialValue
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const handleConfirm = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  }, [value, onConfirm]);

  const trimmedEmpty = value.trim().length === 0;

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onCancel} style={nm.dialog}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <PaperTextInput
            mode="outlined"
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            autoCapitalize="words"
            autoFocus
            onSubmitEditing={handleConfirm}
            returnKeyType="done"
            maxLength={50}
            accessibilityLabel={title}
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onCancel} accessibilityLabel="Cancel">
            Cancel
          </Button>
          <Button
            mode="contained"
            onPress={handleConfirm}
            disabled={trimmedEmpty}
            accessibilityLabel="Confirm"
          >
            OK
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const nm = StyleSheet.create({
  dialog: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
});

// ── Session switcher modal (ADR 0024 / issue #366) ─────────────────────────────
/**
 * Full-screen modal listing all local solo sessions.
 * Provides create, rename, delete (with confirmation), and switch actions.
 * Enforces the SESSION_CAP (10) from ADR 0024.
 */
function SessionSwitcherModal({
  visible,
  activeSessionId,
  onClose,
  onSwitch,
}: {
  visible: boolean;
  activeSessionId: string | null;
  onClose: () => void;
  onSwitch: (id: string, mode: SoloMode) => void;
}) {
  const [sessions, setSessions] = useState<SoloSessionMeta[]>([]);
  const [payloads, setPayloads] = useState<Record<string, SoloSessionPayload>>({});
  const [loading, setLoading] = useState(false);
  const [nameModal, setNameModal] = useState<{
    mode: "create" | "rename";
    initialValue: string;
    sessionId?: string;
  } | null>(null);

  // ── Drag-to-reorder state ─────────────────────────────────────────────────
  /** Local session order — updated optimistically during drag before persistence. */
  const [localSessions, setLocalSessions] = useState<SoloSessionMeta[]>([]);
  /** ID of the session currently being dragged (null when not dragging). */
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /**
   * Accumulated dy for the current drag gesture (used to detect threshold
   * crossings). Stored in a ref to avoid triggering re-renders on every frame.
   */
  const dragAccumRef = useRef(0);
  /**
   * Cache of PanResponder objects, keyed by session ID.
   * PanResponders are created lazily and reused so that native gesture
   * handlers are stable across renders.
   */
  const panRespondersRef = useRef<Map<string, ReturnType<typeof PanResponder.create>>>(new Map());

  /** Item height in pts — matches ssm.row minHeight. */
  const DRAG_ITEM_H = 66;

  /** Sync localSessions from the authoritative sessions state. */
  useEffect(() => {
    setLocalSessions(sessions);
  }, [sessions]);

  /**
   * Return (and lazily create) a stable PanResponder for the given session ID.
   *
   * Closure variables used inside the PanResponder handlers:
   *   - `sessionId` — the stable ID string (never changes for a given session)
   *   - `dragAccumRef` — mutable ref, always current
   *   - `setDraggingId` / `setLocalSessions` — stable React state setters
   *   - `Haptics` — stable module reference
   *   - `reorderSessions` — stable module-level function
   */
  function getOrCreatePanResponder(sessionId: string): ReturnType<typeof PanResponder.create> {
    if (!panRespondersRef.current.has(sessionId)) {
      panRespondersRef.current.set(
        sessionId,
        PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: (_, { dy }) => Math.abs(dy) > 2,
          onPanResponderGrant: () => {
            dragAccumRef.current = 0;
            setDraggingId(sessionId);
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          },
          onPanResponderMove: (_, { dy }) => {
            const delta = dy - dragAccumRef.current;
            if (Math.abs(delta) > DRAG_ITEM_H / 2) {
              const dir = delta > 0 ? 1 : -1;
              setLocalSessions((prev) => {
                const idx = prev.findIndex((s) => s.id === sessionId);
                if (idx === -1) return prev;
                const newIdx = Math.max(0, Math.min(prev.length - 1, idx + dir));
                if (newIdx === idx) return prev;
                const next = [...prev];
                [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
                return next;
              });
              dragAccumRef.current = dy;
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
          },
          onPanResponderRelease: () => {
            setDraggingId(null);
            setLocalSessions((prev) => {
              // Persist the new order fire-and-forget
              reorderSessions(prev.map((s) => s.id)).catch(() => undefined);
              return prev;
            });
          },
          onPanResponderTerminate: () => {
            setDraggingId(null);
          },
        })
      );
    }
    return panRespondersRef.current.get(sessionId)!;
  }

  // Load sessions + payloads (for running/paused indicator) when modal opens
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const index = await listSessions();
      setSessions(index);
      const pMap: Record<string, SoloSessionPayload> = {};
      await Promise.all(
        index.map(async (meta) => {
          const p = await getSession(meta.id);
          if (p) pMap[meta.id] = p;
        })
      );
      setPayloads(pMap);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) loadAll();
  }, [visible, loadAll]);

  // Derive running/paused state from persisted payload
  function sessionRunState(
    meta: SoloSessionMeta
  ): "running" | "paused" | null {
    const p = payloads[meta.id];
    if (!p) return null;
    if (meta.mode === "stopwatch") {
      const st = p.stopwatchState?.state;
      return st ?? null;
    }
    const st = p.timerState?.state;
    return st ?? null;
  }

  // Create new session
  const handleOpenCreate = useCallback(() => {
    const nextNum = sessions.length + 1;
    setNameModal({
      mode: "create",
      initialValue: `Session ${nextNum}`,
    });
  }, [sessions.length]);

  const handleCreateConfirm = useCallback(
    async (name: string) => {
      setNameModal(null);
      const id = generateUUID();
      try {
        await createSession(id, name, "stopwatch");
        await loadAll();
      } catch (err) {
        Alert.alert(
          "Cannot create session",
          (err as Error).message ?? "Session cap reached."
        );
      }
    },
    [loadAll]
  );

  // Rename session
  const handleOpenRename = useCallback((meta: SoloSessionMeta) => {
    setNameModal({
      mode: "rename",
      initialValue: meta.name,
      sessionId: meta.id,
    });
  }, []);

  const handleRenameConfirm = useCallback(
    async (name: string) => {
      const id = nameModal?.sessionId;
      setNameModal(null);
      if (!id) return;
      await updateSessionMeta(id, { name });
      await loadAll();
    },
    [nameModal, loadAll]
  );

  // Delete session
  const handleDelete = useCallback(
    (meta: SoloSessionMeta) => {
      const runState = sessionRunState(meta);
      const isActive = meta.id === activeSessionId;
      const detail = isActive
        ? "This is your current session. Its lap data will be lost."
        : runState
        ? "This session has a timer in progress. Its lap data will be lost."
        : "This cannot be undone.";

      Alert.alert(
        `Delete "${meta.name}"?`,
        detail,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              await deleteSession(meta.id);
              await loadAll();
            },
          },
        ]
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSessionId, payloads, loadAll]
  );

  // Switch to a session
  const handleSwitch = useCallback(
    async (meta: SoloSessionMeta) => {
      if (meta.id === activeSessionId) {
        onClose();
        return;
      }
      await setActiveSessionId(meta.id);
      onSwitch(meta.id, meta.mode as SoloMode);
    },
    [activeSessionId, onClose, onSwitch]
  );

  const atCap = sessions.length >= SESSION_CAP;

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onClose} style={ssm.dialog}>
        <Dialog.Title>Sessions</Dialog.Title>

        {/* Cap notice */}
        {atCap && (
          <Dialog.Content style={{ paddingBottom: 0 }}>
            <HelperText type="error" visible>
              Session limit ({SESSION_CAP}) reached — delete a session to
              create a new one.
            </HelperText>
          </Dialog.Content>
        )}

        {/* Session list */}
        <Dialog.ScrollArea style={ssm.scrollArea}>
          {loading ? (
            <View style={ssm.centerBox}>
              <PaperActivityIndicator />
            </View>
          ) : sessions.length === 0 ? (
            <View style={ssm.centerBox}>
              <PaperText variant="bodyMedium" style={{ textAlign: "center" }}>
                No sessions yet. Create one below.
              </PaperText>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={{ paddingVertical: 4 }}
              scrollEnabled={draggingId === null}
            >
              {localSessions.map((item) => {
                const isActive = item.id === activeSessionId;
                const isDragging = item.id === draggingId;
                const runState = sessionRunState(item);
                const modeLabel = item.mode === "timer" ? "⏲ TIMER" : "⏱ SW";
                const sessionColor = item.color;
                const dragHandlers = getOrCreatePanResponder(item.id).panHandlers;

                return (
                  <View
                    key={item.id}
                    style={[
                      ssm.row,
                      isActive && ssm.rowActive,
                      isDragging && ssm.rowDragging,
                    ]}
                  >
                    {/* Color accent strip — left edge */}
                    {sessionColor && (
                      <View
                        style={[ssm.colorStrip, { backgroundColor: sessionColor }]}
                        accessibilityLabel={`Color tag: ${SESSION_COLORS.find((c) => c.value === sessionColor)?.label ?? "Custom"}`}
                      />
                    )}

                    <List.Item
                      title={item.name}
                      titleNumberOfLines={1}
                      titleStyle={[ssm.rowName, isActive && ssm.rowNameActive]}
                      onPress={() => handleSwitch(item)}
                      accessibilityLabel={`Switch to ${item.name}`}
                      accessibilityState={{ selected: isActive }}
                      style={ssm.listItem}
                      left={() => (
                        <View
                          {...dragHandlers}
                          style={ssm.dragHandle}
                          accessibilityRole="button"
                          accessibilityLabel={`Drag to reorder ${item.name}`}
                        >
                          <Text style={ssm.dragHandleText}>≡</Text>
                        </View>
                      )}
                      description={() => (
                        <View style={ssm.rowMeta}>
                          {isActive && (
                            <Text style={ssm.activeDot} accessibilityLabel="Active">
                              ● ACTIVE
                            </Text>
                          )}
                          <Text style={ssm.modeBadge}>{modeLabel}</Text>
                          {runState && (
                            <View
                              style={[
                                ssm.stateBadge,
                                runState === "running" && { backgroundColor: C.red },
                                runState === "paused" && { backgroundColor: C.yellow },
                              ]}
                              accessible
                              accessibilityLabel={runState === "running" ? "Running" : "Paused"}
                            >
                              <Text
                                style={[
                                  ssm.stateBadgeText,
                                  runState === "running" && { color: C.white },
                                  runState === "paused" && { color: C.ink },
                                ]}
                              >
                                {runState === "running" ? "● RUN" : "‖ PAUSED"}
                              </Text>
                            </View>
                          )}
                          <Text style={ssm.lastUsed}>{fmtAge(item.lastUsedAt)}</Text>
                        </View>
                      )}
                      right={() => (
                        <View style={ssm.rowActions}>
                          <Pressable
                            onPress={() => handleOpenRename(item)}
                            hitSlop={4}
                            style={({ pressed }) => [ssm.actionIcon, { opacity: pressed ? 0.6 : 1 }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Rename ${item.name}`}
                          >
                            <Text style={ssm.actionIconText}>✎</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => handleDelete(item)}
                            hitSlop={4}
                            style={({ pressed }) => [ssm.actionIcon, ssm.deleteIcon, { opacity: pressed ? 0.6 : 1 }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${item.name}`}
                          >
                            <Text style={[ssm.actionIconText, { color: C.white }]}>🗑</Text>
                          </Pressable>
                        </View>
                      )}
                    />
                  </View>
                );
              })}
            </ScrollView>
          )}
        </Dialog.ScrollArea>

        <Dialog.Actions>
          <Button
            mode="contained"
            onPress={atCap ? undefined : handleOpenCreate}
            disabled={atCap}
            accessibilityLabel="Create new session"
          >
            + New session
          </Button>
          <Button onPress={onClose} accessibilityLabel="Close sessions panel">
            Close
          </Button>
        </Dialog.Actions>
      </Dialog>

      {/* Name input modal (create / rename) */}
      <NameInputModal
        visible={nameModal !== null}
        title={nameModal?.mode === "create" ? "New Session" : "Rename Session"}
        initialValue={nameModal?.initialValue ?? ""}
        placeholder="Session name"
        onConfirm={
          nameModal?.mode === "create" ? handleCreateConfirm : handleRenameConfirm
        }
        onCancel={() => setNameModal(null)}
      />
    </Portal>
  );
}

const ssm = StyleSheet.create({
  dialog: {
    maxHeight: "85%",
  },
  scrollArea: {
    paddingHorizontal: 0,
  },
  centerBox: {
    minHeight: 120,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  listItem: {
    flex: 1,
    paddingRight: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.white,
    borderBottomWidth: 1,
    borderColor: C.line,
    minHeight: 66,
  },
  rowActive: {
    backgroundColor: C.blueTint,
    borderLeftWidth: 4,
    borderLeftColor: C.bluePrimary,
  },
  colorStrip: {
    width: 5,
    alignSelf: "stretch",
  },
  rowDragging: {
    opacity: 0.75,
    backgroundColor: C.panelBg,
  },
  dragHandle: {
    width: ICON_BTN_SIZE,
    height: 66,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 8,
  },
  dragHandleText: {
    fontSize: 20,
    color: C.muted,
    fontWeight: "900",
    letterSpacing: 1,
  },
  rowName: {
    fontSize: 15,
    fontWeight: "800",
    color: C.ink,
    letterSpacing: 0.2,
    flex: 1,
  },
  rowNameActive: {
    color: C.bluePrimary,
  },
  activeDot: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
    color: C.bluePrimary,
  },
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modeBadge: {
    fontSize: 10,
    fontWeight: "800",
    color: C.muted,
    letterSpacing: 0.5,
  },
  stateBadge: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: C.dark,
  },
  stateBadgeText: {
    color: C.white,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  lastUsed: {
    fontSize: 10,
    color: C.muted,
    fontWeight: "600",
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 12,
    gap: 6,
  },
  actionIcon: {
    width: ICON_BTN_SIZE,
    height: ICON_BTN_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
    backgroundColor: C.panelBg,
    borderWidth: 1,
    borderColor: C.line,
  },
  deleteIcon: {
    backgroundColor: C.red,
    borderColor: C.red,
  },
  actionIconText: {
    fontSize: 16,
    color: C.ink,
  },
});

// ── Solo container: routes between stopwatch and timer modes (#232) ───────────
// Also manages the multi-session active session pointer (ADR 0024 / issue #364).
function SoloContainer({
  fontsLoaded,
  onBack,
  onGoShared,
}: {
  fontsLoaded: boolean;
  onBack: () => void;
  onGoShared: () => void;
}) {
  const [mode, setMode] = useState<SoloMode>("stopwatch");
  const [modeLoaded, setModeLoaded] = useState(false);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const [showSwitcher, setShowSwitcher] = useState(false);

  useEffect(() => {
    // Resolve (or create) the active session, migrating legacy data if needed.
    resolveActiveSession(generateUUID)
      .then(async (id) => {
        setActiveSessionIdState(id);
        // Load the mode from the session meta in the index
        const index = await loadIndex();
        const meta = index.find((m) => m.id === id);
        if (meta && (meta.mode === "timer" || meta.mode === "stopwatch")) {
          setMode(meta.mode);
        }
        setModeLoaded(true);
      })
      .catch(() => setModeLoaded(true));
  }, []);

  const handleSelectMode = useCallback((m: SoloMode) => {
    setMode(m);
    if (activeSessionId) {
      updateSessionMeta(activeSessionId, { mode: m }).catch(() => undefined);
    }
  }, [activeSessionId]);

  /**
   * Called by SessionSwitcherModal when the user picks a different session.
   * Updating `activeSessionId` changes the `key` prop of the child screen,
   * which triggers a remount and re-reads the new session's persisted state.
   */
  const handleSessionSwitch = useCallback((id: string, newMode: SoloMode) => {
    setMode(newMode);
    setActiveSessionIdState(id);
    setShowSwitcher(false);
  }, []);

  const handleOpenSwitcher = useCallback(() => {
    setShowSwitcher(true);
  }, []);

  if (!modeLoaded) return <LoadingScreen />;

  return (
    <>
      {mode === "timer" ? (
        <TimerScreen
          key={activeSessionId ?? "timer"}
          fontsLoaded={fontsLoaded}
          onBack={onBack}
          onSelectMode={handleSelectMode}
          activeSessionId={activeSessionId}
          onOpenSessions={handleOpenSwitcher}
        />
      ) : (
        <SoloScreen
          key={activeSessionId ?? "sw"}
          fontsLoaded={fontsLoaded}
          onBack={onBack}
          onSelectMode={handleSelectMode}
          onGoShared={onGoShared}
          activeSessionId={activeSessionId}
          onOpenSessions={handleOpenSwitcher}
        />
      )}
      <SessionSwitcherModal
        visible={showSwitcher}
        activeSessionId={activeSessionId}
        onClose={() => setShowSwitcher(false)}
        onSwitch={handleSessionSwitch}
      />
    </>
  );
}

// ── Root navigator ─────────────────────────────────────────────────────────────
function RootNavigator() {
  const [fontsLoaded] = useFonts({
    "DSEG7Classic-Regular": require("./assets/fonts/DSEG7Classic-Regular.ttf"),
  });

  // The stopwatch is the app's primary purpose and needs no account, so it is
  // always the landing screen. Shared/"Time together" sessions still require
  // sign-in, surfaced only when the user opts into that flow (see onGoShared).
  const [screen, setScreen] = useState<AppScreen>("solo");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [sessionParams, setSessionParams] = useState<SessionNavParams | null>(null);
  const [joinParams, setJoinParams] = useState<JoinNavParams | null>(null);
  const [liveViewParams, setLiveViewParams] = useState<LiveViewNavParams | null>(null);

  // ── Auth check on mount ─────────────────────────────────────────────────────
  // This only tracks whether the user already has a session so "Time
  // together" can skip straight to the session list — it never redirects
  // away from the stopwatch on its own.
  useEffect(() => {
    // Shared sessions require Supabase credentials. Without them, skip the
    // auth check entirely — solo mode must work with no backend configured.
    if (!isSupabaseConfigured) {
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserEmail(session.user.email ?? null);
        setUserName(session.user.user_metadata?.full_name ?? null);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          setUserEmail(session.user.email ?? null);
          setUserName(session.user.user_metadata?.full_name ?? null);
        } else {
          setUserEmail(null);
          setUserName(null);
        }
      }
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  // ── Deep link handling ──────────────────────────────────────────────────────
  // Handles both join links (…/s/<code>) and the Google OAuth callback
  // (org.splitsync.stopwatch://auth/callback). The callback is normally
  // consumed directly from the WebBrowser.openAuthSessionAsync() result in
  // LoginScreen, but Android can also redeliver it here, so this stays as a
  // safety net that no-ops once the session already exists.
  const handleIncomingUrl = useCallback((url: string) => {
    const code = extractCodeFromUrl(url);
    if (code) {
      if (isLiveViewUrl(url)) {
        setLiveViewParams({ code });
        setScreen("viewer");
      } else {
        setJoinParams({ code });
        setScreen("join");
      }
      return;
    }
    if (url.includes("auth/callback")) {
      consumeAuthCallbackUrl(url);
    }
  }, []);

  useEffect(() => {
    // Initial URL (app was opened from a link)
    ExpoLinking.getInitialURL().then((url) => {
      if (url) handleIncomingUrl(url);
    });

    // Subsequent links while app is open
    const sub = ExpoLinking.addEventListener("url", ({ url }) => {
      handleIncomingUrl(url);
    });
    return () => sub.remove();
  }, [handleIncomingUrl]);

  // ── Sign out ────────────────────────────────────────────────────────────────
  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    setScreen("login");
  }, []);

  // ── Screen routing ──────────────────────────────────────────────────────────
  if (screen === "loading") {
    return <LoadingScreen />;
  }

  if (screen === "login") {
    return (
      <LoginScreen
        onLogin={() => setScreen("home")}
        onSolo={() => setScreen("solo")}
      />
    );
  }

  if (screen === "solo") {
    return (
      <SoloContainer
        fontsLoaded={!!fontsLoaded}
        onBack={() => setScreen(userEmail ? "home" : "login")}
        onGoShared={() => setScreen(userEmail ? "home" : "login")}
      />
    );
  }

  if (screen === "home") {
    return (
      <HomeScreen
        userEmail={userEmail ?? ""}
        userName={userName}
        onNewSession={() => setScreen("create")}
        onSolo={() => setScreen("solo")}
        onRejoinSession={(params) => {
          setSessionParams(params);
          setScreen("session");
        }}
        onSignOut={handleSignOut}
      />
    );
  }

  if (screen === "create") {
    return (
      <CreateScreen
        onCreated={(params) => {
          setSessionParams(params);
          setScreen("session");
        }}
        onBack={() => setScreen("home")}
      />
    );
  }

  if (screen === "join") {
    return (
      <JoinScreen
        pendingCode={joinParams?.code ?? null}
        onJoined={(params) => {
          setSessionParams(params);
          setScreen("session");
        }}
        onView={(code) => {
          setLiveViewParams({ code });
          setScreen("viewer");
        }}
        onBack={() => setScreen(userEmail ? "home" : "login")}
      />
    );
  }

  if (screen === "viewer" && liveViewParams) {
    return <LiveViewerScreen code={liveViewParams.code} fontsLoaded={!!fontsLoaded} onBack={() => setScreen(userEmail ? "home" : "login")} />;
  }

  if (screen === "session" && sessionParams) {
    return (
      <SessionScreen
        params={sessionParams}
        fontsLoaded={!!fontsLoaded}
        onBack={() => setScreen(userEmail ? "home" : "login")}
      />
    );
  }

  // Fallback
  return <LoadingScreen />;
}

// ── App root ──────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={stopwatchTheme}>
        <RootNavigator />
      </PaperProvider>
    </SafeAreaProvider>
  );
}

// ── LapTrendChart styles ───────────────────────────────────────────────────────
const sc = StyleSheet.create({
  trendChart: {
    backgroundColor: C.panelBg,
    borderBottomWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 4,
  },
  trendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  trendNum: {
    width: 20,
    fontSize: 9,
    fontWeight: "700",
    color: C.muted,
    textAlign: "right",
  },
  trendTrack: {
    flex: 1,
    height: 8,
    backgroundColor: C.line,
    borderRadius: 1,
    overflow: "hidden",
  },
  trendFill: {
    height: "100%" as unknown as number,
    borderRadius: 1,
  },
  trendTime: {
    width: 52,
    fontSize: 10,
    fontWeight: "700",
    color: C.muted,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
});

// ── Styles ────────────────────────────────────────────────────────────────────
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
  casingLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  logoChip: {
    flexDirection: "row",
    backgroundColor: C.black,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 2,
    gap: 3,
  },
  logoSplit: { color: C.white, fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  logoSync:  { color: C.yellow, fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  casingTitle: { color: C.casingMuted, fontSize: 10, fontWeight: "900", letterSpacing: 3 },

  // Redesigned top bar (#414) — one evenly distributed row of identically
  // sized buttons, no title text or logo (branding stays in LogoFooter).
  topBar: {
    backgroundColor: C.casing,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 6,
    borderBottomWidth: 3,
    borderColor: C.casingBorder,
  },
  topBarBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  topBarBtnContent: {
    minHeight: 44,
    paddingHorizontal: 4,
  },
  topBarStatusChip: {
    width: "100%",
    justifyContent: "center",
    borderRadius: 8,
  },
  topBarBtnText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    marginVertical: 0,
  },
  topBarPendingDot: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.white,
  },

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
    flexDirection: "row",
    justifyContent: "space-between",
  },
  instrLabel: { color: C.casingMuted, fontSize: 9, fontWeight: "900", letterSpacing: 2.5 },
  instrMain:  { paddingHorizontal: 20, paddingBottom: 10 },
  instrFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderColor: C.instrumentBorder,
    paddingTop: 10,
  },

  // Participant strip
  participantStrip: {
    backgroundColor: C.deepDark,
    borderBottomWidth: 1,
    borderColor: C.black,
    maxHeight: 40,
  },
  participantPill: {
    backgroundColor: C.pillBg,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.pillBorder,
  },
  participantPillSelf: { borderColor: C.lcd, backgroundColor: C.lcdBg },
  participantPillOwner: { borderColor: C.yellow },
  participantPillText: {
    color: C.pillText,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
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
  lastLapTime:  {
    fontSize: 22,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    color: C.ink,
    letterSpacing: 1,
  },

  // Lap table
  table: { flex: 1 },
  // MD3 `Card`/`DataTable` chrome around the lap list (#439) — the
  // FlatList body and its row rendering below are unchanged.
  lapCard: {
    flex: 1,
    margin: 0,
    borderRadius: 0,
    backgroundColor: C.white,
  },
  lapTableHeader: {
    backgroundColor: C.ink,
    paddingHorizontal: 14,
  },
  lapHeaderText: {
    color: C.white,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
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
  td:      { fontSize: 14, fontVariant: ["tabular-nums"], fontWeight: "700", color: C.ink },
  cLap:    { width: 36 },
  cSplit:  { flex: 1 },
  cTime:   { flex: 1 },
  cDelta:  { width: 70 },
  cActor:  { width: 70, color: C.muted },

  // Solo — mode toggle (MD3 `SegmentedButtons`, #439)
  modeToggleWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panelBg,
  },
  modeToggleButtons: { flex: 1 },

  // Solo — delay selector
  delaySelector: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panelBg,
  },
  delayLabel: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
    color: C.muted,
    marginRight: 10,
  },
  delayOptions: {
    flexDirection: "row",
    gap: 6,
  },
  delayOption: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: 2,
    backgroundColor: C.white,
  },
  delayOptionActive: {
    backgroundColor: C.ink,
    borderColor: C.ink,
  },
  delayOptionText: {
    fontSize: 11,
    fontWeight: "800",
    color: C.muted,
    letterSpacing: 0.5,
  },
  delayOptionTextActive: {
    color: C.white,
  },

  // Solo — time together placeholder (MD3 `Card` empty state, #439)
  together: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
  togetherCard: {
    borderStyle: "dashed",
    opacity: 0.7,
  },
  togetherCardContent: {
    alignItems: "center",
    paddingVertical: 22,
  },
  togetherLabel: { color: C.ink, fontSize: 12, fontWeight: "900", letterSpacing: 1.5 },
  togetherSub:   { color: C.muted, fontSize: 10, fontWeight: "700", letterSpacing: 1, marginTop: 4 },

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

  // Form elements
  screenTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: C.ink,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  mutedText: { fontSize: 13, color: C.muted, lineHeight: 19 },
  inputLabel: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
    color: C.muted,
    marginBottom: 4,
  },
  textInput: {
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.line,
    borderRadius: 3,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: C.ink,
    fontWeight: "600",
  },
  errorBox: {
    backgroundColor: C.errorBg,
    borderWidth: 1.5,
    borderColor: C.red,
    borderRadius: 3,
    padding: 12,
    marginBottom: 14,
  },
  errorText: { color: C.red, fontSize: 13, fontWeight: "700" },
  primaryBtn: {
    backgroundColor: C.red,
    borderRadius: 3,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryBtnText: {
    color: C.white,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 2,
  },
  secondaryBtn: {
    backgroundColor: C.ink,
    borderRadius: 3,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryBtnText: {
    color: C.white,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  outlineBtn: {
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.ink,
    borderRadius: 3,
    paddingVertical: 12,
    alignItems: "center",
  },
  outlineBtnText: {
    color: C.ink,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.5,
  },

  // Solo share row (#226)
  shareRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.panelBg,
    borderBottomWidth: 1,
    borderColor: C.line,
  },
  shareRowBtn: {
    flex: 1,
    backgroundColor: C.white,
    borderWidth: 1.5,
    borderColor: C.ink,
    borderRadius: 3,
    paddingVertical: 9,
    alignItems: "center",
  },
  shareRowBtnText: {
    color: C.ink,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },

  ghostBtn: { paddingVertical: 12, alignItems: "center" },
  ghostBtnText: { color: C.red, fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 2 },
  backBtnText: { color: C.faint, fontSize: 13, fontWeight: "700" },

  googleBtn: {
    backgroundColor: C.white,
    borderWidth: 2,
    borderColor: C.ink,
    borderRadius: 3,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 16,
  },
  googleBtnText: {
    color: C.ink,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.line },
  dividerText: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  // MD3 HomeScreen session card actions row (#436).
  sessionActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 8,
    paddingBottom: 4,
  },

  // Lock hint toast — floating above the button bar
  lockHintToast: {
    position: "absolute",
    bottom: 90,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 100,
  },
  lockHintText: {
    backgroundColor: C.toastBg,
    color: C.white,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    overflow: "hidden",
  },

  // Stats strip (BEST / WORST / AVG)
  statsStrip: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 2,
    borderColor: C.rule,
    backgroundColor: C.panelBg,
  },
  statCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRightWidth: 1,
    borderColor: C.line,
    gap: 3,
  },
  statCellBest: {},
  statCellMid: {},
  statLabel: {
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.5,
    color: C.muted,
    textTransform: "uppercase",
  } as const,
  statValue: {
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    color: C.ink,
  },
  statValueBest: {
    backgroundColor: C.yellow,
    paddingHorizontal: 4,
    borderRadius: 1,
    color: C.ink,
    overflow: "hidden",
  } as const,
  statValueWorst: {
    backgroundColor: C.worse,
    paddingHorizontal: 4,
    borderRadius: 1,
    color: C.white,
    overflow: "hidden",
  } as const,

  // Logo footer — subtle centered brand element on control-dense screens
  logoFooter: {
    alignItems: "center",
    paddingVertical: 5,
    backgroundColor: C.casing,
    borderTopWidth: 1,
    borderColor: C.casingBorder,
  },

  // Sound cues (#227)
  cuePanel: {
    backgroundColor: C.panelBg,
    borderBottomWidth: 2,
    borderColor: C.rule,
    paddingTop: 4,
    paddingBottom: 4,
  },
  cueListItem: {
    paddingHorizontal: 16,
  },
  cueTargetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
  },
  cueInputPaper: {
    minWidth: 56,
    height: 40,
    textAlign: "center",
  },
  cueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderColor: C.line,
  },
  cueLabel: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
    color: C.ink,
    flexShrink: 1,
    paddingRight: 8,
  },
  cueInput: {
    backgroundColor: C.white,
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 14,
    fontWeight: "700",
    color: C.ink,
    minWidth: 44,
    textAlign: "center",
  },
  cueColon: { fontSize: 14, fontWeight: "900", color: C.ink },
  // MD3 duration/rest inputs on the Timer screen (#440) — react-native-paper
  // TextInput, sized to sit compactly next to the H : MM : SS colons.
  timerInput: { width: 56, height: 40, textAlign: "center" },
  timerInputContent: { textAlign: "center" },
  cueHint: {
    fontSize: 10,
    fontWeight: "600",
    color: C.muted,
    marginTop: 8,
    lineHeight: 14,
  },
  targetOverrun: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.red,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  targetOverrunLabel: {
    color: C.overrunLabel,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
  },
  targetOverrunTime: {
    color: C.white,
    fontSize: 14,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    letterSpacing: 1,
  },

  // Fullscreen overlay MD3 dismiss control (#441)
  fullscreenDismissBtn: {
    position: "absolute",
    top: 20,
    right: 20,
    zIndex: 1,
  },
  fullscreenDismissLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },

  // Home screen session list
  sectionHeader: {
    borderBottomWidth: 2,
    borderColor: C.rule,
    paddingBottom: 6,
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 10, fontWeight: "900", letterSpacing: 2.5, color: C.muted },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.white,
    borderBottomWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 2,
    marginBottom: 2,
  },
  sessionName: {
    fontSize: 15,
    fontWeight: "800",
    color: C.ink,
    letterSpacing: 0.2,
  },
  statusBadge: {
    backgroundColor: C.dimGray,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 10,
  },
  statusBadgeText: { color: C.white, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  deleteBtn: {
    marginLeft: 10,
    padding: 8,
    borderRadius: 4,
    backgroundColor: C.red,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBtnText: {
    fontSize: 16,
  },
});
