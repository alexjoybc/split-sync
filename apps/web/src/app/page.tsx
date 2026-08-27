import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/Logo";

const screenshots = [
  {
    src: "/screenshots/live-board.webp",
    width: 1600,
    height: 968,
    alt: "SplitSync public live classification board showing overall standings by rank, bib, rider, laps, last lap time, and gap",
    label: "Live board",
    detail: "What spectators watch",
  },
  {
    src: "/screenshots/announcer-view.webp",
    width: 1600,
    height: 954,
    alt: "SplitSync announcer view highlighting the current race leader and top of the field on a dark screen for track-side displays",
    label: "Announcer view",
    detail: "What the mic booth reads",
  },
  {
    src: "/screenshots/admin.webp",
    width: 1600,
    height: 1221,
    alt: "SplitSync organizer admin screen showing the event roster and race-day check-in, listing racers with bib, name, team, category, sex, and check-in status",
    label: "Organizer admin",
    detail: "What the organizer sets up",
  },
];

const features = [
  {
    title: "Public live board",
    kicker: "Spectators",
    body: "A no-login, mobile-first classification board that updates itself. Rank, laps, last-lap time, and gap-to-leader — shareable with one link, no app to install.",
  },
  {
    title: "One-tap bib scoring",
    kicker: "Scorer",
    body: "Every rider is a large tappable tile. Tap the bib as it crosses the line and the crossing is timestamped instantly — on the web or in the mobile tracker.",
  },
  {
    title: "Offline-first sync",
    kicker: "Reliability",
    body: "Crossings queue locally first and sync the moment connectivity returns. A unique idempotency key means a flaky trackside wifi retry never double-counts a lap.",
  },
  {
    title: "Roster once, race often",
    kicker: "Setup",
    body: "Build your rider roster once per event, then assign riders into as many races as you run — categories, heats, and finals — without re-entering names.",
  },
  {
    title: "Real-time everywhere",
    kicker: "Infrastructure",
    body: "Powered by Supabase Realtime. New crossings and race status changes push to every open scorer and live board immediately — no refresh required.",
  },
  {
    title: "One QR code per event",
    kicker: "Sharing",
    body: "Publish an event and get a single QR code for the whole night. Spectators scan once and pick their race from the results hub.",
  },
];

const steps = [
  {
    n: "01",
    title: "Create your event & roster",
    body: "Sign in, name the event, and build your rider roster once — bib, name, team, category.",
  },
  {
    n: "02",
    title: "Set up races and publish",
    body: "Create each race, assign riders from the roster, and publish to generate a shareable QR code.",
  },
  {
    n: "03",
    title: "Score with one tap",
    body: "Start the race and tap bibs as they cross the line, from the web scorer or the mobile tracker.",
  },
  {
    n: "04",
    title: "Spectators watch live",
    body: "Standings, laps, and gaps update automatically on the public live board — no sign-in, no refresh.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "SplitSync",
  applicationCategory: "SportsApplication",
  operatingSystem: "Web, Android, iOS",
  description:
    "Live, unofficial race classification for grassroots velodrome and cyclocross racing. One-tap offline-first bib scoring with a public real-time live board.",
  url: "https://splitsync.org",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function Home() {
  return (
    <main className="race-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="race-topline" />

      {/* Nav */}
      <header className="sticky top-0 z-20 border-b-2 border-race-ink bg-race-panel/95 backdrop-blur">
        <nav
          aria-label="Primary"
          className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6"
        >
          <Logo size="lg" />
          <div className="hidden items-center gap-6 md:flex">
            <a href="#features" className="text-[11px] font-black uppercase tracking-wide text-race-muted hover:text-race-red">
              Capabilities
            </a>
            <a href="#how-it-works" className="text-[11px] font-black uppercase tracking-wide text-race-muted hover:text-race-red">
              How it works
            </a>
            <a href="#sports" className="text-[11px] font-black uppercase tracking-wide text-race-muted hover:text-race-red">
              Sports
            </a>
            <Link href="/events" className="text-[11px] font-black uppercase tracking-wide text-race-muted hover:text-race-red">
              Live events
            </Link>
            <Link href="/help" className="text-[11px] font-black uppercase tracking-wide text-race-muted hover:text-race-red">
              Help
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden text-[11px] font-black uppercase tracking-wide text-race-muted hover:text-race-red sm:inline">
              Sign in
            </Link>
            <Link href="/login" className="race-action">
              Get started
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="border-b-2 border-race-ink bg-race-panel">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <p className="race-kicker">Grassroots race control, live</p>
            <h1 className="mt-3 text-4xl font-black uppercase leading-[1.05] tracking-tight sm:text-6xl">
              See every lap. Know the standings. Instantly.
            </h1>
            <p className="mt-6 text-base font-bold text-race-muted sm:text-lg">
              SplitSync is live classification software for mass-start velodrome and
              cyclocross racing. Score bibs with one tap trackside, and let riders,
              coaches, and spectators watch real-time standings from their phones —
              no app install, no sign-in.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/login" className="race-action">
                Get started free
              </Link>
              <Link href="/events" className="race-action race-action--outline border-race-ink">
                See live events →
              </Link>
            </div>
            <ul className="mt-10 flex flex-wrap gap-x-8 gap-y-2 text-[11px] font-black uppercase tracking-wide text-race-muted">
              <li>No install for spectators</li>
              <li>Works when trackside wifi drops</li>
              <li>Free to run your first event</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Screenshots — sideways diagonal split showing the three surfaces */}
      <section className="border-b-2 border-race-ink bg-race-ink">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="max-w-2xl border-b-2 border-white/20 pb-3">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-race-yellow">See it live</p>
            <h2 className="mt-1 text-2xl font-black uppercase text-white sm:text-3xl">
              This is what actually shows up on race night
            </h2>
          </div>
          <div className="mt-8 flex flex-col">
            {screenshots.map((shot, i) => (
              <div
                key={shot.src}
                className="group relative w-full overflow-hidden border-2 border-race-ink"
                style={{
                  aspectRatio: `${shot.width} / ${shot.height}`,
                  clipPath:
                    i === 0
                      ? "polygon(0 0, 100% 0, 100% calc(100% - 28px), 0 100%)"
                      : i === screenshots.length - 1
                        ? "polygon(0 28px, 100% 0, 100% 100%, 0 100%)"
                        : "polygon(0 28px, 100% 0, 100% calc(100% - 28px), 0 100%)",
                  marginTop: i === 0 ? 0 : "-28px",
                }}
              >
                <Image
                  src={shot.src}
                  alt={shot.alt}
                  fill
                  sizes="(min-width: 1152px) 1152px, 100vw"
                  className="object-cover object-top"
                  priority={i === 0}
                />
                <div className="absolute bottom-0 left-0 bg-race-ink/90 px-6 py-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-race-yellow">
                    {shot.detail}
                  </p>
                  <p className="text-sm font-black uppercase tracking-wide text-white">{shot.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="border-b-2 border-race-ink bg-race-paper">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="race-section-heading max-w-2xl">
            <p className="race-kicker">Why SplitSync</p>
            <h2 className="mt-1 text-2xl font-black uppercase sm:text-3xl">
              Built for the chaos of race night, not a filing cabinet
            </h2>
          </div>
          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            <div>
              <p className="text-sm font-black uppercase tracking-wide text-race-red">The old way</p>
              <p className="mt-2 text-sm font-bold text-race-muted">
                A spreadsheet on a laptop, a clipboard for laps, and riders shouting
                &quot;what place am I in?&quot; from the infield.
              </p>
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-wide text-race-red">The problem</p>
              <p className="mt-2 text-sm font-bold text-race-muted">
                Manual tally sheets don&apos;t survive a dropped lap count, a missed bib,
                or a spotty connection at the track.
              </p>
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-wide text-race-red">SplitSync</p>
              <p className="mt-2 text-sm font-bold text-race-muted">
                One tap per crossing, an offline queue that never loses a lap, and a
                live board everyone can watch from their own phone.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-b-2 border-race-ink bg-race-panel">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="race-section-heading max-w-2xl">
            <p className="race-kicker">Capabilities</p>
            <h2 className="mt-1 text-2xl font-black uppercase sm:text-3xl">
              Everything you need to run and watch a race
            </h2>
          </div>
          <div className="mt-8 grid gap-px overflow-hidden border-2 border-race-ink bg-race-ink sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="bg-race-panel p-6">
                <p className="race-kicker">{f.kicker}</p>
                <h3 className="mt-2 text-lg font-black uppercase">{f.title}</h3>
                <p className="mt-2 text-sm font-bold text-race-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-b-2 border-race-ink bg-race-paper">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="race-section-heading max-w-2xl">
            <p className="race-kicker">How it works</p>
            <h2 className="mt-1 text-2xl font-black uppercase sm:text-3xl">
              From roster to results in four steps
            </h2>
          </div>
          <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <li key={s.n}>
                <span className="text-3xl font-black text-race-red">{s.n}</span>
                <h3 className="mt-2 text-sm font-black uppercase tracking-wide">{s.title}</h3>
                <p className="mt-2 text-sm font-bold text-race-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Trust / invariants */}
      <section className="border-b-2 border-race-ink bg-race-ink text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="max-w-2xl border-b-2 border-white/20 pb-3">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-race-yellow">
              Built to be trusted, not certified
            </p>
            <h2 className="mt-1 text-2xl font-black uppercase sm:text-3xl">
              Every standing traces back to a crossing
            </h2>
          </div>
          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            <div>
              <h3 className="text-sm font-black uppercase tracking-wide text-race-yellow">
                Nothing is pre-calculated
              </h3>
              <p className="mt-2 text-sm font-bold text-white/70">
                Position, lap count, gaps, and last-lap time are all derived live from
                the append-only log of crossings — never a stored, editable standing.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wide text-race-yellow">
                Duplicate-proof by design
              </h3>
              <p className="mt-2 text-sm font-bold text-white/70">
                Every crossing carries a client-generated idempotency key, so retried
                offline syncs never record the same lap twice.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wide text-race-yellow">
                Honest about scope
              </h3>
              <p className="mt-2 text-sm font-bold text-white/70">
                SplitSync provides live situational awareness and unofficial results —
                it is not a certified timing system for sanctioned records.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Sports */}
      <section id="sports" className="border-b-2 border-race-ink bg-race-panel">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="race-section-heading max-w-2xl">
            <p className="race-kicker">Sports</p>
            <h2 className="mt-1 text-2xl font-black uppercase sm:text-3xl">
              Built first for mass-start lap racing
            </h2>
          </div>
          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            <div className="border-2 border-race-ink p-6">
              <p className="race-kicker">Available now</p>
              <h3 className="mt-2 text-xl font-black uppercase">Velodrome</h3>
              <p className="mt-2 text-sm font-bold text-race-muted">
                Scratch races, points races, and elimination formats where lap count
                and gap-to-leader change every few seconds.
              </p>
            </div>
            <div className="border-2 border-race-ink p-6">
              <p className="race-kicker">Available now</p>
              <h3 className="mt-2 text-xl font-black uppercase">Cyclocross</h3>
              <p className="mt-2 text-sm font-bold text-race-muted">
                Mass-start laps on a closed course, with categories that finish at
                different lap counts.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-race-paper">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
          <p className="race-kicker">Ready when you are</p>
          <h2 className="mt-2 text-3xl font-black uppercase sm:text-4xl">
            Run your next race night on SplitSync
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm font-bold text-race-muted">
            Free to create your first event. No credit card, no install for your
            spectators.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/login" className="race-action">
              Get started free
            </Link>
            <Link href="/events" className="race-action race-action--outline border-race-ink">
              Browse live events
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t-2 border-race-ink bg-race-panel">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <Logo size="md" />
            <p className="mt-2 max-w-md text-xs font-bold uppercase tracking-wide text-race-muted">
              Live, unofficial race classification for grassroots velodrome and
              cyclocross.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[11px] font-black uppercase tracking-wide text-race-muted">
            <a href="#features" className="hover:text-race-red">Capabilities</a>
            <a href="#how-it-works" className="hover:text-race-red">How it works</a>
            <Link href="/events" className="hover:text-race-red">Live events</Link>
            <Link href="/help" className="hover:text-race-red">Help</Link>
            <Link href="/login" className="hover:text-race-red">Sign in</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
