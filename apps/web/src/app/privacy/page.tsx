import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — SplitSync",
  description:
    "Privacy policy for SplitSync Stopwatch and SplitSync Tracker — what data is collected, how it is stored, and how to request deletion.",
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
        <p className="text-sm font-bold text-race-muted">
          Last updated: August 2026. This policy covers the SplitSync Stopwatch
          Android app (<strong>org.splitsync.stopwatch</strong>) and the
          SplitSync Tracker Android app (<strong>org.splitsync.tracker</strong>),
          as well as the associated web services at{" "}
          <strong>splitsync.org</strong>.
        </p>

        {/* ── Section 1 ── */}
        <section>
          <div className="race-section-heading">
            <h2 className="mt-1 text-xl font-black uppercase">
              What data we collect
            </h2>
          </div>

          <div className="mt-4 space-y-6 text-sm font-semibold text-race-ink">
            <div>
              <p className="font-black uppercase tracking-wide">
                SplitSync Stopwatch
              </p>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>
                  <strong>Email address</strong> — collected when a session
                  creator signs in. Required to create and manage shared timing
                  sessions. Participants who join a session by link do not need
                  an account and their email is never collected.
                </li>
                <li>
                  <strong>Display name</strong> — the name you enter when
                  creating or joining a session (e.g. &quot;Coach Alex&quot;). This name
                  is visible to other participants in the same session and is
                  stored with session events.
                </li>
                <li>
                  <strong>Session events</strong> — start, lap, stop, and reset
                  actions, each recorded with a timestamp and the display name
                  of the participant who triggered them. These form the session
                  record.
                </li>
              </ul>
              <p className="mt-3">
                The solo stopwatch (no account required) sends{" "}
                <strong>no data to any server</strong>. All state is stored
                locally on your device only.
              </p>
            </div>

            <div>
              <p className="font-black uppercase tracking-wide">
                SplitSync Tracker
              </p>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                <li>
                  <strong>Email address</strong> — collected at sign-in for
                  event organizers and authorized volunteers.
                </li>
                <li>
                  <strong>Lap crossing records</strong> — bib number and
                  timestamp for each crossing recorded by the tracker. These are
                  the source of truth for race standings and are stored under
                  the associated event.
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* ── Section 2 ── */}
        <section>
          <div className="race-section-heading">
            <h2 className="mt-1 text-xl font-black uppercase">
              Where data is stored
            </h2>
          </div>
          <p className="mt-4 text-sm font-semibold text-race-ink">
            All data is stored in{" "}
            <strong>Supabase</strong> (
            <a
              href="https://supabase.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-2 underline-offset-2"
            >
              supabase.com
            </a>
            ), a managed database platform hosted on Amazon Web Services (AWS)
            infrastructure in the United States. Supabase is the only
            third-party data processor used by SplitSync.
          </p>
          <p className="mt-3 text-sm font-semibold text-race-ink">
            No data is sold to, shared with, or processed by advertisers,
            analytics providers, or any other third party. No advertising SDKs
            or analytics SDKs are embedded in either app.
          </p>
        </section>

        {/* ── Section 3 ── */}
        <section>
          <div className="race-section-heading">
            <h2 className="mt-1 text-xl font-black uppercase">
              How long data is retained
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-race-ink">
            <li>
              <strong>Account data (email)</strong> is retained until you
              request deletion.
            </li>
            <li>
              <strong>Shared session records</strong> (events, participants,
              display names) persist on the server until you request deletion.
              Sessions themselves are considered ephemeral — they are not
              actively archived or backed up for long-term retention beyond
              normal database operation — but they are not automatically deleted
              on a schedule.
            </li>
            <li>
              <strong>Race crossing records</strong> (Tracker) are retained as
              part of the event record until you request deletion.
            </li>
            <li>
              <strong>Solo stopwatch data</strong> is stored only on your
              device. Uninstalling the app or clearing app data removes it
              completely — no server-side copy exists.
            </li>
          </ul>
        </section>

        {/* ── Section 4 ── */}
        <section>
          <div className="race-section-heading">
            <h2 className="mt-1 text-xl font-black uppercase">
              How to request data deletion
            </h2>
          </div>
          <p className="mt-4 text-sm font-semibold text-race-ink">
            To request deletion of your account and all associated data, email
            us at{" "}
            <a
              href="mailto:support@splitsync.org"
              className="underline decoration-2 underline-offset-2"
            >
              support@splitsync.org
            </a>{" "}
            with the subject line <strong>&quot;Data deletion request&quot;</strong> and
            include the email address associated with your account.
          </p>
          <p className="mt-3 text-sm font-semibold text-race-ink">
            Deletion covers: your Supabase authentication record, all sessions
            you created, all session events, and all participant records linked
            to your account. Display names entered by participants who joined
            your sessions (without an account) are deleted as part of the
            session record. We will confirm deletion within 30 days.
          </p>
        </section>

        {/* ── Section 5 ── */}
        <section>
          <div className="race-section-heading">
            <h2 className="mt-1 text-xl font-black uppercase">
              Permissions requested by the apps
            </h2>
          </div>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-semibold text-race-ink">
            <li>
              <strong>Internet access</strong> — required for shared sessions
              and sign-in. The solo stopwatch uses it only to load the app
              initially.
            </li>
            <li>
              <strong>Post notifications (Stopwatch)</strong> — used to show an
              ongoing timer notification while a stopwatch is running so you can
              see the elapsed time from the notification shade. Declining this
              permission never blocks timing.
            </li>
            <li>
              <strong>No location, camera, microphone, or contacts</strong> —
              neither app requests access to these.
            </li>
          </ul>
        </section>

        {/* ── Section 6 ── */}
        <section>
          <div className="race-section-heading">
            <h2 className="mt-1 text-xl font-black uppercase">
              Children&apos;s privacy
            </h2>
          </div>
          <p className="mt-4 text-sm font-semibold text-race-ink">
            SplitSync is not directed at children under 13. We do not knowingly
            collect personal information from children under 13. If you believe
            a child&apos;s data has been collected, contact us at{" "}
            <a
              href="mailto:support@splitsync.org"
              className="underline decoration-2 underline-offset-2"
            >
              support@splitsync.org
            </a>{" "}
            and we will delete it promptly.
          </p>
        </section>

        {/* ── Section 7 ── */}
        <section>
          <div className="race-section-heading">
            <h2 className="mt-1 text-xl font-black uppercase">
              Changes to this policy
            </h2>
          </div>
          <p className="mt-4 text-sm font-semibold text-race-ink">
            If this policy changes materially, we will update the date at the
            top of this page. Continued use of the apps after a change
            constitutes acceptance of the updated policy.
          </p>
        </section>

        {/* ── Section 8 ── */}
        <section>
          <div className="race-section-heading">
            <h2 className="mt-1 text-xl font-black uppercase">Contact</h2>
          </div>
          <p className="mt-4 text-sm font-semibold text-race-ink">
            Questions about this privacy policy or requests regarding your data:
          </p>
          <p className="mt-2 text-sm font-semibold text-race-ink">
            <a
              href="mailto:support@splitsync.org"
              className="underline decoration-2 underline-offset-2"
            >
              support@splitsync.org
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
