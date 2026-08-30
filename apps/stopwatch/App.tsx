/**
 * SplitSync Stopwatch
 *
 * Screens (state-machine navigation):
 *   loading  → check auth session
 *   login    → email/password sign-in (no signup; accounts via web)
 *   home     → My Sessions + New Session + Solo option
 *   create   → name session + display name → creates session → session
 *   join     → display name prompt after deep-link lands
 *   session  → shared stopwatch (creator or joiner)
 *   solo     → existing standalone stopwatch (no auth required)
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
import * as ExpoLinking from "expo-linking";
import { useFonts } from "expo-font";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./src/supabase";

// ── Palette ────────────────────────────────────────────────────────────────────
const C = {
  casing:       "#1A1A1A",
  casingBorder: "#0A0A0A",
  instrument:   "#0D0D0D",
  lcd:          "#5BC8F5",
  lcdDim:       "#00213A",
  lcdSmall:     "#FFFFFF",
  paper:        "#F5F0E8",
  white:        "#FFFFFF",
  ink:          "#1A1A1A",
  rule:         "#1A1A1A",
  line:         "#D4D0C8",
  panelBg:      "#EDEAE0",
  muted:        "#888880",
  red:          "#CC0000",
  yellow:       "#FFD700",
  yellowBg:     "rgba(255,215,0,0.20)",
  yellowDark:   "#7A5C00",
  green:        "#007A30",
  worse:        "#CC3300",
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
  btnBlueBody:  "#5BC8F5",
  btnBlueHi:    "#8DDBFB",
  btnBlueLo:    "#2E86C1",
};

// ── Domain types ───────────────────────────────────────────────────────────────
type AppScreen =
  | "loading"
  | "login"
  | "home"
  | "create"
  | "join"
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

function extractCodeFromUrl(url: string): string | null {
  // Handles:
  //   https://splitsync.org/stopwatch/s/<code>
  //   org.splitsync.stopwatch://s/<code>
  const m = url.match(/\/s\/([A-Z2-9]{6})(?:[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
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
  const txt = disabled ? "#444444" : textColor;

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
            shadowColor: "#000",
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
                  ? "#888"
                  : disabled
                  ? "#333"
                  : "rgba(255,255,255,0.5)",
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
        isWaiting && { backgroundColor: "#333", borderColor: "#333" },
      ]}
    >
      <Text
        style={[
          s.pillTxt,
          isRunning && { color: C.white },
          isStopped && { color: C.white },
          isWaiting && { color: "#999" },
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
                    backgroundColor: "#555",
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
  onBack,
}: {
  pendingCode: string | null;
  onJoined: (params: SessionNavParams) => void;
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
      </ScrollView>
    </SafeAreaView>
  );
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
  } catch {
    // Non-fatal: in-memory optimistic queue still handles the current run.
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
  const { width } = useWindowDimensions();

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

  // Best lap (among laps)
  const bestMs = useMemo(
    () =>
      laps.length < 2
        ? null
        : Math.min(...laps.map((l) => l.splitMs)),
    [laps]
  );

  // ── Clock tick ──────────────────────────────────────────────────────────────
  const startTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (clientT0Ref.current !== null) {
        setElapsedMs(Date.now() - clientT0Ref.current);
      }
    }, 30);
  }, []);

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
        setStatus("running");
        startTick();
      } else if (ev.event_type === "stop") {
        setStatus("stopped");
        stopTick();
      } else if (ev.event_type === "reset") {
        setT0Server(null);
        clientT0Ref.current = null;
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
    async (eventType: SessionEventType) => {
      const clientEventId = generateUUID();
      const clientRecordedAt = new Date().toISOString();
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

  // ── Button handlers ─────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await sendEvent("start");
  }, [sendEvent]);

  const handleStop = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await sendEvent("stop");
  }, [sendEvent]);

  const handleLap = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await sendEvent("lap");
  }, [sendEvent]);

  const handleReset = useCallback(async () => {
    if (!params.isOwner) {
      Alert.alert("Owner only", "Only the session creator can reset.");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await sendEvent("reset");
  }, [params.isOwner, sendEvent]);

  const handleShare = useCallback(async () => {
    const url = `https://splitsync.org/stopwatch/s/${params.sessionCode}`;
    await Share.share({ message: `Join my SplitSync session: ${url}`, url });
  }, [params.sessionCode]);

  // ── Render ──────────────────────────────────────────────────────────────────
  const lcdMain = Math.min(Math.floor((width - 40) / 7.2), 72);
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
          <Pressable onPress={onBack} style={{ marginRight: 8 }}>
            <Text style={{ color: "#888", fontSize: 20 }}>‹</Text>
          </Pressable>
          <View style={s.logoChip}>
            <Text style={s.logoSplit}>SPLIT</Text>
            <Text style={s.logoSync}>SYNC</Text>
          </View>
          <Text style={s.casingTitle} numberOfLines={1}>
            {params.sessionName.toUpperCase().slice(0, 16)}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {pendingCount > 0 && (
            <ActivityIndicator size="small" color={C.yellow} />
          )}
          <StatusPill status={status} />
        </View>
      </View>

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
            dimColor="#222222"
            fontLoaded={fontsLoaded}
          />
        </View>
      </View>

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
              onPress={handleShare}
              style={({ pressed }) => [
                s.secondaryBtn,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={s.secondaryBtnText}>Share Result</Text>
            </Pressable>
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
          <DeviceBtn
            label="STOP"
            body={C.btnRedBody}
            hi={C.btnRedHi}
            lo={C.btnRedLo}
            onPress={handleStop}
            flex={1.4}
          />
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
        <DeviceBtn
          label="RESET"
          body={C.btnPaperBody}
          hi={C.btnPaperHi}
          lo={C.btnPaperLo}
          textColor={C.ink}
          disabled={!params.isOwner || isWaiting}
          onPress={handleReset}
        />
      </View>
    </SafeAreaView>
  );
}

// ── Screen: Solo (existing standalone stopwatch) ───────────────────────────────
function SoloScreen({
  fontsLoaded,
  onBack,
}: {
  fontsLoaded: boolean;
  onBack: () => void;
}) {
  useKeepAwake();
  const { width } = useWindowDimensions();

  type SwState = "idle" | "running" | "paused";

  const [swState, setSw] = useState<SwState>("idle");
  const [sessionMs, setSession] = useState(0);
  const [lapMs, setLapMs] = useState(0);
  const [laps, setLaps] = useState<
    { number: number; splitMs: number; cumulativeMs: number }[]
  >([]);

  const anchor = useRef<number | null>(null);
  const accum = useRef(0);
  const lastLapCum = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appState = useRef<AppStateStatus>(AppState.currentState);

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
        setSession(t);
        setLapMs(t - lastLapCum.current);
      }
    }, 30);
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => () => stopTick(), [stopTick]);

  const handleStart = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    anchor.current = Date.now();
    startTick();
    setSw("running");
  }, [startTick]);

  const handleStop = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (anchor.current !== null) {
      accum.current += Date.now() - anchor.current;
      anchor.current = null;
    }
    stopTick();
    setSession(accum.current);
    setLapMs(accum.current - lastLapCum.current);
    setSw("paused");
  }, [stopTick]);

  const handleLap = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const now = Date.now();
    const cum =
      accum.current + (anchor.current !== null ? now - anchor.current : 0);
    const split = cum - lastLapCum.current;
    lastLapCum.current = cum;
    setLapMs(0);
    setLaps((prev) => [
      { number: prev.length + 1, splitMs: split, cumulativeMs: cum },
      ...prev,
    ]);
  }, []);

  const handleReset = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    stopTick();
    anchor.current = null;
    accum.current = 0;
    lastLapCum.current = 0;
    setSession(0);
    setLapMs(0);
    setLaps([]);
    setSw("idle");
  }, [stopTick]);

  const isRunning = swState === "running";
  const isPaused = swState === "paused";
  const isIdle = swState === "idle";
  const lapCount = laps.length;
  const lastLap = laps[0] ?? null;
  const bestMs = useMemo(
    () =>
      laps.length < 2 ? null : Math.min(...laps.map((l) => l.splitMs)),
    [laps]
  );
  const lcdMain = Math.min(Math.floor((width - 40) / 7.2), 72);

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar barStyle="light-content" backgroundColor={C.casing} />

      {/* ── Device top casing ── */}
      <View style={s.casing}>
        <View style={s.casingLeft}>
          <Pressable onPress={onBack} style={{ marginRight: 8 }}>
            <Text style={{ color: "#888", fontSize: 20 }}>‹</Text>
          </Pressable>
          <View style={s.logoChip}>
            <Text style={s.logoSplit}>SPLIT</Text>
            <Text style={s.logoSync}>SYNC</Text>
          </View>
          <Text style={s.casingTitle}>STOPWATCH</Text>
        </View>
        <View
          style={[
            s.pill,
            isRunning && { backgroundColor: C.red, borderColor: C.red },
            isPaused && { backgroundColor: C.yellow, borderColor: C.yellow },
          ]}
        >
          <Text
            style={[
              s.pillTxt,
              isRunning && { color: C.white },
              isPaused && { color: C.ink },
            ]}
          >
            {isRunning ? "● RUN" : isPaused ? "‖ PAUSED" : "READY"}
          </Text>
        </View>
      </View>

      {/* ── LCD instrument panel ── */}
      <View style={s.instrument}>
        <View style={s.instrHeader}>
          <Text style={s.instrLabel}>
            {isIdle ? "LAP TIME" : `LAP ${lapCount + 1}`}
          </Text>
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
            dimColor="#222222"
            fontLoaded={fontsLoaded}
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
            keyExtractor={(l) => String(l.number)}
            style={{ flex: 1 }}
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
      ) : (
        <View style={s.together}>
          <Pressable
            disabled
            style={s.togetherBtn}
            accessible
            accessibilityLabel="Time together"
          >
            <Text style={s.togetherLabel}>⏱  TIME TOGETHER</Text>
            <Text style={s.togetherSub}>BACK → CREATE A SHARED SESSION</Text>
          </Pressable>
        </View>
      )}

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
          <DeviceBtn
            label="STOP"
            body={C.btnRedBody}
            hi={C.btnRedHi}
            lo={C.btnRedLo}
            onPress={handleStop}
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
        <View style={{ width: 10 }} />
        <DeviceBtn
          label="RESET"
          body={C.btnPaperBody}
          hi={C.btnPaperHi}
          lo={C.btnPaperLo}
          textColor={C.ink}
          disabled={isIdle}
          onPress={handleReset}
        />
      </View>
    </SafeAreaView>
  );
}

// ── Root navigator ─────────────────────────────────────────────────────────────
function RootNavigator() {
  const [fontsLoaded] = useFonts({
    "DSEG7Classic-Regular": require("./assets/fonts/DSEG7Classic-Regular.ttf"),
  });

  const [screen, setScreen] = useState<AppScreen>("loading");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [sessionParams, setSessionParams] = useState<SessionNavParams | null>(null);
  const [joinParams, setJoinParams] = useState<JoinNavParams | null>(null);

  // ── Auth check on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserEmail(session.user.email ?? null);
        setUserName(session.user.user_metadata?.full_name ?? null);
        setScreen("home");
      } else {
        setScreen("login");
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
  useEffect(() => {
    // Initial URL (app was opened from a link)
    ExpoLinking.getInitialURL().then((url) => {
      if (url) {
        const code = extractCodeFromUrl(url);
        if (code) {
          setJoinParams({ code });
          setScreen("join");
        }
      }
    });

    // Subsequent links while app is open
    const sub = ExpoLinking.addEventListener("url", ({ url }) => {
      const code = extractCodeFromUrl(url);
      if (code) {
        setJoinParams({ code });
        setScreen("join");
      }
    });
    return () => sub.remove();
  }, []);

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
      <SoloScreen
        fontsLoaded={!!fontsLoaded}
        onBack={() => setScreen(userEmail ? "home" : "login")}
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
        onBack={() => setScreen(userEmail ? "home" : "login")}
      />
    );
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
    backgroundColor: "#000",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 2,
    gap: 3,
  },
  logoSplit: { color: C.white, fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  logoSync:  { color: C.yellow, fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  casingTitle: { color: "#555550", fontSize: 10, fontWeight: "900", letterSpacing: 3 },
  pill: {
    borderWidth: 1.5,
    borderColor: "#333",
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 3,
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
    flexDirection: "row",
    justifyContent: "space-between",
  },
  instrLabel: { color: "#555550", fontSize: 9, fontWeight: "900", letterSpacing: 2.5 },
  instrMain:  { paddingHorizontal: 20, paddingBottom: 10 },
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

  // Participant strip
  participantStrip: {
    backgroundColor: "#111",
    borderBottomWidth: 1,
    borderColor: "#000",
    maxHeight: 40,
  },
  participantPill: {
    backgroundColor: "#2A2A2A",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#444",
  },
  participantPillSelf: { borderColor: C.lcd, backgroundColor: "#0A2030" },
  participantPillOwner: { borderColor: C.yellow },
  participantPillText: {
    color: "#AAA",
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
    backgroundColor: "#FFF0F0",
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
  ghostBtn: { paddingVertical: 12, alignItems: "center" },
  ghostBtnText: { color: C.red, fontSize: 13, fontWeight: "700", letterSpacing: 0.5 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 2 },
  backBtnText: { color: "#888", fontSize: 13, fontWeight: "700" },

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
    backgroundColor: "#555",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 10,
  },
  statusBadgeText: { color: C.white, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
});
