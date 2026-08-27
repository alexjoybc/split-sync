import Link from "next/link";
import { RaceNav } from "@/components/RaceNav";

const roles = [
  { name: "Organizer", can: "Everything you can do except delete the event: edit details, manage the roster, create races, assign racers, score, and invite/revoke other volunteers." },
  { name: "Scorer", can: "Record and undo crossings, and start/finish races. Cannot edit the roster or event details." },
  { name: "Check-in", can: "View the private roster before the event is published, to help confirm racers as they arrive." },
  { name: "Read-only official", can: "View the event, roster, races, and crossings without being able to change anything." },
];

export default function VolunteerHelp() {
  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <RaceNav links={[{ href: "/help", label: "All help" }]} />
      <header className="race-masthead">
        <div className="mx-auto max-w-2xl">
          <p className="race-kicker--muted">Organizer help</p>
          <h1 className="race-title">Volunteer roles &amp; invites</h1>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 space-y-6">
        <section className="race-panel p-4">
          <h2 className="text-base font-black uppercase">Inviting a volunteer</h2>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-race-muted">
            <li>Open your event setup page and scroll to <b>Volunteers</b>.</li>
            <li>Pick a role and select <b>Generate invite link</b>.</li>
            <li>Copy the link and send it to the volunteer (text, email, whatever&apos;s easiest).</li>
            <li>They open the link, sign in with any Google or email account, and select <b>Accept</b>.</li>
          </ol>
          <p className="mt-3 text-sm text-race-muted">Each link works once and expires after 14 days. Generate a new link per person &mdash; do not share one link with a group.</p>
        </section>
        <section className="race-panel p-4">
          <h2 className="text-base font-black uppercase">What each role can do</h2>
          <ul className="mt-2 space-y-3">
            {roles.map((role) => (
              <li key={role.name}>
                <p className="text-sm font-black uppercase text-race-ink">{role.name}</p>
                <p className="text-sm text-race-muted">{role.can}</p>
              </li>
            ))}
          </ul>
        </section>
        <section className="race-panel p-4">
          <h2 className="text-base font-black uppercase">Revoking access</h2>
          <p className="mt-2 text-sm text-race-muted">In the Volunteers section, select <b>Revoke</b> next to an active volunteer or an unused invite link. Revoking is immediate: their next request is denied at the database level, not just hidden in the app.</p>
        </section>
        <p className="text-xs text-race-muted"><Link href="/help" className="underline decoration-2 underline-offset-4">Back to all help</Link></p>
      </div>
    </main>
  );
}
