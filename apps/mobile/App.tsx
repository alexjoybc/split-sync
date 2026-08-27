import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { Session } from "@supabase/supabase-js";
import { flushCrossings, pendingCrossings, recordCrossing } from "./src/crossingQueue";
import { supabase } from "./src/supabase";
import type { Entry, Event, Race } from "./src/types";

WebBrowser.maybeCompleteAuthSession();

const colors = { paper: "#f4f1ea", panel: "#ffffff", ink: "#18181b", muted: "#71717a", red: "#ec1c24", yellow: "#f6d428", line: "#d4d1ca" };

function Button({ title, onPress, variant = "dark", disabled = false }: { title: string; onPress: () => void; variant?: "dark" | "red" | "yellow" | "outline"; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.button, styles[`button_${variant}`], disabled && styles.disabled]}><Text style={[styles.buttonText, variant === "yellow" || variant === "outline" ? styles.buttonTextDark : undefined]}>{title}</Text></Pressable>;
}

function Header({ title, onBack, onSignOut }: { title: string; onBack?: () => void; onSignOut?: () => void }) {
  return <><View style={styles.redLine} /><View style={styles.header}><View>{onBack && <Pressable onPress={onBack}><Text style={styles.back}>BACK</Text></Pressable>}<Text style={styles.kicker}>SPLITSYNC TRACKER</Text><Text style={styles.headerTitle}>{title}</Text></View>{onSignOut && <Pressable onPress={onSignOut}><Text style={styles.back}>SIGN OUT</Text></Pressable>}</View></>;
}

function Tracker() {
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [races, setRaces] = useState<Race[]>([]);
  const [selectedRace, setSelectedRace] = useState<Race | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [lapCounts, setLapCounts] = useState<Record<string, number>>({});
  const [lastBib, setLastBib] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  const consumeLink = useCallback(async (url: string) => {
    const { queryParams } = Linking.parse(url);
    const code = typeof queryParams?.code === "string" ? queryParams.code : undefined;
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) setMessage(error.message);
      return;
    }
    const fragment = url.split("#")[1];
    if (!fragment) return;
    const params = new URLSearchParams(fragment);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (accessToken && refreshToken) await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
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
  const chooseEvent = async (event: Event) => {
    const { data } = await supabase.from("races").select("id,event_id,name,laps_planned,status").eq("event_id", event.id).order("sequence_order");
    setSelectedEvent(event);
    setRaces(data ?? []);
  };
  const chooseRace = async (race: Race) => {
    const [entriesResult, crossingsResult] = await Promise.all([
      supabase.from("entries").select("id,bib,name").eq("race_id", race.id).order("bib"),
      supabase.from("crossings").select("bib").eq("race_id", race.id).is("deleted_at", null),
    ]);
    const counts: Record<string, number> = {};
    for (const crossing of crossingsResult.data ?? []) counts[crossing.bib] = (counts[crossing.bib] ?? 0) + 1;
    setEntries(entriesResult.data ?? []);
    setLapCounts(counts);
    setLastBib(null);
    setSelectedRace(race);
  };
  const updateRace = async (status: "active" | "finished") => {
    if (!selectedRace) return;
    const { error } = await supabase.from("races").update({ status, ...(status === "active" ? { started_at: new Date().toISOString() } : {}) }).eq("id", selectedRace.id);
    if (error) return Alert.alert("Could not update race", error.message);
    setSelectedRace({ ...selectedRace, status });
    setRaces(races.map((race) => race.id === selectedRace.id ? { ...race, status } : race));
  };
  const recordBib = async (value: string) => {
    if (!selectedRace) return;
    const remaining = await recordCrossing(selectedRace.id, value);
    setLapCounts((counts) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }));
    setLastBib(value);
    setPending(remaining || await pendingCrossings());
    setMessage(`Bib ${value} recorded`);
  };

  if (!session) return <SafeAreaView style={styles.screen}><Header title="Organizer sign in" /><View style={styles.content}><View style={styles.panel}><Text style={styles.copy}>Sign in with your Google account to manage your events.</Text><View style={styles.space} /><Button title="Continue with Google" onPress={signInWithGoogle} variant="red" />{message && <Text style={styles.message}>{message}</Text>}</View></View><StatusBar barStyle="dark-content" backgroundColor={colors.panel} translucent={false} /></SafeAreaView>;

  if (!selectedEvent) return <SafeAreaView style={styles.screen}><Header title="My events" onSignOut={() => supabase.auth.signOut()} /><FlatList contentContainerStyle={styles.list} data={events} keyExtractor={(event) => event.id} onRefresh={loadEvents} refreshing={false} ListEmptyComponent={<Text style={styles.empty}>No events yet. Create an event on splitsync.org first.</Text>} renderItem={({ item }) => <Pressable onPress={() => chooseEvent(item)} style={styles.eventRow}><View><Text style={styles.eventTitle}>{item.title}</Text><Text style={styles.muted}>{item.location ?? "Location TBC"}</Text></View><Text style={styles.arrow}>›</Text></Pressable>} /><StatusBar barStyle="dark-content" backgroundColor={colors.panel} translucent={false} /></SafeAreaView>;

  if (!selectedRace) return <SafeAreaView style={styles.screen}><Header title={selectedEvent.title} onBack={() => setSelectedEvent(null)} /><Navigation onEvents={() => setSelectedEvent(null)} onResults={() => Linking.openURL(`https://splitsync.org/results/${selectedEvent.id}`)} /><FlatList contentContainerStyle={styles.list} data={races} keyExtractor={(race) => race.id} ListEmptyComponent={<Text style={styles.empty}>No races yet. Add them on the event setup page.</Text>} renderItem={({ item }) => <Pressable onPress={() => chooseRace(item)} style={styles.eventRow}><View><Text style={styles.eventTitle}>{item.name}</Text><Text style={styles.muted}>{item.laps_planned ? `${item.laps_planned} laps` : "Timed race"} · {item.status}</Text></View><Text style={styles.arrow}>›</Text></Pressable>} /><StatusBar barStyle="dark-content" backgroundColor={colors.panel} translucent={false} /></SafeAreaView>;

  return <SafeAreaView style={styles.screen}><Header title={selectedRace.name} onBack={() => setSelectedRace(null)} /><Navigation onEvents={() => { setSelectedRace(null); setSelectedEvent(null); }} onRaces={() => setSelectedRace(null)} onResults={() => Linking.openURL(`https://splitsync.org/results/${selectedRace.event_id}`)} /><ScrollView contentContainerStyle={styles.content}><View style={styles.statusRow}><Text style={styles.status}>{selectedRace.status.toUpperCase()}</Text>{pending > 0 && <Text style={styles.pending}>{pending} PENDING</Text>}</View>{selectedRace.status === "upcoming" && <View style={styles.panel}><Text style={styles.copy}>{entries.length} assigned riders. The grid locks when you start the race.</Text><View style={styles.space} /><Button title="Start race" onPress={() => updateRace("active")} variant="yellow" /></View>}{selectedRace.status === "active" && <><Text style={styles.instruction}>TAP A RIDER AS THEY CROSS THE LINE</Text><View style={styles.riderGrid}>{entries.map((entry) => <Pressable key={entry.id} onPress={() => recordBib(entry.bib)} style={[styles.riderTile, lastBib === entry.bib && styles.riderTileRecorded]}><Text style={[styles.riderBib, lastBib === entry.bib && styles.riderTileRecordedText]}>#{entry.bib}</Text><Text numberOfLines={1} style={[styles.riderName, lastBib === entry.bib && styles.riderTileRecordedText]}>{entry.name}</Text><Text style={[styles.riderLap, lastBib === entry.bib && styles.riderTileRecordedText]}>LAP {lapCounts[entry.bib] ?? 0}</Text></Pressable>)}</View><View style={styles.space} /><Button title="Finish race" onPress={() => updateRace("finished")} variant="outline" /></>}{selectedRace.status === "finished" && <View style={styles.panel}><Text style={styles.copy}>Race finished. View the public classification at splitsync.org.</Text></View>}{message && <Text style={styles.message}>{message}</Text>}</ScrollView><StatusBar barStyle="dark-content" backgroundColor={colors.panel} translucent={false} /></SafeAreaView>;
}

function Navigation({ onEvents, onRaces, onResults }: { onEvents: () => void; onRaces?: () => void; onResults: () => void }) {
  return <View style={styles.navigation}><Pressable onPress={onEvents}><Text style={styles.navLink}>EVENTS</Text></Pressable>{onRaces && <Pressable onPress={onRaces}><Text style={styles.navLink}>RACES</Text></Pressable>}<Pressable onPress={onResults}><Text style={styles.navLink}>RESULTS</Text></Pressable></View>;
}

export default function App() {
  return <SafeAreaProvider><Tracker /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper }, redLine: { height: 7, backgroundColor: colors.red }, header: { backgroundColor: colors.panel, borderBottomWidth: 2, borderColor: colors.ink, padding: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }, navigation: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 22, paddingHorizontal: 20, backgroundColor: colors.paper, borderBottomWidth: 1, borderColor: colors.line }, navLink: { color: colors.red, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, kicker: { fontSize: 10, fontWeight: "900", letterSpacing: 2, color: colors.red, marginTop: 6 }, headerTitle: { fontSize: 25, fontWeight: "900", textTransform: "uppercase", color: colors.ink, marginTop: 2 }, back: { fontSize: 11, fontWeight: "900", letterSpacing: 1, color: colors.red }, content: { padding: 20 }, panel: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.panel, padding: 18 }, copy: { color: colors.muted, fontSize: 15, lineHeight: 22 }, label: { color: colors.ink, fontSize: 11, fontWeight: "900", letterSpacing: 1, marginTop: 22, marginBottom: 6 }, input: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.panel, color: colors.ink, padding: 13, fontWeight: "700", fontSize: 16 }, button: { minHeight: 52, alignItems: "center", justifyContent: "center", borderWidth: 2 }, button_dark: { borderColor: colors.ink, backgroundColor: colors.ink }, button_red: { borderColor: colors.red, backgroundColor: colors.red }, button_yellow: { borderColor: colors.ink, backgroundColor: colors.yellow }, button_outline: { borderColor: colors.ink, backgroundColor: "transparent" }, buttonText: { color: "white", fontWeight: "900", textTransform: "uppercase", fontSize: 13, letterSpacing: 1 }, buttonTextDark: { color: colors.ink }, disabled: { opacity: 0.4 }, space: { height: 12 }, message: { marginTop: 16, color: colors.red, fontWeight: "700", lineHeight: 20 }, list: { padding: 20, gap: 10 }, eventRow: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.panel, padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, eventTitle: { color: colors.ink, fontSize: 17, fontWeight: "900", textTransform: "uppercase" }, muted: { color: colors.muted, fontSize: 13, fontWeight: "700", marginTop: 5 }, arrow: { color: colors.red, fontSize: 32, fontWeight: "300" }, empty: { color: colors.muted, textAlign: "center", fontSize: 15, fontWeight: "700", lineHeight: 22, padding: 32 }, statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 2, borderColor: colors.ink, paddingBottom: 14, marginBottom: 18 }, status: { color: colors.ink, fontSize: 13, fontWeight: "900", letterSpacing: 1 }, pending: { color: colors.red, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, instruction: { color: colors.muted, textAlign: "center", fontSize: 11, fontWeight: "900", letterSpacing: 1, marginBottom: 10 }, riderGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, riderTile: { width: "48.5%", minHeight: 118, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.panel, padding: 12, justifyContent: "space-between" }, riderTileRecorded: { backgroundColor: colors.red, borderColor: colors.red }, riderBib: { color: colors.ink, fontSize: 28, fontWeight: "900" }, riderName: { color: colors.ink, fontSize: 14, fontWeight: "900", textTransform: "uppercase" }, riderLap: { color: colors.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1 }, riderTileRecordedText: { color: "white" },
});
