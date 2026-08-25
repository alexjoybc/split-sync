"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, TrashIcon } from "@heroicons/react/20/solid";
import { supabase } from "@/lib/supabase";

interface RaceDraft {
  name: string;
  laps: string;
}

export default function NewEvent() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [sport, setSport] = useState("velodrome");
  const [races, setRaces] = useState<RaceDraft[]>([{ name: "", laps: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createEvent = async () => {
    setError(null);
    if (!title.trim()) return setError("Event needs a title.");
    const validRaces = races.filter((r) => r.name.trim());
    if (validRaces.length === 0) return setError("Add at least one race.");

    setSaving(true);
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .insert({ title: title.trim(), location: location.trim() || null, sport_type: sport, status: "live" })
      .select()
      .single();

    if (eventErr || !event) {
      setSaving(false);
      return setError(eventErr?.message ?? "Failed to create event");
    }

    const { error: racesErr } = await supabase.from("races").insert(
      validRaces.map((r, i) => ({
        event_id: event.id,
        name: r.name.trim(),
        sequence_order: i + 1,
        laps_planned: r.laps ? parseInt(r.laps, 10) : null,
      }))
    );

    setSaving(false);
    if (racesErr) return setError(racesErr.message);
    router.push(`/event/${event.id}`);
  };

  const inputCls =
    "block w-full rounded-md bg-white px-3 py-2 text-sm text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500";

  return (
    <main className="mx-auto max-w-lg px-4 py-10 sm:px-6">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">New event</h1>

      <div className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-white">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Friday Night Racing" className={`mt-1 ${inputCls}`} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-white">Location</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Greater Victoria Velodrome" className={`mt-1 ${inputCls}`} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-white">Sport</label>
          <select value={sport} onChange={(e) => setSport(e.target.value)} className={`mt-1 ${inputCls}`}>
            <option value="velodrome">Velodrome</option>
            <option value="cyclocross">Cyclocross</option>
            <option value="running">Running</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-white">Races</label>
          <div className="mt-1 space-y-2">
            {races.map((race, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={race.name}
                  onChange={(e) => setRaces(races.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                  placeholder={`Race ${i + 1} — e.g. "A Scratch"`}
                  className={inputCls}
                />
                <input
                  value={race.laps}
                  onChange={(e) => setRaces(races.map((r, j) => (j === i ? { ...r, laps: e.target.value.replace(/\D/g, "") } : r)))}
                  placeholder="Laps"
                  inputMode="numeric"
                  className={`${inputCls} !w-20`}
                />
                <button
                  onClick={() => setRaces(races.filter((_, j) => j !== i))}
                  disabled={races.length === 1}
                  className="text-gray-400 hover:text-red-500 disabled:opacity-30"
                >
                  <TrashIcon className="size-5" />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setRaces([...races, { name: "", laps: "" }])}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            <PlusIcon className="size-4" /> Add race
          </button>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          onClick={createEvent}
          disabled={saving}
          className="w-full rounded-md bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          {saving ? "Creating…" : "Create event"}
        </button>
      </div>
    </main>
  );
}
