import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";
import { flushCrossings, getPendingQueue, pendingCrossings, recordCrossing, removePendingCrossing } from "./src/crossingQueue";
import { supabase } from "./src/supabase";
import type { Entry, Event, Race } from "./src/types";

type RecentCrossing = { client_id: string; bib: string; client_recorded_at: string };

WebBrowser.maybeCompleteAuthSession();

const colors = { paper: "#f4f1ea", panel: "#ffffff", ink: "#18181b", muted: "#71717a", red: "#ec1c24", yellow: "#f6d428", line: "#d4d1ca", ttSection: "#f0ece3" };

function sortBibNatural(a: string, b: string): number {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

function formatElapsed(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function Button({ title, onPress, variant = "dark", disabled = false }: { title: string; onPress: () => void; variant?: "dark" | "red" | "yellow" | "outline"; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.button, styles[`button_${variant}`], disabled && styles.disabled]}><Text style={[styles.buttonText, variant === "yellow" || variant === "outline" ? styles.buttonTextDark : undefined]}>{title}</Text></Pressable>;
}

/** Tiny icon mark: two angled bars (ink + yellow) simulated with skewX. */
function Mark({ size = 14 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, overflow: "hidden" }}>
      {/* Yellow right panel (full background) */}
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.yellow }} />
      {/* Ink left panel angled via skewX over the yellow base */}
      <View
        style={{
          position: "absolute",
          left: -(size * 0.4),
          top: 0,
          bottom: 0,
          width: size * 1.05,
          backgroundColor: colors.ink,
          transform: [{ skewX: "-18deg" }],
        }}
      />
    </View>
  );
}

function Logo() {
  return (
    <View style={styles.logo}>
      <View style={[styles.logoSplit, { flexDirection: "row", alignItems: "center", gap: 4 }]}>
        <Mark size={12} />
        <Text style={styles.logoText}>SPLIT</Text>
      </View>
      <View style={styles.logoSync}><Text style={styles.logoTextDark}>SYNC</Text></View>
    </View>
  );
}

function Header({ title, onBack, onSignOut, signedInAs }: { title: string; onBack?: () => void; onSignOut?: () => void; signedInAs?: string | null }) {
  return <><View style={styles.redLine} /><View style={styles.header}><View>{onBack && <Pressable onPress={onBack}><Text style={styles.back}>BACK</Text></Pressable>}<View style={styles.kickerRow}><Logo /><Text style={styles.kicker}>TRACKER</Text></View><Text style={styles.headerTitle}>{title}</Text></View>{onSignOut && <View style={styles.signOutBlock}>{signedInAs && <Text style={styles.signedInAs} numberOfLines={1}>{signedInAs}</Text>}<Pressable onPress={onSignOut}><Text style={styles.back}>SIGN OUT</Text></Pressable></View>}</View></>;
}

function Tracker() {
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRace, setSelectedRace] = useState<Race | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [lapCounts, setLapCounts] = useState<Record<string, number>>({});
  const [lastBib, setLastBib] = useState<string | null>(null);
  const lastBibTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, setPending] = useState(0);
  const [recentCrossings, setRecentCrossings] = useState<RecentCrossing[]>([]);
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const { width } = useWindowDimensions();
  // Mirror web's sm:grid-cols-3 breakpoint: 2 cols on small phones, 3 on medium/large, 4 on tablets
  const numColumns = width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const tileWidth = (width - 40 - (numColumns - 1) * 10) / numColumns;
  const [search, setSearch] = useState("");

  // ── Time trial state ──────────────────────────────────────────────────────
  const runnerStartedAtRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [ttCountdown, setTtCountdown] = useState<number | null>(null);
  const ttCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.bib.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
    );
  }, [entries, search]);

  // ── Time trial derived state ──────────────────────────────────────────────
  const ttQueue = useMemo(() => {
    if (!selectedRace?.is_time_trial) return [];
    return entries
      .filter(e => (lapCounts[e.bib] ?? 0) === 0)
      .sort((a, b) => sortBibNatural(a.bib, b.bib));
  }, [selectedRace, entries, lapCounts]);

  const ttRunning = useMemo(() => {
    if (!selectedRace?.is_time_trial) return null;
    return entries.find(e => (lapCounts[e.bib] ?? 0) === 1) ?? null;
  }, [selectedRace, entries, lapCounts]);

  const ttFinished = useMemo(() => {
    if (!selectedRace?.is_time_trial) return [];
    return entries.filter(e => (lapCounts[e.bib] ?? 0) >= 2).sort((a, b) => sortBibNatural(a.bib, b.bib));
  }, [selectedRace, entries, lapCounts]);

  // Elapsed timer — approximate (tracks from when the app detects the running rider)
  useEffect(() => {
    if (ttRunning) {
      if (!runnerStartedAtRef.current) runnerStartedAtRef.current = Date.now();
      const interval = setInterval(() => setElapsedMs(Date.now() - (runnerStartedAtRef.current ?? Date.now())), 1000);
      return () => clearInterval(interval);
    } else {
      runnerStartedAtRef.current = null;
      setElapsedMs(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttRunning?.bib]);

  const consumeLink = useCallback(async (url: string) => {
    const isRecovery = url.includes("auth/reset-password");
    const { queryParams } = Linking.parse(url);
    const code = typeof queryParams?.code === "string" ? queryParams.code : undefined;
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) setMessage(error.message);
      else if (isRecovery) setRecovering(true);
      return;
    }
    const fragment = url.split("#")[1];
    if (!fragment) return;
    const params = new URLSearchParams(fragment);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) {
      await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (isRecovery) setRecovering(true);
    }
  }, []);

  const incomingUrl = Linking.useLinkingURL();
  useEffect(() => { if (incomingUrl) consumeLink(incomingUrl); }, [incomingUrl, consumeLink]);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadEvents = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase.from("events").select("id,title,location,status").eq("owner_id", session.user.id).order("created_at", { ascending: false });
    setEvents(data ?? []);
  }, [session]);
  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => {
    const sync = async () => setPending(await flushCrossings());
    sync();
    const interval = setInterval(sync, 5000);
    return () => clearInterval(interval);
  }, []);

  const signInWithGoogle = async () => {
    setMessage(null);
    const redirectTo = Linking.createURL("auth/callback");
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data.url) return setMessage(error?.message ?? "Could not start Google sign-in.");
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === "success") await consumeLink(result.url);
    else if (result.type !== "cancel") setMessage("Google sign-in was interrupted. Try again.");
  };
  const submitPassword = async () => {
    setMessage(null);
    if (authMode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
      if (error) setMessage(error.message);
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: authEmail,
      password: authPassword,
      options: { emailRedirectTo: Linking.createURL("auth/callback") },
    });
    if (error) return setMessage(error.message);
    if (!data.session) setMessage("Check your inbox to confirm your address, then sign in.");
  };
  const sendPasswordReset = async () => {
    if (!authEmail) return setMessage("Enter your email above first, then tap forgot password.");
    setMessage(null);
    const { error } = await supabase.auth.resetPasswordForEmail(authEmail, {
      redirectTo: Linking.createURL("auth/reset-password"),
    });
    setMessage(error ? error.message : "Reset link sent. Open it on this phone.");
  };
  const updatePassword = async () => {
    if (newPassword.length < 8) return setMessage("Password must be at least 8 characters.");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return setMessage(error.message);
    setNewPassword("");
    setRecovering(false);
    setMessage("Password updated.");
  };
  const chooseEvent = async (event: Event) => {
    const { data } = await supabase.from("races").select("id,event_id,name,laps_planned,status,is_time_trial,time_trial_countdown_seconds").eq("event_id", event.id).order("sequence_order");
    setSelectedEvent(event);
    setRaces(data ?? []);
  };
  const chooseRace = async (race: Race) => {
    const [entriesResult, crossingsResult, recentResult] = await Promise.all([
      supabase.from("entries").select("id,bib,name").eq("race_id", race.id).order("bib"),
      supabase.from("crossings").select("bib").eq("race_id", race.id).is("deleted_at", null),
      supabase.from("crossings").select("client_id,bib,client_recorded_at").eq("race_id", race.id).is("deleted_at", null).order("client_recorded_at", { ascending: false }).limit(5),
    ]);
    const counts: Record<string, number> = {};
    for (const crossing of crossingsResult.data ?? []) counts[crossing.bib] = (counts[crossing.bib] ?? 0) + 1;
    // Overlay any still-pending crossings for this race at the top of the recent list.
    const pendingQueue = await getPendingQueue();
    const pendingForRace = pendingQueue.filter((p) => p.race_id === race.id).reverse();
    const syncedRecent = (recentResult.data ?? []) as RecentCrossing[];
    const combined = [
      ...pendingForRace.map((p) => ({ client_id: p.client_id, bib: p.bib, client_recorded_at: p.client_recorded_at })),
      ...syncedRecent,
    ].slice(0, 5);
    setEntries(entriesResult.data ?? []);
    setLapCounts(counts);
    setLastBib(null);
    setReopening(false);
    setReopenReason("");
    setRecentCrossings(combined);
    setSearch("");
    setSelectedRace(race);
  };
  const updateRace = async (status: "active" | "finished") => {
    if (!selectedRace) return;
    // started_at/finished_at are set by the races_lifecycle_guard trigger.
    const { error } = await supabase.from("races").update({ status }).eq("id", selectedRace.id);
    if (error) return Alert.alert("Could not update race", error.message);
    setSelectedRace({ ...selectedRace, status });
    setRaces(races.map((race) => race.id === selectedRace.id ? { ...race, status } : race));
  };
  const reopenRace = async () => {
    if (!selectedRace) return;
    if (!reopenReason.trim()) return Alert.alert("Reason required", "Enter why this race needs to reopen.");
    const { error } = await supabase.rpc("reopen_race", { p_race_id: selectedRace.id, p_reason: reopenReason.trim() });
    if (error) return Alert.alert("Could not reopen race", error.message);
    setSelectedRace({ ...selectedRace, status: "active" });
    setRaces(races.map((race) => race.id === selectedRace.id ? { ...race, status: "active" } : race));
    setReopening(false);
    setReopenReason("");
  };
  const recordBib = async (value: string) => {
    if (!selectedRace) return;
    // Haptic feedback at point of tap
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { remaining, client_id, client_recorded_at } = await recordCrossing(selectedRace.id, value);
    setLapCounts((counts) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }));
    // Highlight the tapped tile for 600 ms then return to neutral
    if (lastBibTimerRef.current) clearTimeout(lastBibTimerRef.current);
    setLastBib(value);
    lastBibTimerRef.current = setTimeout(() => setLastBib(null), 600);
    setRecentCrossings((prev) => [{ client_id, bib: value, client_recorded_at }, ...prev].slice(0, 5));
    setPending(remaining || await pendingCrossings());
  };

  const undoCrossing = async (crossing: RecentCrossing) => {
    // Try to remove from the offline queue first (crossing not yet synced).
    const wasInQueue = await removePendingCrossing(crossing.client_id);
    if (!wasInQueue) {
      // Already synced — soft-delete via Supabase, matching web scorer behavior.
      const { error } = await supabase
        .from("crossings")
        .update({ deleted_at: new Date().toISOString() })
        .eq("client_id", crossing.client_id);
      if (error) {
        Alert.alert("Undo failed", error.message);
        return;
      }
    }
    setLapCounts((counts) => {
      const current = counts[crossing.bib] ?? 0;
      if (current <= 1) {
        const next = { ...counts };
        delete next[crossing.bib];
        return next;
      }
      return { ...counts, [crossing.bib]: current - 1 };
    });
    setRecentCrossings((prev) => prev.filter((c) => c.client_id !== crossing.client_id));
    setPending(await pendingCrossings());
    setMessage(`Undo: Bib ${crossing.bib}`);
  };

  // ── Time trial actions ────────────────────────────────────────────────────
  const handleTTStart = useCallback(async (bib: string) => {
    if (!selectedRace) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await recordCrossing(selectedRace.id, bib);
    setPending(await pendingCrossings());
    setLapCounts(prev => ({ ...prev, [bib]: (prev[bib] ?? 0) + 1 }));
  }, [selectedRace]);

  const handleTTFinish = useCallback(async (bib: string) => {
    if (!selectedRace) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await recordCrossing(selectedRace.id, bib);
    setPending(await pendingCrossings());
    setLapCounts(prev => ({ ...prev, [bib]: (prev[bib] ?? 0) + 1 }));
  }, [selectedRace]);

  const startCountdown = useCallback((bib: string) => {
    const secs = selectedRace?.time_trial_countdown_seconds ?? 5;
    if (secs === 0) { handleTTStart(bib); return; }
    setTtCountdown(secs);
    ttCountdownRef.current = setInterval(() => {
      setTtCountdown(prev => {
        if (prev == null || prev <= 1) {
          clearInterval(ttCountdownRef.current!);
          handleTTStart(bib);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          return null;
        }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        return prev - 1;
      });
    }, 1000);
  }, [selectedRace, handleTTStart]);

  const cancelCountdown = useCallback(() => {
    if (ttCountdownRef.current) clearInterval(ttCountdownRef.current);
    setTtCountdown(null);
  }, []);

  if (recovering) return <SafeAreaView style={styles.screen}><Header title="Reset password" /><View style={styles.content}><View style={styles.panel}><Text style={styles.copy}>Choose a new password for your account.</Text><Text style={styles.label}>NEW PASSWORD</Text><TextInput value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" placeholder="••••••••" placeholderTextColor={colors.muted} style={styles.input} /><View style={styles.space} /><Button title="Update password" onPress={updatePassword} variant="red" disabled={!newPassword} />{message && <Text style={styles.message}>{message}</Text>}</View></View><StatusBar barStyle="dark-content" backgroundColor={colors.panel} translucent={false} /></SafeAreaView>;

  if (!session) return <SafeAreaView style={styles.screen}><Header title="Organizer sign in" /><View style={styles.content}><View style={styles.panel}><Text style={styles.copy}>Sign in with your Google account to manage your events.</Text><View style={styles.space} /><Button title="Continue with Google" onPress={signInWithGoogle} variant="red" /><View style={styles.space} /><Text style={styles.divider}>OR</Text><View style={styles.space} /><View style={styles.authToggle}><Pressable onPress={() => setAuthMode("signin")}><Text style={[styles.authToggleText, authMode === "signin" && styles.authToggleTextActive]}>SIGN IN</Text></Pressable><Text style={styles.authToggleText}>/</Text><Pressable onPress={() => setAuthMode("signup")}><Text style={[styles.authToggleText, authMode === "signup" && styles.authToggleTextActive]}>CREATE ACCOUNT</Text></Pressable></View><Text style={styles.label}>EMAIL</Text><TextInput value={authEmail} onChangeText={setAuthEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={colors.muted} style={styles.input} /><Text style={styles.label}>PASSWORD</Text><TextInput value={authPassword} onChangeText={setAuthPassword} secureTextEntry autoCapitalize="none" autoComplete={authMode === "signin" ? "password" : "password-new"} placeholder="••••••••" placeholderTextColor={colors.muted} style={styles.input} />{authMode === "signin" && <Pressable onPress={sendPasswordReset}><Text style={styles.forgot}>Forgot password?</Text></Pressable>}<View style={styles.space} /><Button title={authMode === "signin" ? "Sign in" : "Create account"} onPress={submitPassword} variant="dark" disabled={!authEmail || !authPassword} />{message && <Text style={styles.message}>{message}</Text>}</View></View><StatusBar barStyle="dark-content" backgroundColor={colors.panel} translucent={false} /></SafeAreaView>;

  if (!selectedEvent) return <SafeAreaView style={styles.screen}><Header title="My events" signedInAs={session.user.email} onSignOut={() => supabase.auth.signOut()} /><FlatList contentContainerStyle={styles.list} data={events} keyExtractor={(event) => event.id} onRefresh={loadEvents} refreshing={false} ListEmptyComponent={<Text style={styles.empty}>No events yet. Create an event on splitsync.org first.</Text>} renderItem={({ item }) => <Pressable onPress={() => chooseEvent(item)} style={styles.eventRow}><View><Text style={styles.eventTitle}>{item.title}</Text><Text style={styles.muted}>{item.location ?? "Location TBC"}</Text></View><Text style={styles.arrow}>›</Text></Pressable>} /><StatusBar barStyle="dark-content" backgroundColor={colors.panel} translucent={false} /></SafeAreaView>;

  if (!selectedRace) return <SafeAreaView style={styles.screen}><Header title={selectedEvent.title} onBack={() => setSelectedEvent(null)} /><Navigation onEvents={() => setSelectedEvent(null)} onResults={() => Linking.openURL(`https://splitsync.org/results/${selectedEvent.id}`)} /><FlatList contentContainerStyle={styles.list} data={races} keyExtractor={(race) => race.id} ListEmptyComponent={<Text style={styles.empty}>No races yet. Add them on the event setup page.</Text>} renderItem={({ item }) => <Pressable onPress={() => chooseRace(item)} style={styles.eventRow}><View><Text style={styles.eventTitle}>{item.name}</Text><Text style={styles.muted}>{item.laps_planned ? `${item.laps_planned} laps` : "Timed race"} · {item.status}</Text></View><Text style={styles.arrow}>›</Text></Pressable>} /><StatusBar barStyle="dark-content" backgroundColor={colors.panel} translucent={false} /></SafeAreaView>;

  // Active race: time-trial view or mass-start bib grid
  if (selectedRace.status === "active" && selectedRace.is_time_trial) {
    const nextUp = ttQueue[0] ?? null;
    const progressPct = selectedRace.laps_planned ? Math.min(1, elapsedMs / (selectedRace.laps_planned * 1000)) : 0;
    return (
      <SafeAreaView style={styles.screen}>
        <Header title={selectedRace.name} onBack={() => setSelectedRace(null)} />
        <Navigation onEvents={() => { setSelectedRace(null); setSelectedEvent(null); }} onRaces={() => setSelectedRace(null)} onResults={() => Linking.openURL(`https://splitsync.org/results/${selectedRace.event_id}`)} />
        {ttCountdown !== null && (
          <View style={styles.ttCountdownOverlay}>
            <Text style={styles.ttCountdownNumber}>{ttCountdown}</Text>
            <Pressable onPress={cancelCountdown} style={styles.ttCancelBtn}><Text style={styles.ttCancelBtnText}>CANCEL</Text></Pressable>
          </View>
        )}
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.statusRow}>
            <Text style={styles.status}>TIME TRIAL · ACTIVE</Text>
            {pending > 0 && <Text style={styles.pending}>{pending} PENDING</Text>}
          </View>

          {/* ON COURSE */}
          <View style={[styles.ttSectionBox, { backgroundColor: ttRunning ? colors.ink : colors.ttSection }]}>
            <Text style={[styles.ttSectionHeader, ttRunning && { color: colors.yellow }]}>ON COURSE</Text>
            {ttRunning ? (
              <>
                <Text style={styles.ttRunnerBib}>#{ttRunning.bib}</Text>
                <Text style={styles.ttRunnerName}>{ttRunning.name}</Text>
                <Text style={styles.ttElapsed}>{formatElapsed(elapsedMs)}</Text>
                <View style={styles.ttProgressBg}>
                  <View style={[styles.ttProgressFill, { width: `${Math.round(progressPct * 100)}%` as unknown as number }]} />
                </View>
                <View style={styles.space} />
                <Button title="FINISH" onPress={() => handleTTFinish(ttRunning.bib)} variant="red" />
              </>
            ) : nextUp ? (
              <>
                <Text style={styles.ttEmptyHint}>No rider on course.</Text>
                <View style={styles.space} />
                <Button title={`START NOW  ·  #${nextUp.bib} ${nextUp.name}`} onPress={() => handleTTStart(nextUp.bib)} variant="yellow" />
                {(selectedRace.time_trial_countdown_seconds ?? 0) > 0 && (
                  <>
                    <View style={styles.space} />
                    <Button title={`START COUNTDOWN (${selectedRace.time_trial_countdown_seconds}s)`} onPress={() => startCountdown(nextUp.bib)} variant="dark" />
                  </>
                )}
              </>
            ) : (
              <Text style={styles.ttEmptyHint}>Queue empty — all riders accounted for.</Text>
            )}
          </View>

          {/* UP NEXT */}
          <View style={[styles.ttSectionBox, { backgroundColor: colors.ttSection }]}>
            <Text style={styles.ttSectionHeader}>UP NEXT ({ttQueue.length})</Text>
            {ttQueue.length === 0 ? (
              <Text style={styles.ttEmptyHint}>No riders queued.</Text>
            ) : (
              ttQueue.map((e, i) => (
                <View key={e.id} style={styles.ttQueueRow}>
                  <Text style={styles.ttQueueBib}>#{e.bib}</Text>
                  <Text style={styles.ttQueueName}>{e.name}</Text>
                  {i === 0 && <Text style={styles.ttNextBadge}>NEXT</Text>}
                </View>
              ))
            )}
          </View>

          {/* FINISHED */}
          <View style={[styles.ttSectionBox, { backgroundColor: colors.ttSection }]}>
            <Text style={styles.ttSectionHeader}>FINISHED ({ttFinished.length})</Text>
            {ttFinished.length === 0 ? (
              <Text style={styles.ttEmptyHint}>No finishers yet.</Text>
            ) : (
              ttFinished.map((e, i) => (
                <View key={e.id} style={styles.ttQueueRow}>
                  <Text style={styles.ttPosition}>{i + 1}.</Text>
                  <Text style={styles.ttQueueBib}>#{e.bib}</Text>
                  <Text style={styles.ttQueueName}>{e.name}</Text>
                </View>
              ))
            )}
          </View>

          <View style={styles.space} />
          <Button title="Finish race" onPress={() => updateRace("finished")} variant="outline" />
        </ScrollView>
        <StatusBar barStyle="dark-content" backgroundColor={colors.panel} translucent={false} />
      </SafeAreaView>
    );
  }

  // Active race (mass-start): virtualized FlatList grid with responsive column count + search filter + recent crossings undo panel
  if (selectedRace.status === "active") return <SafeAreaView style={styles.screen}><Header title={selectedRace.name} onBack={() => setSelectedRace(null)} /><Navigation onEvents={() => { setSelectedRace(null); setSelectedEvent(null); }} onRaces={() => setSelectedRace(null)} onResults={() => Linking.openURL(`https://splitsync.org/results/${selectedRace.event_id}`)} /><FlatList key={String(numColumns)} data={filteredEntries} numColumns={numColumns} keyExtractor={(entry) => entry.id} contentContainerStyle={styles.content} columnWrapperStyle={numColumns > 1 ? { gap: 10 } : undefined} ItemSeparatorComponent={() => <View style={{ height: 10 }} />} ListHeaderComponent={<><View style={styles.statusRow}><Text style={styles.status}>{selectedRace.status.toUpperCase()}</Text>{pending > 0 && <Text style={styles.pending}>{pending} PENDING</Text>}</View><Text style={styles.instruction}>TAP A RIDER AS THEY CROSS THE LINE</Text><TextInput value={search} onChangeText={setSearch} placeholder="Find bib / rider…" placeholderTextColor={colors.muted} style={styles.searchInput} autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />{search.trim() !== "" && <Text style={styles.searchCount}>{filteredEntries.length} of {entries.length} riders</Text>}</>} ListFooterComponent={<>{recentCrossings.length > 0 && <View style={styles.recentPanel}><Text style={styles.recentHeading}>RECENT CROSSINGS</Text>{recentCrossings.map((c) => <View key={c.client_id} style={styles.recentRow}><View style={styles.recentInfo}><Text style={styles.recentBib}>#{c.bib}</Text><Text style={styles.recentTime}>{new Date(c.client_recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</Text></View><Pressable onPress={() => undoCrossing(c)} style={styles.undoButton}><Text style={styles.undoText}>UNDO</Text></Pressable></View>)}</View>}<View style={styles.space} /><Button title="Finish race" onPress={() => updateRace("finished")} variant="outline" /></>} renderItem={({ item: entry }) => <Pressable onPress={() => recordBib(entry.bib)} style={[styles.riderTile, { width: tileWidth }, lastBib === entry.bib && styles.riderTileRecorded]}><Text style={[styles.riderBib, lastBib === entry.bib && styles.riderTileRecordedText]}>#{entry.bib}</Text><Text numberOfLines={1} style={[styles.riderName, lastBib === entry.bib && styles.riderTileRecordedText]}>{entry.name}</Text><Text style={[styles.riderLap, lastBib === entry.bib && styles.riderTileRecordedText]}>LAP {lapCounts[entry.bib] ?? 0}</Text></Pressable>} /><StatusBar barStyle="dark-content" backgroundColor={colors.panel} translucent={false} /></SafeAreaView>;

  return <SafeAreaView style={styles.screen}><Header title={selectedRace.name} onBack={() => setSelectedRace(null)} /><Navigation onEvents={() => { setSelectedRace(null); setSelectedEvent(null); }} onRaces={() => setSelectedRace(null)} onResults={() => Linking.openURL(`https://splitsync.org/results/${selectedRace.event_id}`)} /><ScrollView contentContainerStyle={styles.content}><View style={styles.statusRow}><Text style={styles.status}>{selectedRace.status.toUpperCase()}</Text>{pending > 0 && <Text style={styles.pending}>{pending} PENDING</Text>}</View>{selectedRace.status === "upcoming" && <View style={styles.panel}><Text style={styles.copy}>{entries.length} assigned riders. The grid locks when you start the race.</Text><View style={styles.space} /><Button title="Start race" onPress={() => updateRace("active")} variant="yellow" /></View>}{selectedRace.status === "finished" && <View style={styles.panel}><Text style={styles.copy}>Race finished. View the public classification at splitsync.org.</Text><View style={styles.space} />{reopening ? <><Text style={styles.label}>REASON FOR REOPENING</Text><TextInput value={reopenReason} onChangeText={setReopenReason} placeholder="Why does this race need to reopen?" placeholderTextColor={colors.muted} style={styles.input} multiline /><View style={styles.space} /><Button title="Confirm reopen" onPress={reopenRace} variant="yellow" disabled={!reopenReason.trim()} /><View style={styles.space} /><Button title="Cancel" onPress={() => { setReopening(false); setReopenReason(""); }} variant="outline" /></> : <Button title="Reopen race" onPress={() => setReopening(true)} variant="outline" />}</View>}{message && <Text style={styles.message}>{message}</Text>}</ScrollView><StatusBar barStyle="dark-content" backgroundColor={colors.panel} translucent={false} /></SafeAreaView>;
}

function Navigation({ onEvents, onRaces, onResults }: { onEvents: () => void; onRaces?: () => void; onResults: () => void }) {
  return <View style={styles.navigation}><Pressable onPress={onEvents}><Text style={styles.navLink}>EVENTS</Text></Pressable>{onRaces && <Pressable onPress={onRaces}><Text style={styles.navLink}>RACES</Text></Pressable>}<Pressable onPress={onResults}><Text style={styles.navLink}>RESULTS</Text></Pressable></View>;
}

export default function App() {
  return <SafeAreaProvider><Tracker /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper }, redLine: { height: 7, backgroundColor: colors.red }, header: { backgroundColor: colors.panel, borderBottomWidth: 2, borderColor: colors.ink, padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }, navigation: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 22, paddingHorizontal: 20, backgroundColor: colors.paper, borderBottomWidth: 1, borderColor: colors.line }, navLink: { color: colors.red, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, kickerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }, logo: { flexDirection: "row", borderRadius: 2, overflow: "hidden" }, logoSplit: { backgroundColor: colors.ink, paddingHorizontal: 6, paddingVertical: 2 }, logoSync: { backgroundColor: colors.yellow, paddingHorizontal: 6, paddingVertical: 2 }, logoText: { color: "white", fontSize: 10, fontWeight: "900", letterSpacing: 1 }, logoTextDark: { color: colors.ink, fontSize: 10, fontWeight: "900", letterSpacing: 1 }, kicker: { fontSize: 10, fontWeight: "900", letterSpacing: 2, color: colors.red }, headerTitle: { fontSize: 25, fontWeight: "900", textTransform: "uppercase", color: colors.ink, marginTop: 2 }, back: { fontSize: 11, fontWeight: "900", letterSpacing: 1, color: colors.red }, signOutBlock: { alignItems: "flex-end", gap: 6 }, signedInAs: { fontSize: 10, fontWeight: "700", color: colors.muted, maxWidth: 140 }, content: { padding: 20 }, panel: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.panel, padding: 18 }, copy: { color: colors.muted, fontSize: 15, lineHeight: 22 }, label: { color: colors.ink, fontSize: 11, fontWeight: "900", letterSpacing: 1, marginTop: 22, marginBottom: 6 }, input: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.panel, color: colors.ink, padding: 13, fontWeight: "700", fontSize: 16 }, button: { minHeight: 52, alignItems: "center", justifyContent: "center", borderWidth: 2 }, button_dark: { borderColor: colors.ink, backgroundColor: colors.ink }, button_red: { borderColor: colors.red, backgroundColor: colors.red }, button_yellow: { borderColor: colors.ink, backgroundColor: colors.yellow }, button_outline: { borderColor: colors.ink, backgroundColor: "transparent" }, buttonText: { color: "white", fontWeight: "900", textTransform: "uppercase", fontSize: 13, letterSpacing: 1 }, buttonTextDark: { color: colors.ink }, disabled: { opacity: 0.4 }, space: { height: 12 }, message: { marginTop: 16, color: colors.red, fontWeight: "700", lineHeight: 20 }, divider: { textAlign: "center", color: colors.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, authToggle: { flexDirection: "row", justifyContent: "center", gap: 10 }, authToggleText: { color: colors.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, authToggleTextActive: { color: colors.red }, forgot: { marginTop: 10, color: colors.muted, fontSize: 12, fontWeight: "700" }, list: { padding: 20, gap: 10 }, eventRow: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.panel, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, eventTitle: { color: colors.ink, fontSize: 17, fontWeight: "900", textTransform: "uppercase" }, muted: { color: colors.muted, fontSize: 13, fontWeight: "700", marginTop: 5 }, arrow: { color: colors.red, fontSize: 32, fontWeight: "300" }, empty: { color: colors.muted, textAlign: "center", fontSize: 15, fontWeight: "700", lineHeight: 22, padding: 32 }, statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 2, borderColor: colors.ink, paddingBottom: 14, marginBottom: 18 }, status: { color: colors.ink, fontSize: 13, fontWeight: "900", letterSpacing: 1 }, pending: { color: colors.red, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, instruction: { color: colors.muted, textAlign: "center", fontSize: 11, fontWeight: "900", letterSpacing: 1, marginBottom: 10 }, searchInput: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.panel, color: colors.ink, padding: 13, fontWeight: "700", fontSize: 15, marginBottom: 8 }, searchCount: { color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" }, riderGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, riderTile: { minHeight: 118, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.panel, padding: 12, justifyContent: "space-between" }, riderTileRecorded: { backgroundColor: colors.red, borderColor: colors.red }, riderBib: { color: colors.ink, fontSize: 28, fontWeight: "900" }, riderName: { color: colors.ink, fontSize: 14, fontWeight: "900", textTransform: "uppercase" }, riderLap: { color: colors.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, riderTileRecordedText: { color: "white" }, recentPanel: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.panel, marginTop: 14 }, recentHeading: { color: colors.ink, fontSize: 11, fontWeight: "900", letterSpacing: 1, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, borderBottomWidth: 1, borderColor: colors.line }, recentRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line }, recentInfo: { flex: 1, gap: 2 }, recentBib: { color: colors.ink, fontSize: 16, fontWeight: "900" }, recentTime: { color: colors.muted, fontSize: 11, fontWeight: "700" }, undoButton: { backgroundColor: colors.red, paddingHorizontal: 14, paddingVertical: 8 }, undoText: { color: "white", fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  // Time trial styles
  ttCountdownOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center" },
  ttCountdownNumber: { fontSize: 120, fontWeight: "900", color: colors.yellow, lineHeight: 140 },
  ttCancelBtn: { marginTop: 32, borderWidth: 2, borderColor: "white", paddingHorizontal: 28, paddingVertical: 14 },
  ttCancelBtnText: { color: "white", fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  ttSectionBox: { borderWidth: 2, borderColor: colors.ink, padding: 16, marginBottom: 14 },
  ttSectionHeader: { color: colors.ink, fontSize: 11, fontWeight: "900", letterSpacing: 1, marginBottom: 12, textTransform: "uppercase" },
  ttRunnerBib: { color: colors.yellow, fontSize: 52, fontWeight: "900", lineHeight: 60 },
  ttRunnerName: { color: "white", fontSize: 20, fontWeight: "900", textTransform: "uppercase", marginBottom: 8 },
  ttElapsed: { color: "white", fontSize: 38, fontWeight: "900", letterSpacing: 2, marginBottom: 10 },
  ttProgressBg: { height: 8, backgroundColor: "rgba(255,255,255,0.2)", marginBottom: 14 },
  ttProgressFill: { height: 8, backgroundColor: colors.yellow },
  ttQueueRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.line },
  ttQueueBib: { color: colors.ink, fontSize: 20, fontWeight: "900", minWidth: 52 },
  ttQueueName: { color: colors.ink, fontSize: 15, fontWeight: "700", flex: 1 },
  ttNextBadge: { color: colors.red, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  ttPosition: { color: colors.muted, fontSize: 15, fontWeight: "900", minWidth: 28 },
  ttEmptyHint: { color: colors.muted, fontSize: 13, fontWeight: "700" },
});
