import Link from "next/link";
import { RaceNav } from "@/components/RaceNav";

export default function HelpIndex() {
  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <RaceNav />
      <header className="race-masthead">
        <div className="mx-auto max-w-2xl">
          <p className="race-kicker--muted">Help</p>
          <h1 className="race-title">SplitSync help</h1>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="text-sm text-race-muted">Guides are grouped by who&apos;s using SplitSync. Pick the one that matches what you&apos;re doing.</p>
        <ul className="mt-6 space-y-3">
          <li className="race-panel p-4">
            <Link href="/help/organizer/volunteers" className="text-base font-black uppercase text-race-ink underline decoration-2 underline-offset-4">Organizers: volunteer roles &amp; invites</Link>
            <p className="mt-1 text-sm text-race-muted">Invite check-in staff, scorers, and officials to help run your event.</p>
          </li>
        </ul>
      </div>
    </main>
  );
}
