import { RaceNav } from "@/components/RaceNav";

export default function OrganizerHelp() {
  return (
    <main className="race-page">
      <div className="race-topline--muted" />
      <RaceNav links={[{ href: "/help", label: "Help" }, { href: "/", label: "All events" }]} showAuth />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="race-kicker--muted">Help // organizers</p>
        <h1 className="mt-1 text-2xl font-black uppercase">Race control and lifecycle</h1>
        <p className="mt-3 text-sm text-race-muted">
          Every race moves through three states: <strong className="text-race-ink">upcoming</strong>,{" "}
          <strong className="text-race-ink">active</strong>, and <strong className="text-race-ink">finished</strong>.
          These states control what the scorer can do, and the database enforces them the same way regardless of
          which device or app you use.
        </p>

        <h2 className="mt-8 text-sm font-black uppercase tracking-wide">Starting a race</h2>
        <p className="mt-2 text-sm text-race-muted">
          Tap <strong className="text-race-ink">Start race</strong> in the scorer once riders are on the line. This
          locks the roster (no more entry changes) and enables the crossing-capture grid. Crossings cannot be
          recorded before a race is active — a tap while upcoming or finished is rejected.
        </p>

        <h2 className="mt-8 text-sm font-black uppercase tracking-wide">Finishing a race</h2>
        <p className="mt-2 text-sm text-race-muted">
          Tap <strong className="text-race-ink">Finish</strong> once the final crossing sequence is recorded. This
          records the finish time and stops further crossing capture.
        </p>

        <h2 className="mt-8 text-sm font-black uppercase tracking-wide">Correcting a finished race</h2>
        <p className="mt-2 text-sm text-race-muted">
          If you finish a race too early, or need to record a missed crossing after finishing, tap{" "}
          <strong className="text-race-ink">Reopen race</strong> on the finished race screen. You must enter a
          reason — this is required and is kept with the race's audit history so there is a record of why the race
          was reopened. Reopening clears the finish time and returns the race to active; make your correction, then
          finish the race again.
        </p>
        <p className="mt-3 text-sm text-race-muted">
          A crossing that was accidentally recorded can also be removed without reopening: use{" "}
          <strong className="text-race-ink">Undo</strong> next to the crossing in the scorer's recent list. This
          works whether the race is active or finished.
        </p>

        <h2 className="mt-8 text-sm font-black uppercase tracking-wide">Offline scoring</h2>
        <p className="mt-2 text-sm text-race-muted">
          Crossings queue locally if the tracker loses connectivity and sync automatically once it reconnects. Keep
          tapping bibs as riders finish — do not reload the page or clear app storage while a sync is pending.
        </p>
      </div>
    </main>
  );
}
