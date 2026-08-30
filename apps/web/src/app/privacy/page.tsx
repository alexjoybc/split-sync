import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — SplitSync",
  description:
    "How SplitSync collects, stores, and uses data across the web app and mobile tracker.",
};

export default function PrivacyPage() {
  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <header className="race-masthead">
        <div className="mx-auto flex max-w-3xl items-end justify-between gap-4">
          <div>
            <p className="race-kicker--muted">Legal</p>
            <h1 className="race-title">Privacy Policy</h1>
          </div>
          <Link href="/" className="race-action--muted race-action--outline">
            Back home
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-10 px-4 pt-8 pb-16 sm:px-6">
        <p className="text-sm font-bold text-zinc-600">
          Last updated: 2026-08-30
        </p>

        <p className="text-sm font-semibold text-zinc-700">
          SplitSync (&quot;we&quot;, &quot;us&quot;) provides live, unofficial
          race classification software for grassroots velodrome and
          cyclocross racing, at{" "}
          <a href="https://splitsync.org" className="underline">
            splitsync.org
          </a>{" "}
          (the web app), the SplitSync Tracker mobile app, and the SplitSync
          Stopwatch app. This policy explains what data each surface
          collects and how it is used.
        </p>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">Spectator surfaces</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Live, results, and announce pages
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li>No account, sign-in, or personal information is required or collected.</li>
            <li>
              These pages read published event data only: rider bib numbers,
              names, teams, categories, and timing crossings that an event
              organizer has entered.
            </li>
          </ul>
        </section>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">Organizer admin (web) and SplitSync Tracker (mobile)</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Account and race data
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li>
              Signing in requires an email address and password, or a Google
              account, handled by our database provider, Supabase. We do not
              receive or store your password.
            </li>
            <li>
              Your session is kept on your device (browser storage on web,
              app storage on mobile) so you stay signed in between visits.
            </li>
            <li>
              Event data you enter as an organizer — rider rosters (bib,
              name, team, category), race configuration, and timing
              crossings — is stored in our Supabase database and is used only
              to run and display your event.
            </li>
            <li>
              The mobile tracker queues timing crossings on your device while
              offline and syncs them once a connection is available. This
              queue never leaves your device except to sync to your own
              event.
            </li>
            <li>We do not sell personal data or use it for advertising.</li>
          </ul>
        </section>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">SplitSync Stopwatch</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Anonymous sessions
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li>No sign-in, account, or roster is required.</li>
            <li>
              A stopwatch session is identified only by a short code you
              choose to share. Lap times you record are stored against that
              code so anyone with it can view the same session.
            </li>
          </ul>
        </section>

        <section>
          <div className="race-section-heading">
            <p className="race-kicker--muted">Retention and contact</p>
            <h2 className="mt-1 text-xl font-black uppercase">
              Data retention and questions
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-zinc-700">
            <li>
              Event and race data is retained until the organizer who created
              it deletes it or requests removal.
            </li>
            <li>
              To request deletion of your account or event data, or ask a
              privacy question, email{" "}
              <a href="mailto:support@splitsync.org" className="underline">
                support@splitsync.org
              </a>
              .
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
