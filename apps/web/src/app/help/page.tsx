import Link from "next/link";
import { RaceNav } from "@/components/RaceNav";

export default function HelpHub() {
  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <RaceNav links={[{ href: "/", label: "All events" }]} />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="race-kicker--muted">Help</p>
        <h1 className="mt-1 text-2xl font-black uppercase">How SplitSync works</h1>
        <p className="mt-3 text-sm text-race-muted">
          Pick the guide for how you use SplitSync. Spectator and organizer guidance are kept separate since they
          cover different tools.
        </p>
        <ul className="mt-6 divide-y-2 divide-race-ink border-y-2 border-race-ink">
          <li className="py-4">
            <Link href="/help/spectator" className="group flex items-baseline justify-between gap-4">
              <div>
                <h2 className="text-lg font-black uppercase group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">
                  Following a race
                </h2>
                <p className="mt-1 text-xs font-bold uppercase tracking-wide text-race-muted">
                  Live boards, results, and race status — no sign-in required
                </p>
              </div>
              <span className="text-xl font-black">→</span>
            </Link>
          </li>
          <li className="py-4">
            <Link href="/help/organizer" className="group flex items-baseline justify-between gap-4">
              <div>
                <h2 className="text-lg font-black uppercase group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">
                  Running an event
                </h2>
                <p className="mt-1 text-xs font-bold uppercase tracking-wide text-race-muted">
                  Setting up races, scoring, and correcting a race after finishing
                </p>
              </div>
              <span className="text-xl font-black">→</span>
            </Link>
          </li>
        </ul>
      </div>
    </main>
  );
}
