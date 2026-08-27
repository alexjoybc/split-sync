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
            <li>
              A finished race can briefly return to <strong>live</strong> if the
              organizer reopens it to fix a scoring mistake. Standings refresh
              automatically once it is corrected and finished again.
            </li>
            <li>
              A rider marked <strong>DNS</strong> (did not start),{" "}
              <strong>DNF</strong> (did not finish), or <strong>DSQ</strong>{" "}
              (disqualified) by the organizer stays listed with that badge
              instead of a rank, rather than showing a misleading &quot;0
              laps&quot;.
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
              For fields with many riders (like a CX event), use{" "}
              <strong>Import from CSV</strong> in the roster section instead of
              entering racers one at a time. Columns: <code>bib</code>,{" "}
              <code>first_name</code>/<code>last_name</code> (or a single{" "}
              <code>name</code> column), <code>team</code>,{" "}
              <code>category</code>, and optional <code>sex</code>. The
              preview shows which rows are ready and which are skipped
              (missing bib/name, duplicate bib in the file, or a bib already
              on the roster). You can optionally map each category in the
              file to an upcoming race so imported riders are assigned to
              their race in the same step. Day-of registrations can still be
              added one at a time with the regular add-racer form.
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
            <li>
              Crossings can only be recorded while a race is <strong>active</strong>.
              Tap <strong>Start race</strong> once riders are on the line, and{" "}
              <strong>Finish</strong> once the final crossing is recorded — this
              is enforced by the database, not just the screen.
            </li>
            <li>
              Finished a race too early, or need to add a missed crossing? Tap{" "}
              <strong>Reopen race</strong> on the finished race screen and enter
              a reason — this is required and kept in the race&apos;s audit
              history. Reopening clears the finish time and returns the race to
              active so you can correct it, then finish it again.
            </li>
            <li>
              An accidental crossing can be removed without reopening: use{" "}
              <strong>Undo</strong> next to it in the scorer&apos;s recent list.
              This works whether the race is active or finished.
            </li>
            <li>
              Mark a rider <strong>DNS</strong>, <strong>DNF</strong>, or{" "}
              <strong>DSQ</strong> from the scorer screen at any time —
              before the race starts (DNS), mid-race (DNF/DSQ), or even after
              it finishes to correct a mistake. Statused riders are excluded
              from ranked position on the live/results boards but stay
              visible with their badge, and can&apos;t record further
              crossings. You&apos;ll be asked for an optional reason, which is
              kept with the change.
            </li>
          </ul>
        </section>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">For organizers</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Volunteer roles &amp; invites
            </h2>
          </div>
          <p className="mt-4 text-sm font-semibold text-zinc-700">
            You don&apos;t have to run an event alone. From your event setup
            page&apos;s <strong>Volunteers</strong> section you can generate a
            single-use invite link for each helper and pick their role:
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li><strong>Organizer</strong> — everything you can do except delete the event: roster, races, publishing, and inviting/revoking other volunteers.</li>
            <li><strong>Scorer</strong> — records and undoes crossings, and starts/finishes races. Cannot edit the roster or event details.</li>
            <li><strong>Check-in</strong> — can view the private roster before publish, to help confirm racers as they arrive.</li>
            <li><strong>Read-only official</strong> — can view the event, roster, races, and crossings without changing anything.</li>
          </ul>
          <p className="mt-4 text-sm font-semibold text-zinc-700">
            Send the generated link directly to that person (text, email,
            whatever&apos;s easiest) — generate one link per person rather
            than sharing a single link with a group. Links expire after 14
            days or as soon as they&apos;re used once. Revoking a volunteer or
            an unused invite in the Volunteers section takes effect
            immediately, at the database level, not just in the app.
          </p>
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
