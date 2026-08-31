"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { formatLapTime, formatTime } from "@/lib/stopwatchFormat";

type Status = "waiting" | "running" | "stopped";

interface LiveEvent {
  event_type: "start" | "lap" | "stop" | "reset";
  client_recorded_at: string;
  actor_name: string;
  sequence: number;
}

interface LivePayload {
  session: { name: string; code: string; status: Status; t0_server: string | null };
  participants: { display_name: string; is_owner: boolean }[];
  events: LiveEvent[];
}

function deriveLaps(events: LiveEvent[]) {
  let previous: string | null = null;
  let total = 0;
  const laps: { n: number; ms: number; total: number; actor: string }[] = [];
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.event_type === "reset") {
      previous = null;
      total = 0;
      laps.length = 0;
    } else if (event.event_type === "start") {
      previous = event.client_recorded_at;
    } else if (event.event_type === "lap" && previous) {
      const ms = new Date(event.client_recorded_at).getTime() - new Date(previous).getTime();
      total += ms;
      laps.push({ n: laps.length + 1, ms, total, actor: event.actor_name });
      previous = event.client_recorded_at;
    }
  }
  return laps;
}

export default function LiveSessionView({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const upperCode = code.toUpperCase();
  const [payload, setPayload] = useState<LivePayload | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const payloadRef = useRef<LivePayload | null>(null);

  const refresh = async () => {
    const { data, error } = await supabase.rpc("get_casual_session_live_view", { p_code: upperCode });
    if (error || !data) {
      setUnavailable(true);
      return;
    }
    const next = data as unknown as LivePayload;
    payloadRef.current = next;
    setPayload(next);
  };

  useEffect(() => { refresh(); }, [upperCode]);

  useEffect(() => {
    const channel = supabase.channel(`stopwatch:${upperCode}`)
      .on("broadcast", { event: "session_event" }, refresh)
      .on("broadcast", { event: "participant_joined" }, refresh)
      .on("broadcast", { event: "participant_left" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [upperCode]);

  useEffect(() => {
    let frame: number;
    const tick = () => {
      const session = payloadRef.current?.session;
      if (session?.status === "running" && session.t0_server) {
        setElapsed(Math.max(0, Date.now() - new Date(session.t0_server).getTime()));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const laps = useMemo(() => deriveLaps(payload?.events ?? []), [payload]);
  const best = laps.length ? Math.min(...laps.map((lap) => lap.ms)) : null;
  const time = formatTime(elapsed);

  return <main className="race-page flex min-h-dvh flex-col">
    <div className="race-topline" />
    <header className="race-masthead"><div className="mx-auto flex max-w-2xl items-end justify-between gap-4">
      <div><p className={`race-kicker ${payload?.session.status === "running" ? "text-race-red" : "text-race-muted"}`}>{payload?.session.status === "running" ? "Live view" : "Waiting"}</p><h1 className="race-title">{payload?.session.name ?? "Live stopwatch"}</h1></div>
      <Link href="/stopwatch" className="race-action race-action--outline text-sm">Stopwatch</Link>
    </div></header>
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-4 py-8 sm:px-6">
      {unavailable ? <section className="w-full border-2 border-race-ink bg-white p-6 text-center"><p className="race-kicker mb-2">Live view unavailable</p><p className="text-sm font-semibold text-race-muted">This session has expired or the code is invalid.</p></section> : !payload ? <p className="text-sm font-semibold text-race-muted">Loading live session...</p> : <>
        <p className="mb-3 text-xs font-black uppercase tracking-widest text-race-muted">View only</p>
        <div className="sw-dial w-full max-w-xl" role="timer" aria-label={`Elapsed time: ${time.main}${time.sub}`}><div className="sw-digits flex flex-col items-center"><span className="block" style={{ fontSize: "clamp(64px, 20vw, 120px)" }}>{time.main}</span><span className="block" style={{ fontSize: "clamp(36px, 10vw, 64px)", color: "var(--sw-digit-sub-color)" }}>{time.sub}</span></div></div>
        <p className="mt-4 text-center text-sm font-semibold text-race-muted">This screen cannot start, stop, reset, or record laps.</p>
        <section className="mt-8 w-full" aria-label="Participants"><p className="race-kicker mb-2">Participants</p><div className="flex flex-wrap gap-2">{payload.participants.map((participant, i) => <span key={`${participant.display_name}-${i}`} className="border border-race-line px-2 py-1 text-xs font-bold text-race-ink">{participant.display_name}{participant.is_owner ? " owner" : ""}</span>)}</div></section>
        {laps.length > 0 && <section className="mt-8 w-full border-t-2 border-race-ink pt-4" aria-label="Shared lap times"><p className="race-kicker mb-3">Laps</p><table className="sw-lap-table w-full"><thead><tr><th>#</th><th>Lap</th><th>Total</th><th className="text-left">By</th></tr></thead><tbody>{[...laps].reverse().map((lap) => <tr key={lap.n} className={lap.ms === best ? "sw-lap-row--best" : undefined}><td>{lap.ms === best ? "★ " : ""}{lap.n}</td><td>{formatLapTime(lap.ms)}</td><td>{formatLapTime(lap.total)}</td><td className="text-left text-race-muted">{lap.actor}</td></tr>)}</tbody></table></section>}
      </>}
    </div>
  </main>;
}
