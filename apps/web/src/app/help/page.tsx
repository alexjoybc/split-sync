import Link from "next/link";

export const metadata = {
  title: "Help — SplitSync",
  description: "Self-service help for spectators and organizers using SplitSync.",
};

export default function HelpPage() {
  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <header className="race-masthead">
        <div className="mx-auto flex max-w-3xl items-end justify-between gap-4">
          <div>
            <p className="race-kicker--muted">Self-service docs</p>
            <h1 className="race-title">Help</h1>
          </div>
          <Link href="/" className="race-action--muted race-action--outline">
            Back home
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-10 px-4 pt-8 sm:px-6">
        <p className="text-sm font-bold text-zinc-600">
          SplitSync provides live situational awareness and unofficial results
          for grassroots velodrome and cyclocross racing. It is not an
          official certified timing system.
        </p>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">For spectators</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Following live results
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li>No sign-in is required. Live and results pages are public and read-only.</li>
            <li>
              A <strong>live</strong> race board shows real-time laps, gaps, and
              positions as riders cross the line, updated automatically.
            </li>
            <li>
              A <strong>results</strong> page shows the classification after a
              race finishes.
            </li>
            <li>
              An <strong>announcer</strong> view (open a race&apos;s live board
              and switch to it, or visit <code>/announce/&lt;raceId&gt;</code>)
              gives a large-text, high-contrast layout for a race announcer or
              venue screen: current leader, latest crossings, and a bib/name
              rider lookup. Its <strong>TV mode</strong> auto-scrolls the full
              standings and suits an unattended screen.
            </li>
            <li>
              Positions and gaps are derived live from timing crossings and may
              be corrected as more crossings are recorded. Treat all results as
              unofficial.
            </li>
          </ul>
        </section>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">For organizers</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Setting up an event
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li>Sign in with a magic link sent to your email — no password needed.</li>
            <li>
              Create an event once, then build its roster of participants.
              Races are created under an event and pull their entries from that
              same roster.
            </li>
            <li>
              A race can only be edited (name, entries) while it is
              <strong> upcoming</strong>. Starting a race locks its entry list.
            </li>
            <li>
              Publish an event before race day so spectators can find its live
              and results pages. Draft events are only visible to you.
            </li>
            <li>
              Use the scorer screen to record crossings by tapping a rider's
              bib as they cross the line. Free-form bib entry is intentionally
              not supported — only assigned entries appear as tiles.
            </li>
          </ul>
        </section>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">For mobile trackers</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Using the tracker app
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li>
              The SplitSync tracker app records start/finish crossings with a
              single tap and works alongside this website.
            </li>
            <li>
              In-app help within the tracker app is coming soon. Until then,
              refer to the organizer guidance above and the race day runbook
              your event owner shared with you.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
