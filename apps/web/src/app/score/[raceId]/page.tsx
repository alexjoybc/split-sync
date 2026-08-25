"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BackspaceIcon } from "@heroicons/react/24/outline";
import { supabase } from "@/lib/supabase";
import { useRaceData } from "@/lib/useRaceData";
import { recordCrossing, flushQueue, pendingCount } from "@/lib/crossingQueue";

function classNames(...classes: (string | false)[]) {
  return classes.filter(Boolean).join(" ");
}

export default function Scorer({ params }: { params: Promise<{ raceId: string }> }) {
  const { raceId } = use(params);
  const { race, entries, crossings, loading, refetch } = useRaceData(raceId);
  const [bib, setBib] = useState("");
  const [pending, setPending] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  // Retry offline queue: on reconnect + every 5s
  useEffect(() => {
    const sync = async () => setPending(await flushQueue().then(() => pendingCount()));
    const interval = setInterval(sync, 5000);
    window.addEventListener("online", sync);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", sync);
    };
  }, []);

  const submit = useCallback(
    async (value: string) => {
      if (!value) return;
      setBib("");
      setFlash(value);
      setTimeout(() => setFlash(null), 600);
      await recordCrossing(raceId, value);
      setPending(pendingCount());
      refetch();
    },
    [raceId, refetch]
  );

  // Physical keyboard support (laptop at the timing table)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) setBib((b) => (b + e.key).slice(0, 4));
      else if (e.key === "Backspace") setBib((b) => b.slice(0, -1));
      else if (e.key === "Enter") submit(bib);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bib, submit]);

  const lapsByBib = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of crossings) m.set(c.bib, (m.get(c.bib) ?? 0) + 1);
    return m;
  }, [crossings]);

  const recent = useMemo(() => [...crossings].reverse().slice(0, 8), [crossings]);

  const undo = async (id: string) => {
    await supabase
      .from("crossings")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    refetch();
  };

  const setRaceStatus = async (status: "active" | "finished") => {
    await supabase
      .from("races")
      .update({ status, ...(status === "active" ? { started_at: new Date().toISOString() } : {}) })
      .eq("id", raceId);
    refetch();
  };

  if (loading || !race) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-gray-950 text-gray-400">
        {loading ? "Loading…" : "Race not found"}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col bg-gray-950 px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">{race.name}</h1>
          <p className="text-xs text-gray-400">
            Scorer
            {pending > 0 && (
              <span className="ml-2 rounded-full bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                {pending} pending sync
              </span>
            )}
          </p>
        </div>
        {race.status === "upcoming" && (
          <button
            onClick={() => setRaceStatus("active")}
            className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-500"
          >
            Start race
          </button>
        )}
        {race.status === "active" && (
          <button
            onClick={() => setRaceStatus("finished")}
            className="rounded-md bg-white/10 px-3 py-2 text-sm font-semibold text-white inset-ring inset-ring-white/15 hover:bg-white/20"
          >
            Finish
          </button>
        )}
        {race.status === "finished" && (
          <Link href={`/live/${raceId}`} className="text-sm font-semibold text-indigo-400">
            View results
          </Link>
        )}
      </div>

      {/* Quick-tap chips for known bibs (small velodrome fields) */}
      <div className="mt-4 flex flex-wrap gap-2">
        {entries.map((e) => (
          <button
            key={e.id}
            onClick={() => submit(e.bib)}
            className={classNames(
              "rounded-lg px-3.5 py-2.5 text-lg font-bold tabular-nums transition-colors",
              flash === e.bib
                ? "bg-green-500 text-white"
                : "bg-white/10 text-white inset-ring inset-ring-white/15 active:bg-indigo-500"
            )}
          >
            {e.bib}
            <span className="ml-1.5 text-xs font-normal text-gray-400">
              {lapsByBib.get(e.bib) ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Bib display */}
      <div className="mt-4 flex h-16 items-center justify-center rounded-lg bg-white/5 inset-ring inset-ring-white/10">
        <span className="text-4xl font-bold tabular-nums tracking-widest text-white">
          {flash && !bib ? (
            <span className="text-green-400">#{flash} ✓</span>
          ) : (
            bib || <span className="text-gray-600">bib</span>
          )}
        </span>
      </div>

      {/* Keypad */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            onClick={() => setBib((b) => (b + d).slice(0, 4))}
            className="rounded-lg bg-white/10 py-5 text-2xl font-semibold text-white inset-ring inset-ring-white/15 active:bg-white/25"
          >
            {d}
          </button>
        ))}
        <button
          onClick={() => setBib((b) => b.slice(0, -1))}
          className="flex items-center justify-center rounded-lg bg-white/10 py-5 text-white inset-ring inset-ring-white/15 active:bg-white/25"
        >
          <BackspaceIcon className="size-7" />
        </button>
        <button
          onClick={() => setBib((b) => (b + "0").slice(0, 4))}
          className="rounded-lg bg-white/10 py-5 text-2xl font-semibold text-white inset-ring inset-ring-white/15 active:bg-white/25"
        >
          0
        </button>
        <button
          onClick={() => submit(bib)}
          disabled={!bib}
          className="rounded-lg bg-indigo-600 py-5 text-xl font-bold text-white active:bg-indigo-400 disabled:opacity-40"
        >
          ✓
        </button>
      </div>

      {/* Recent crossings with undo */}
      <ul className="mt-4 divide-y divide-white/10">
        {recent.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 text-sm">
            <span className="text-white">
              <span className="font-bold tabular-nums">#{c.bib}</span>
              <span className="ml-2 text-gray-400">
                lap {lapsByBib.get(c.bib) ?? "?"} ·{" "}
                {new Date(c.client_recorded_at).toLocaleTimeString()}
              </span>
            </span>
            <button
              onClick={() => undo(c.id)}
              className="font-medium text-red-400 hover:text-red-300"
            >
              Undo
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
