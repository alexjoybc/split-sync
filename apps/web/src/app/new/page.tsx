"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/useAuth";
import { RaceNav } from "@/components/RaceNav";

export default function NewEvent() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [sport, setSport] = useState("velodrome");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, loading } = useAuth();

  const createEvent = async () => {
    setError(null);
    if (!user) return router.push("/login?next=/new");
    if (!title.trim()) return setError("Event needs a title.");
    setSaving(true);
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .insert({ title: title.trim(), location: location.trim() || null, sport_type: sport, status: "draft", owner_id: user.id })
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
    "race-input--muted";

  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <RaceNav links={[{ href: "/events", label: "All events" }]} showAuth />
      <header className="race-masthead"><div className="mx-auto max-w-lg"><p className="race-kicker--muted">Race calendar</p><h1 className="race-title">New event</h1></div></header>
      <div className="mx-auto max-w-lg px-4 py-8 sm:px-6">

       {!loading && !user ? <div className="race-panel p-5"><p className="text-sm text-race-muted">Sign in before creating an event.</p><button onClick={() => router.push("/login?next=/new")} className="race-action--primary mt-4">Sign in</button></div> : <>

      <div className="mt-6 space-y-4">
        <div>
          <label className="block text-xs font-black uppercase tracking-wide">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Friday Night Racing" className={`mt-1 ${inputCls}`} />
        </div>
        <div>
          <label className="block text-xs font-black uppercase tracking-wide">Location</label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Greater Victoria Velodrome" className={`mt-1 ${inputCls}`} />
        </div>
        <div>
          <label className="block text-xs font-black uppercase tracking-wide">Sport</label>
          <select value={sport} onChange={(e) => setSport(e.target.value)} className={`mt-1 ${inputCls}`}>
            <option value="velodrome">Velodrome</option>
            <option value="cyclocross">Cyclocross</option>
            <option value="running">Running</option>
            <option value="other">Other</option>
          </select>
        </div>

        {error && <p className="border-l-4 border-race-ink bg-white px-3 py-2 text-sm font-bold text-race-ink">{error}</p>}

        <button
          onClick={createEvent}
          disabled={saving || loading}
          className="race-action--primary w-full disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create event and add racers"}
        </button>
      </div>
      </>}
      </div>
    </main>
  );
}
