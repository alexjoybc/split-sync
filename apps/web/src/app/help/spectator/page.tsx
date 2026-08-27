import { RaceNav } from "@/components/RaceNav";

export default function SpectatorHelp() {
  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <RaceNav links={[{ href: "/help", label: "Help" }, { href: "/", label: "All events" }]} />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="race-kicker--muted">Help // spectators</p>
        <h1 className="mt-1 text-2xl font-black uppercase">Following a race</h1>
        <p className="mt-3 text-sm text-race-muted">
          No account or app is needed to follow a SplitSync event. Scan the event QR code, or open the link the
          organizer shared, to see the event's races and live results.
        </p>

        <h2 className="mt-8 text-sm font-black uppercase tracking-wide">Race status</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-race-muted">
          <li><strong className="text-race-ink">Upcoming</strong> — the race has not started. Standings are not shown yet.</li>
          <li><strong className="text-race-ink">Live</strong> — the race is underway. Positions, laps, and gaps update as crossings are recorded.</li>
          <li><strong className="text-race-ink">Finished</strong> — the race is complete. Results reflect the final lap count.</li>
        </ul>
        <p className="mt-3 text-sm text-race-muted">
          A race that is already finished can occasionally briefly return to live if the organizer reopens it to fix a
          scoring mistake. Standings will refresh automatically once corrected and re-finished.
        </p>

        <h2 className="mt-8 text-sm font-black uppercase tracking-wide">SplitSync is unofficial timing</h2>
        <p className="mt-2 text-sm text-race-muted">
          SplitSync provides live situational awareness and unofficial results for grassroots events. It is not a
          certified timing system.
        </p>
      </div>
    </main>
  );
}
