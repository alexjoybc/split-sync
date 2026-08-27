# SplitSync

Live race classification for grassroots cycling events. SplitSync gives event organizers a fast crossing tracker and gives spectators a public, mobile-first results board.

The active MVP is designed for mass-start lap racing: velodrome and cyclocross. The first real-world target is a velodrome event, followed by Cross on the Rock cyclocross events on Vancouver Island.

## Product Surfaces

| Surface | Audience | Purpose |
| --- | --- | --- |
| Web organizer | Race organizer | Create event, register roster, create races, assign riders, publish event |
| Web scorer | Race organizer | Start/finish race and record a crossing by tapping an assigned rider bib |
| Web spectator | Public | View realtime classifications and event results with no account |
| Mobile tracker | Race organizer | Native Android/iOS companion for start/finish and one-tap bib crossings |

## Race-Day Workflow

1. Sign in at `/login` with a magic link.
2. Create an event at `/new`.
3. Add every participant once to the event roster: bib, name, team, category.
4. Create races and assign rostered participants to each race.
5. Publish the event. It creates one QR code linking to `/results/[eventId]`.
6. Spectators scan the QR code and choose a race from the public results hub.
7. Open `/score/[raceId]` or the mobile tracker, start the race, and tap rider bib tiles as riders cross the line.
8. Finish the race. The final classification remains public at the event results URL.

Race entries lock at start. Riders are never added during live timing.

## Architecture

```text
Web organizer / web scorer / mobile tracker
             |
             | Supabase JS client
             v
Supabase Auth + Postgres + Realtime
             |
             v
Public web spectator classification board
```

- **Web:** Next.js 16, TypeScript, Tailwind CSS v4, Tailwind Plus patterns. `apps/web`
- **Mobile:** Expo SDK 57, React Native, TypeScript. `apps/mobile`
- **Backend:** Hosted Supabase project `bsihlrzncucrglqltjrc`
- **Hosting:** Vercel at `https://splitsync.org`
- **Database migrations:** GitHub Actions applies `supabase/migrations` on merge to `main`
- **Email:** Supabase Auth magic links through Resend SMTP using `noreply@splitsync.org`

See `docs/architecture.md` for table definitions, access model, and realtime behavior.

## Local Development

Prerequisites: Node 20+, pnpm, Docker/OrbStack, Android Studio only for Android builds.

```bash
pnpm install
supabase start
supabase db reset
pnpm dev
```

Web app: `http://localhost:3000`
Supabase Studio: `http://127.0.0.1:54323`

`supabase/seed.sql` creates a fake velodrome event for local visual testing. Do not apply the seed to production.

### Mobile Tracker

Create an ignored `apps/mobile/.env` from `.env.example` with the hosted public Supabase URL and publishable key. Do not add a Supabase secret key.

```bash
pnpm --filter mobile exec tsc --noEmit
pnpm --filter mobile exec expo run:android --device
```

For direct Android development, configure `JAVA_HOME` to JDK 17 and `ANDROID_HOME` to the Android SDK. See `docs/runbooks/mobile-development.md`.

## Deployment

### Web

Vercel project: `split-sync-web`.

Required Vercel variables for Production, Preview, and Development:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

### Database

Required GitHub Actions secrets:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_ID
SUPABASE_DB_PASSWORD
```

The `Apply Supabase migrations` workflow runs for migration changes on `main` and can be run manually for recovery.

### Auth

Supabase Auth URL configuration must include:

```text
https://splitsync.org/auth/callback
http://localhost:3000/auth/callback
org.splitsync.tracker://**
```

See `docs/runbooks/production-setup.md` for the complete setup and recovery steps.

## Key Decisions

- Standings are derived from append-only crossing facts, not stored positions. See ADR 0001.
- Spectators are public read-only; organizers use magic links and RLS ownership. See ADR 0002.
- Expo/React Native is the shared mobile implementation; Android is installed directly via Android Studio for now. See ADR 0003.

## Current Backlog

- Event-scoped volunteer scorer access (PIN/invite), tracked in GitHub issue #17.
- Registration CSV import for CX fields, issue #6.
- Velodrome points-race scoring, issue #13.
- Existing timing-system connectors (CrossMgr, CTS Dolphin, Webscorer), issue #15.
- iOS tracker validation after Android field testing, issue #37.

Read `AGENTS.md` before changing code. It defines the surface boundaries and race-timing invariants.
