"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function NewEvent() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [sport, setSport] = useState("velodrome");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createEvent = async () => {
    setError(null);
    if (!title.trim()) return setError("Event needs a title.");
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

    setSaving(false);
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

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          onClick={createEvent}
          disabled={saving}
          className="w-full rounded-md bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          {saving ? "Creating…" : "Create event and add racers"}
        </button>
      </div>
    </main>
  );
}
