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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
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

type SessionStatus = "waiting" | "running" | "stopped";
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
  const top = disabled ? C.btnDimHi : hi;
  const bot = disabled ? C.btnDimLo : lo;
  const txt = disabled ? C.pillBorder : textColor;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={{ flex }}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {({ pressed }) => (
        <View
          style={{
            height: 68,
            borderRadius: 6,
            backgroundColor: pressed ? bot : bg,
            borderTopWidth: pressed ? 1 : 3,
            borderBottomWidth: pressed ? 5 : 3,
            borderLeftWidth: 1.5,
            borderRightWidth: 1.5,
            borderTopColor: pressed ? bg : top,
            borderBottomColor: bot,
            borderLeftColor: pressed ? bg : top,
            borderRightColor: bot,
            shadowColor: C.black,
            shadowOpacity: pressed ? 0.1 : 0.55,
            shadowRadius: pressed ? 1 : 5,
            shadowOffset: { width: 0, height: pressed ? 1 : 4 },
            elevation: pressed ? 1 : 8,
            transform: pressed ? [{ translateY: 2 }] : [{ translateY: 0 }],
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 4,
          }}
        >
          {sub && (
            <Text
              style={{
                color: pressed
                  ? C.faint
                  : disabled
                  ? C.dark
                  : C.btnSubLabel,
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
      )}
    </Pressable>
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

// Volume-key toggle chip shown in the casing header
function VolumeKeyToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={enabled ? "Volume keys active — tap to disable" : "Volume keys disabled — tap to enable"}
      hitSlop={8}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: enabled ? C.lcd : C.dark,
        backgroundColor: enabled ? C.lcdBg : "transparent",
        opacity: pressed ? 0.7 : 1,
        marginRight: 6,
      })}
    >
      <Text
        style={{
          color: enabled ? C.lcd : C.casingMuted,
          fontSize: 9,
          fontWeight: "900",
          letterSpacing: 1.5,
        }}
      >
        {enabled ? "VOL●" : "VOL○"}
      </Text>
    </Pressable>
  );
}

// Status pill
function StatusPill({ status }: { status: SessionStatus | "ready" }) {
  const isRunning = status === "running";
  const isStopped = status === "stopped";
  const isWaiting = status === "waiting";
  return (
    <View
      style={[
        s.pill,
        isRunning && { backgroundColor: C.red, borderColor: C.red },
        isStopped && { backgroundColor: C.ink, borderColor: C.ink },
        isWaiting && { backgroundColor: C.dark, borderColor: C.dark },
      ]}
    >
      <Text
        style={[
          s.pillTxt,
          isRunning && { color: C.white },
          isStopped && { color: C.white },
          isWaiting && { color: C.inactive },
        ]}
      >
        {isRunning
          ? "● RUN"
          : isStopped
          ? "■ STOP"
          : isWaiting
          ? "◌ WAIT"
          : "READY"}
      </Text>
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

// Small ON/OFF switch styled like the device pills
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
    <Pressable
      onPress={onToggle}
      accessible
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={[s.cueSwitch, on && s.cueSwitchOn]}
    >
      <Text style={[s.cueSwitchText, on && s.cueSwitchTextOn]}>
        {on ? "ON" : "OFF"}
      </Text>
    </Pressable>
  );
}

// Settings panel: sound cue toggles + target time (mm:ss)
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
    <View style={s.cuePanel}>
      <View style={s.cueRow}>
        <Text style={s.cueLabel}>SOUND CUES · START / STOP / LAP</Text>
        <CueSwitch
          on={settings.soundEnabled}
          label="Sound cues on start, stop, and lap"
          onToggle={() => onChange({ soundEnabled: !settings.soundEnabled })}
        />
      </View>
      <View style={s.cueRow}>
        <Text style={s.cueLabel}>TARGET-TIME BEEP</Text>
        <CueSwitch
          on={settings.targetEnabled}
          label="Beep once at target time"
          onToggle={() => onChange({ targetEnabled: !settings.targetEnabled })}
        />
      </View>
      {settings.targetEnabled && (
        <View style={[s.cueRow, { borderBottomWidth: 0 }]}>
          <Text style={s.cueLabel}>TARGET (MM:SS)</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <TextInput
              value={mm}
              onChangeText={(t) => {
                const clean = t.replace(/[^0-9]/g, "").slice(0, 3);
                setMm(clean);
                commitTarget(clean, ss);
              }}
              keyboardType="number-pad"
              style={s.cueInput}
              accessibilityLabel="Target minutes"
              maxLength={3}
            />
            <Text style={s.cueColon}>:</Text>
            <TextInput
              value={ss}
              onChangeText={(t) => {
                const clean = t.replace(/[^0-9]/g, "").slice(0, 2);
                setSs(clean);
                commitTarget(mm, clean);
              }}
              keyboardType="number-pad"
              style={s.cueInput}
              accessibilityLabel="Target seconds"
              maxLength={2}
            />
          </View>
        </View>
      )}
      <Text style={s.cueHint}>
        The stopwatch keeps running past the target — the overrun is shown in
        red. Cues are best-effort while the app is in the background.
      </Text>
    </View>
  );
}

// Red overrun strip shown once elapsed time passes the target
function TargetOverrunStrip({
  elapsedMs,
  targetMs,
}: {
  elapsedMs: number;
  targetMs: number;
}) {
  if (elapsedMs < targetMs) return null;
  return (
    <View
      style={s.targetOverrun}
      accessible
      accessibilityLabel={`Past target by ${fmtCompact(elapsedMs - targetMs)}`}
    >
      <Text style={s.targetOverrunLabel}>TARGET {fmtCompact(targetMs)}</Text>
      <Text style={s.targetOverrunTime}>+{fmtCompact(elapsedMs - targetMs)}</Text>
    </View>
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

// ♪ toggle button for the casing bar
function CueBarButton({
  active,
  onPress,
}: {
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Sound settings"
      hitSlop={8}
      style={s.cueBtn}
    >
      <Text style={[s.cueBtnText, active && { color: C.yellow }]}>♪</Text>
    </Pressable>
  );
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
      <SafeAreaView style={s.screen}>
        <StatusBar barStyle="light-content" backgroundColor={C.casing} />
        <CasingBar title="STOPWATCH" />
        <View style={{ flex: 1, justifyContent: "center", padding: 20 }}>
          <Text style={s.screenTitle}>Solo mode only</Text>
          <Text style={[s.mutedText, { marginBottom: 28 }]}>
            Shared timing sessions aren&apos;t configured for this build. You
            can still use the solo stopwatch.
          </Text>
          <Pressable onPress={onSolo} style={s.primaryBtn}>
            <Text style={s.primaryBtnText}>CONTINUE SOLO</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />
      <CasingBar title="SIGN IN" />

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.screenTitle}>Session Creator</Text>
        <Text style={[s.mutedText, { marginBottom: 28 }]}>
          Sign in to create and manage shared timing sessions. Joining a session
          requires no account.
        </Text>

        <Pressable
          onPress={handleGoogleSignIn}
          disabled={googleLoading || loading}
          style={({ pressed }) => [
            s.googleBtn,
            { opacity: pressed || googleLoading || loading ? 0.7 : 1 },
          ]}
        >
          {googleLoading ? (
            <ActivityIndicator color={C.ink} />
          ) : (
            <Text style={s.googleBtnText}>Continue with Google</Text>
          )}
        </Pressable>

        <View style={s.dividerRow}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>OR</Text>
          <View style={s.dividerLine} />
        </View>

        <LabeledInput
          label="EMAIL"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
        />
        <LabeledInput
          label="PASSWORD"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
        />

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          onPress={handleSignIn}
          disabled={loading}
          style={({ pressed }) => [
            s.primaryBtn,
            { opacity: pressed || loading ? 0.7 : 1 },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={C.white} />
          ) : (
            <Text style={s.primaryBtnText}>SIGN IN</Text>
          )}
        </Pressable>

        <Pressable onPress={onSolo} style={s.ghostBtn}>
          <Text style={s.ghostBtnText}>Use without account →</Text>
        </Pressable>

        <Pressable
          onPress={() => ExpoLinking.openURL("https://splitsync.org/help")}
          style={[s.ghostBtn, { marginTop: 8 }]}
        >
          <Text style={[s.ghostBtnText, { color: C.muted, fontSize: 12 }]}>
            ℹ  Help &amp; about
          </Text>
        </Pressable>

        <Pressable
          onPress={() => ExpoLinking.openURL("https://splitsync.org/privacy")}
          style={[s.ghostBtn, { marginTop: 4 }]}
        >
          <Text style={[s.ghostBtnText, { color: C.muted, fontSize: 11 }]}>
            Privacy Policy
          </Text>
        </Pressable>
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
  const [sessions, setSessions] = useState<CasualSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    const { data } = await supabase
      .from("casual_sessions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setSessions(data as CasualSession[]);
    setLoading(false);
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

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />
      <CasingBar title="STOPWATCH" />

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={[s.screenTitle, { marginBottom: 4 }]}>{greeting}</Text>
        <Text style={[s.mutedText, { marginBottom: 24 }]}>
          Create a shared timing session or go solo.
        </Text>

        {/* Primary actions */}
        <Pressable
          onPress={onNewSession}
          style={({ pressed }) => [
            s.primaryBtn,
            { marginBottom: 10, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={s.primaryBtnText}>+ NEW SESSION</Text>
        </Pressable>

        <Pressable
          onPress={onSolo}
          style={({ pressed }) => [
            s.secondaryBtn,
            { marginBottom: 28, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={s.secondaryBtnText}>⏱  Solo Stopwatch</Text>
        </Pressable>

        {/* Session history */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>MY SESSIONS</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={C.red} style={{ marginTop: 24 }} />
        ) : sessions.length === 0 ? (
          <Text style={[s.mutedText, { marginTop: 16, textAlign: "center" }]}>
            No sessions yet. Create one above.
          </Text>
        ) : (
          sessions.map((session) => (
            <Pressable
              key={session.id}
              onPress={() => handleRejoin(session)}
              style={({ pressed }) => [
                s.sessionRow,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.sessionName} numberOfLines={1}>
                  {session.name || "Untitled Session"}
                </Text>
                <Text style={[s.mutedText, { fontSize: 11, marginTop: 2 }]}>
                  {fmtAge(session.created_at)} · Code{" "}
                  <Text style={{ color: C.ink, fontWeight: "700" }}>
                    {session.code}
                  </Text>
                </Text>
              </View>
              <View
                style={[
                  s.statusBadge,
                  session.status === "running" && { backgroundColor: C.red },
                  session.status === "stopped" && { backgroundColor: C.ink },
                  session.status === "waiting" && {
                    backgroundColor: C.dimGray,
                  },
                ]}
              >
                <Text style={s.statusBadgeText}>
                  {session.status.toUpperCase()}
                </Text>
              </View>
            </Pressable>
          ))
        )}

        {/* Sign out */}
        <Pressable
          onPress={onSignOut}
          style={({ pressed }) => [
            s.ghostBtn,
            { marginTop: 32, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[s.ghostBtnText, { color: C.muted }]}>Sign Out</Text>
        </Pressable>

        {/* Help */}
        <Pressable
          onPress={() => ExpoLinking.openURL("https://splitsync.org/help")}
          style={({ pressed }) => [
            s.ghostBtn,
            { marginTop: 4, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[s.ghostBtnText, { color: C.muted, fontSize: 12 }]}>
            ℹ  Help &amp; about
          </Text>
        </Pressable>
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

        <LabeledInput
          label="SESSION NAME"
          value={sessionName}
          onChangeText={setSessionName}
          placeholder="e.g. Tuesday Hill Climb"
          autoCapitalize="words"
        />
        <LabeledInput
          label="YOUR DISPLAY NAME"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="e.g. Coach Alex"
          autoCapitalize="words"
        />

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          onPress={handleCreate}
          disabled={loading}
          style={({ pressed }) => [
            s.primaryBtn,
            { opacity: pressed || loading ? 0.7 : 1 },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={C.white} />
          ) : (
            <Text style={s.primaryBtnText}>START SESSION</Text>
          )}
        </Pressable>
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

        <LabeledInput
          label="SESSION CODE"
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="AB3K9X"
          autoCapitalize="characters"
        />
        <LabeledInput
          label="YOUR DISPLAY NAME"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="e.g. Jamie"
          autoCapitalize="words"
        />

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          onPress={handleJoin}
          disabled={loading}
          style={({ pressed }) => [
            s.primaryBtn,
            { opacity: pressed || loading ? 0.7 : 1 },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={C.white} />
          ) : (
            <Text style={s.primaryBtnText}>JOIN</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => onView(code.trim().toUpperCase())}
          disabled={code.trim().length !== 6}
          style={({ pressed }) => [
            s.outlineBtn,
            { marginTop: 12, opacity: pressed || code.trim().length !== 6 ? 0.7 : 1 },
          ]}
        >
          <Text style={s.outlineBtnText}>VIEW ONLY</Text>
        </Pressable>
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

      if (ev.event_type === "start" && ev.t0_server) {
        setT0Server(ev.t0_server);
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
  }, [params.sessionId, params.participantId, startTick, stopTick]);

  // ── Durable queue flush ──────────────────────────────────────────────────────
  // Called on mount and on channel reconnect. Reconciles the durable queue
  // against server state, drops events the server already accepted, then
  // replays the rest in local-sequence order (preserving original timestamps).
  const flushDurableQueue = useCallback(async () => {
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
          incoming.forEach(applyEvent);
        }
      )
      .subscribe((subscribeStatus) => {
        if (subscribeStatus === "SUBSCRIBED") {
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
        } else if (subscribeStatus === "CHANNEL_ERROR") {
          rebuildFromServer().then(() => flushDurableQueue());
        }
      });

    channelRef.current = channel;

    return () => {
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
    [params.sessionId, params.participantId, params.sessionCode, applyEvent, rebuildFromServer]
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
  // Pending indicator: show spinner whenever there are unacknowledged events,
  // whether inflight (pendingQueue) or queued for replay (durableQueueDepth).
  const pendingCount = Math.max(pendingQueue.length, durableQueueDepth);

  // Current lap elapsed (time since last lap event or since start)
  const lastLapCumMs = laps[0]?.cumulativeMs ?? 0;
  const currentLapMs = isRunning ? Math.max(0, elapsedMs - lastLapCumMs) : 0;

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />

      {/* ── Casing top ── */}
      <View style={s.casing}>
        <View style={s.casingLeft}>
          <Pressable onPress={onBack} hitSlop={8} style={s.iconBtn}>
            <Text style={{ color: C.faint, fontSize: 20 }}>‹</Text>
          </Pressable>
          <Text style={s.casingTitle} numberOfLines={1}>
            {params.sessionName.toUpperCase().slice(0, 16)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          {pendingCount > 0 && (
            <ActivityIndicator size="small" color={C.yellow} />
          )}
          {/* Lock toggle: tap to lock, double-tap to unlock.
              Red pill when locked — impossible to miss. */}
          <Pressable
            onPress={handleLockTap}
            hitSlop={8}
            style={[s.lockPill, isLocked && s.lockPillLocked]}
            accessibilityLabel={isLocked ? "Controls locked — double-tap to unlock" : "Tap to lock controls"}
            accessibilityRole="button"
          >
            <Text style={[s.lockPillText, isLocked && s.lockPillTextLocked]}>
              {isLocked ? "🔒 LOCKED" : "🔓 LOCK"}
            </Text>
          </Pressable>
          <VolumeKeyToggle enabled={volumeKeysEnabled} onToggle={toggleVolumeKeys} />
          <CueBarButton
            active={cueSettings.soundEnabled || cueSettings.targetEnabled}
            onPress={() => setShowCuePanel((v) => !v)}
          />
          <StatusPill status={status} />
        </View>
      </View>

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
              <FlatList
                data={laps}
                keyExtractor={(l) => String(l.lapNum)}
                style={{ flex: 1 }}
                ListHeaderComponent={
                  showSessionStats ? (
                    <LapTrendChart
                      laps={[...laps].reverse()}
                      bestMs={bestMs!}
                      worstMs={worstMs!}
                      getLapMs={(l) => l.splitMs}
                      getLapNum={(l) => l.lapNum}
                    />
                  ) : null
                }
                renderItem={({ item }) => {
                  const isBest = bestMs !== null && item.splitMs === bestMs;
                  return (
                    <View style={[s.tableRow, isBest && s.rowBest]}>
                      <Text style={[s.td, s.cLap, { color: C.muted }]}>
                        {item.lapNum}
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
                      <Text
                        style={[s.td, s.cActor, { color: C.muted }]}
                        numberOfLines={1}
                      >
                        {item.actorName}
                      </Text>
                    </View>
                  );
                }}
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
          <FlatList
            data={laps}
            keyExtractor={(l) => String(l.lapNum)}
            style={{ flex: 1 }}
            ListHeaderComponent={
              showSessionStats ? (
                <LapTrendChart
                  laps={[...laps].reverse()}
                  bestMs={bestMs!}
                  worstMs={worstMs!}
                  getLapMs={(l) => l.splitMs}
                  getLapNum={(l) => l.lapNum}
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
                    {item.lapNum}
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
                  <Text
                    style={[s.td, s.cActor, { color: C.muted }]}
                    numberOfLines={1}
                  >
                    {item.actorName}
                    {delta !== null ? ` ${fmtDelta(delta)}` : ""}
                  </Text>
                </View>
              );
            }}
          />
        </View>
      ) : (
        <View style={s.together}>
          <Text style={s.mutedText}>
            {isWaiting
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
            label={isStopped ? "STOPPED" : "START"}
            body={C.btnBlueBody}
            hi={C.btnBlueHi}
            lo={C.btnBlueLo}
            textColor={C.ink}
            disabled={isStopped}
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
            disabled={!params.isOwner || isWaiting}
            onPress={handleReset}
          />
        </View>
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

function ModeToggleStrip({
  mode,
  onSelect,
}: {
  mode: SoloMode;
  onSelect: (m: SoloMode) => void;
}) {
  return (
    <View style={s.delaySelector}>
      <Text style={s.delayLabel}>MODE</Text>
      <View style={s.delayOptions}>
        {(["stopwatch", "timer"] as SoloMode[]).map((m) => (
          <Pressable
            key={m}
            onPress={() => onSelect(m)}
            style={[s.delayOption, mode === m && s.delayOptionActive]}
            accessible
            accessibilityRole="radio"
            accessibilityLabel={
              m === "stopwatch" ? "Stopwatch mode" : "Countdown timer mode"
            }
            accessibilityState={{ selected: mode === m }}
          >
            <Text
              style={[
                s.delayOptionText,
                mode === m && s.delayOptionTextActive,
              ]}
            >
              {m === "stopwatch" ? "STOPWATCH" : "TIMER"}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SoloScreen({
  fontsLoaded,
  onBack,
  onSelectMode,
  onGoShared,
}: {
  fontsLoaded: boolean;
  onBack: () => void;
  onSelectMode: (m: SoloMode) => void;
  onGoShared: () => void;
}) {
  useKeepAwake();
  const { width, height } = useWindowDimensions();

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
    const data: PersistedSolo = {
      state,
      accumMs: accum.current,
      anchorWall: state === "running" ? anchor.current : null,
      lastLapCumMs: lastLapCum.current,
      laps: lapsRef.current,
    };
    AsyncStorage.setItem(SOLO_STORAGE_KEY, JSON.stringify(data)).catch(
      () => {}
    );
  }, []);

  const clearPersistedSolo = useCallback(() => {
    AsyncStorage.removeItem(SOLO_STORAGE_KEY).catch(() => {});
  }, []);

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
    AsyncStorage.getItem(SOLO_STORAGE_KEY)
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

      {/* ── Device top casing ── */}
      <View style={s.casing}>
        <View style={s.casingLeft}>
          <Pressable onPress={onBack} hitSlop={8} style={s.iconBtn}>
            <Text style={{ color: C.faint, fontSize: 20 }}>‹</Text>
          </Pressable>
          <Text style={s.casingTitle}>STOPWATCH</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          {/* Lock toggle: tap to lock, double-tap to unlock.
              Red pill when locked — impossible to miss. */}
          <Pressable
            onPress={handleLockTap}
            hitSlop={8}
            style={[s.lockPill, isLocked && s.lockPillLocked]}
            accessibilityLabel={isLocked ? "Controls locked — double-tap to unlock" : "Tap to lock controls"}
            accessibilityRole="button"
          >
            <Text style={[s.lockPillText, isLocked && s.lockPillTextLocked]}>
              {isLocked ? "🔒 LOCKED" : "🔓 LOCK"}
            </Text>
          </Pressable>
          <VolumeKeyToggle enabled={volumeKeysEnabled} onToggle={toggleVolumeKeys} />
          <CueBarButton
            active={cueSettings.soundEnabled || cueSettings.targetEnabled}
            onPress={() => setShowCuePanel((v) => !v)}
          />
          <View
            style={[
              s.pill,
              isRunning   && { backgroundColor: C.red,    borderColor: C.red },
              isPaused    && { backgroundColor: C.yellow, borderColor: C.yellow },
              isCountdown && { backgroundColor: C.red,    borderColor: C.red },
            ]}
          >
            <Text
              style={[
                s.pillTxt,
                isRunning   && { color: C.white },
                isPaused    && { color: C.ink },
                isCountdown && { color: C.white },
              ]}
            >
              {isRunning   ? "● RUN"
               : isPaused  ? "‖ PAUSED"
               : isCountdown ? `◷ ${countdownSec}`
               : "READY"}
            </Text>
          </View>
        </View>
      </View>

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

      {/* ── Lap table ── */}
      {lapCount > 0 && !isCountdown ? (
        <View style={s.table}>
          <View style={s.tableHead}>
            <Text style={[s.th, s.cLap]}>LAP</Text>
            <Text style={[s.th, s.cSplit]}>SPLIT</Text>
            <Text style={[s.th, s.cTime]}>TIME</Text>
            <Text style={[s.th, s.cDelta, { textAlign: "right" }]}>Δ BEST</Text>
          </View>
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
        </View>
      ) : !isCountdown ? (
        <View style={s.together}>
          <Pressable
            onPress={onGoShared}
            style={({ pressed }) => [
              s.togetherBtn,
              { opacity: pressed ? 0.8 : 1 },
            ]}
            accessible
            accessibilityRole="button"
            accessibilityLabel="Time together"
          >
            <Text style={s.togetherLabel}>⏱  TIME TOGETHER</Text>
            <Text style={s.togetherSub}>TAP TO CREATE A SHARED SESSION</Text>
          </Pressable>
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
}: {
  fontsLoaded: boolean;
  onBack: () => void;
  onSelectMode: (m: SoloMode) => void;
}) {
  useKeepAwake();
  const { width, height } = useWindowDimensions();

  type TimerState = "idle" | "running" | "paused" | "alerting";

  const [timerState, setTimerState] = useState<TimerState>("idle");
  const [durationMs, setDurationMs] = useState(TIMER_DEFAULT_DURATION_MS);
  const [remainingMs, setRemainingMs] = useState(TIMER_DEFAULT_DURATION_MS);
  const [finishedWhileAway, setFinishedWhileAway] = useState(false);

  // Duration inputs (H : MM : SS)
  const [hh, setHh] = useState("0");
  const [mm, setMm] = useState("05");
  const [ss, setSs] = useState("00");

  // Timing refs — wall-clock anchors, never accumulated intervals
  const endAtWallRef = useRef<number | null>(null);
  const remainingRef = useRef<number>(TIMER_DEFAULT_DURATION_MS);
  const durationRef = useRef<number>(TIMER_DEFAULT_DURATION_MS);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const alarmCountRef = useRef(0);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  // Sound cues (#227) — completion alarm respects the shared soundEnabled flag
  const { cueSettings, cueRef, updateCueSettings } = useCueSettings();

  const setDurationInputsFromMs = useCallback((ms: number) => {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    setHh(String(Math.floor(totalSeconds / 3600)));
    setMm(p2(Math.floor((totalSeconds % 3600) / 60)));
    setSs(p2(totalSeconds % 60));
  }, []);

  const applyDuration = useCallback((ms: number) => {
    durationRef.current = ms;
    remainingRef.current = ms;
    setDurationMs(ms);
    setRemainingMs(ms);
  }, []);

  const persistTimer = useCallback((state: "running" | "paused") => {
    const data: PersistedTimer = {
      state,
      durationMs: durationRef.current,
      endAtWall: state === "running" ? endAtWallRef.current : null,
      remainingMs: state === "paused" ? remainingRef.current : null,
    };
    AsyncStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(data)).catch(
      () => undefined
    );
  }, []);

  const clearPersistedTimer = useCallback(() => {
    AsyncStorage.removeItem(TIMER_STORAGE_KEY).catch(() => undefined);
  }, []);

  // ── Alarm — finite repeats, single tap dismisses ────────────────────────────
  const stopAlarm = useCallback(() => {
    if (alarmTimerRef.current !== null) {
      clearInterval(alarmTimerRef.current);
      alarmTimerRef.current = null;
    }
    alarmCountRef.current = 0;
  }, []);

  const fireAlarmPulse = useCallback(() => {
    // Haptic always — vibrate-only is the completion signal with sound off.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
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
    // Auto-reset to the ORIGINAL duration — ready to restart with one tap.
    remainingRef.current = durationRef.current;
    setRemainingMs(durationRef.current);
    setTimerState("alerting");
    clearPersistedTimer();
    startAlarm();
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
    Promise.all([
      AsyncStorage.getItem(TIMER_DURATION_STORAGE_KEY),
      AsyncStorage.getItem(TIMER_STORAGE_KEY),
    ])
      .then(([rawDuration, rawTimer]) => {
        if (cancelled) return;

        const parsedDuration = rawDuration !== null ? Number(rawDuration) : NaN;
        if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
          applyDuration(parsedDuration);
          setDurationInputsFromMs(parsedDuration);
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

  const handleStart = useCallback(() => {
    if (durationRef.current <= 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFinishedWhileAway(false);
    stopAlarm();
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

      {/* ── Device top casing ── */}
      <View style={s.casing}>
        <View style={s.casingLeft}>
          <Pressable onPress={onBack} hitSlop={8} style={s.iconBtn}>
            <Text style={{ color: C.faint, fontSize: 20 }}>‹</Text>
          </Pressable>
          <Text style={s.casingTitle}>TIMER</Text>
        </View>
        <View
          style={[
            s.pill,
            isRunning && { backgroundColor: C.red, borderColor: C.red },
            isPaused && { backgroundColor: C.yellow, borderColor: C.yellow },
            isAlerting && { backgroundColor: C.red, borderColor: C.red },
          ]}
        >
          <Text
            style={[
              s.pillTxt,
              isRunning && { color: C.white },
              isPaused && { color: C.ink },
              isAlerting && { color: C.white },
            ]}
          >
            {isRunning
              ? "▼ RUN"
              : isPaused
              ? "‖ PAUSED"
              : isAlerting
              ? "◉ DONE"
              : "READY"}
          </Text>
        </View>
      </View>

      {/* ── LCD instrument panel — remaining time ── */}
      <View style={s.instrument}>
        <View style={s.instrHeader}>
          <Text style={s.instrLabel}>
            {isAlerting ? "TIME'S UP" : "TIME REMAINING"}
          </Text>
          <Text style={s.instrLabel}>
            SET {fmtParts(durationMs).main}
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

      {/* ── Duration inputs (idle only) ── */}
      {isIdle && (
        <View style={s.cuePanel}>
          <View style={[s.cueRow, { borderBottomWidth: 0 }]}>
            <Text style={s.cueLabel}>DURATION (H : MM : SS)</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <TextInput
                value={hh}
                onChangeText={(t) => {
                  const clean = t.replace(/[^0-9]/g, "").slice(0, 2);
                  setHh(clean);
                  commitDurationInputs(clean, mm, ss);
                }}
                keyboardType="number-pad"
                style={s.cueInput}
                accessibilityLabel="Timer hours"
                maxLength={2}
              />
              <Text style={s.cueColon}>:</Text>
              <TextInput
                value={mm}
                onChangeText={(t) => {
                  const clean = t.replace(/[^0-9]/g, "").slice(0, 2);
                  setMm(clean);
                  commitDurationInputs(hh, clean, ss);
                }}
                keyboardType="number-pad"
                style={s.cueInput}
                accessibilityLabel="Timer minutes"
                maxLength={2}
              />
              <Text style={s.cueColon}>:</Text>
              <TextInput
                value={ss}
                onChangeText={(t) => {
                  const clean = t.replace(/[^0-9]/g, "").slice(0, 2);
                  setSs(clean);
                  commitDurationInputs(hh, mm, clean);
                }}
                keyboardType="number-pad"
                style={s.cueInput}
                accessibilityLabel="Timer seconds"
                maxLength={2}
              />
            </View>
          </View>
          <View style={[s.cueRow, { borderBottomWidth: 0 }]}>
            <Text style={s.cueLabel}>SOUND ON COMPLETION</Text>
            <CueSwitch
              on={cueSettings.soundEnabled}
              label="Sound on timer completion"
              onToggle={() =>
                updateCueSettings({ soundEnabled: !cueSettings.soundEnabled })
              }
            />
          </View>
          <Text style={s.cueHint}>
            On completion the timer resets to the set value, ready to restart
            with one tap. The alert repeats a few times, then goes quiet — one
            tap dismisses it. Sound off = vibrate only.
          </Text>
        </View>
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

// ── Solo container: routes between stopwatch and timer modes (#232) ───────────
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

  useEffect(() => {
    AsyncStorage.getItem(SOLO_MODE_STORAGE_KEY)
      .then((v) => {
        if (v === "timer" || v === "stopwatch") setMode(v);
        setModeLoaded(true);
      })
      .catch(() => setModeLoaded(true));
  }, []);

  const handleSelectMode = useCallback((m: SoloMode) => {
    setMode(m);
    AsyncStorage.setItem(SOLO_MODE_STORAGE_KEY, m).catch(() => undefined);
  }, []);

  if (!modeLoaded) return <LoadingScreen />;

  return mode === "timer" ? (
    <TimerScreen
      fontsLoaded={fontsLoaded}
      onBack={onBack}
      onSelectMode={handleSelectMode}
    />
  ) : (
    <SoloScreen
      fontsLoaded={fontsLoaded}
      onBack={onBack}
      onSelectMode={handleSelectMode}
      onGoShared={onGoShared}
    />
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
      <RootNavigator />
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
  pill: {
    borderWidth: 1.5,
    borderColor: C.dark,
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  pillTxt: { color: C.casingMuted, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },

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

  // Solo — time together placeholder
  together: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
  togetherBtn: {
    borderWidth: 1.5,
    borderColor: C.line,
    borderStyle: "dashed",
    borderRadius: 2,
    paddingVertical: 22,
    alignItems: "center",
    opacity: 0.45,
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

  // Icon-only button — shared 44×44 pt touch target
  iconBtn: {
    width: ICON_BTN_SIZE,
    height: ICON_BTN_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },

  // Lock pill — replaces the single-emoji iconBtn for better visibility (#340)
  lockPill: {
    height: ICON_BTN_SIZE,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: C.dimGray,
    alignItems: "center",
    justifyContent: "center",
  },
  lockPillLocked: {
    borderColor: C.red,
    backgroundColor: C.red,
  },
  lockPillText: {
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 0.8,
    color: C.dimGray,
  },
  lockPillTextLocked: {
    color: C.white,
  },

  // Logo footer — subtle centered brand element on control-dense screens
  logoFooter: {
    alignItems: "center",
    paddingVertical: 5,
    backgroundColor: C.casing,
    borderTopWidth: 1,
    borderColor: C.casingBorder,
  },

  // Sound cues (#227)
  cueBtn: {
    width: ICON_BTN_SIZE,
    height: ICON_BTN_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  cueBtnText: { color: C.casingMuted, fontSize: 26, fontWeight: "900" },
  cuePanel: {
    backgroundColor: C.panelBg,
    borderBottomWidth: 2,
    borderColor: C.rule,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
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
  cueSwitch: {
    borderWidth: 1.5,
    borderColor: C.muted,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    minWidth: 52,
    alignItems: "center",
  },
  cueSwitchOn: { backgroundColor: C.red, borderColor: C.red },
  cueSwitchText: {
    color: C.muted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  cueSwitchTextOn: { color: C.white },
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
});
