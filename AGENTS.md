# SplitSync Agent Guide

## Product Context

SplitSync is live classification software for grassroots mass-start lap racing. The current MVP serves velodrome and cyclocross. It is not an official certified timing system; it provides live situational awareness and unofficial results.

The product has four deliberate surfaces. Do not blend their permissions or goals.

| Surface | Location | Audience | Rules |
| --- | --- | --- | --- |
| Spectator | `apps/web/src/app/live`, `apps/web/src/app/results`, `apps/web/src/app/announce` | Public | No sign-in, read-only, mobile-first, must never expose organizer controls |
| Organizer admin | `apps/web/src/app`, `new`, `event`, `login`, `auth` | Event owner | Creates roster/races, publishes event, owns all writes through RLS |
| Mobile tracker | `apps/mobile` | Event owner now, volunteers later | Start/finish and one-tap crossings only; no roster edits during a race |
| Shared stopwatch | `apps/stopwatch` (native, `org.splitsync.stopwatch`) + `apps/web/src/app/stopwatch` (web) | Creator must sign in; participants anonymous | Creator owns multi-timer session (auth.uid()); participants join by code/link with display name only; event log is truth; no roster |

## Domain Invariants

1. A crossing is the source of truth: `bib` crossed the line at `client_recorded_at`.
2. Positions, lap counts, gaps, and last-lap times are derived from crossings. Never persist a calculated standing.
3. Event roster (`participants`) is created once. A race's `entries` are selected from that roster.
4. A race is editable only while `status = 'upcoming'`. Starting a race locks its entries at both UI and RLS levels.
5. Spectators may read published events only. Draft events and all organizer writes are protected by Supabase RLS.
6. `crossings.client_id` is a UUID idempotency key. Offline queue retries must preserve it to avoid duplicate laps.
7. Unknown/free-form bib entry is intentionally not part of the current scorer UX. Assigned bib tiles are the scorer input.

## Architecture

- `apps/web`: Next.js 16 app. Uses direct browser Supabase client and Supabase Realtime.
- `apps/mobile`: Expo SDK 57 React Native tracker. Uses AsyncStorage for auth persistence and pending crossings.
- `supabase/migrations`: only place for database changes. Never edit an already-deployed migration; add the next migration.
- `supabase/seed.sql`: local dry-run data only. Never run it against hosted production.
- Hosted Supabase project ref: `bsihlrzncucrglqltjrc`.
- Web production domain: `https://splitsync.org`.

## Authentication And Authorization

- Organizer web login uses email+password (and Google OAuth) at `/login` and `/auth/callback`. Magic links are NOT used; the login form calls `supabase.auth.signInWithPassword`.
- Mobile callback scheme is `org.splitsync.tracker://auth/callback`.
- `events.owner_id` holds a JWT subject as text, not an `auth.users` foreign key. This intentionally supports current Supabase Auth and future OAuth/Auth0/OIDC providers.
- Never use a Supabase `service_role`/secret key in web or mobile code.
- Public URL and publishable key are allowed only through `NEXT_PUBLIC_*` (web) and `EXPO_PUBLIC_*` (mobile) variables.

## UI System

- The visual language is professional cycling classification: race-paper background, black rules, dense square tables.
- **Color hierarchy** (see `docs/adr/0021-color-system.md` for full contrast audit):
  - blue-primary (`#0B6FB3`) for all interactive/action elements (buttons, links, focus rings)
  - red (`#CC1A22`) reserved for LIVE badge, errors, DSQ/penalty indicators, and destructive actions only — never generic navigation or branding
  - yellow (`#FFD700`) for leader/highlight emphasis only — ink text always, never white
  - light blue accent (`#5BC8F5`) for instrument surfaces (stopwatch LCD display) — ink text only
- **All canonical color values live in `packages/palette/src/index.ts`.** `apps/web/src/app/globals.css` CSS custom properties are manually derived from that package. Never edit `globals.css` hex values without updating the palette package first.
- **Accessibility**: every status/state indicator (LIVE, DSQ, DNS, DNF, Penalty, Leader) must carry a text label in addition to its color (WCAG 1.4.1). All interactive CSS classes use `:focus-visible` with a 2px blue-primary outline (WCAG 2.4.7).
- Web theme tokens and reusable component classes live in `apps/web/src/app/globals.css`. Reuse `race-*` tokens/classes rather than introducing arbitrary hex values.
- The spectator board may use a stronger black masthead. Organizer screens stay predominantly light and editorial.
- Mobile uses the same palette in `apps/mobile/App.tsx`; centralize new colors in its `colors` object.

## Working Rules

- Create a GitHub issue and branch for non-trivial work. Use PRs; merge only after verification.
- Reference issues in commits. Use `Closes #N` only when the work completes the issue.
- Do not overwrite user/uncommitted changes. The live board may be concurrently edited.
- Verify web work with `pnpm --filter web build`.
- Functional tests (Playwright): `pnpm --filter web test:e2e` (requires local Supabase running). CI runs the full suite on every PR via the `e2e` job in `.github/workflows/ci.yml` and must pass before merge.
- New or changed user-facing web flows must include or update a Playwright E2E spec in `apps/web/tests/e2e/`.
- Verify mobile TypeScript with `pnpm --filter mobile exec tsc --noEmit`.
- Verify stopwatch TypeScript with `pnpm --filter stopwatch exec tsc --noEmit`.
- For native Android changes, rebuild with `pnpm --filter mobile exec expo run:android` and test on the connected device when available.

### Worktree Workflow (mandatory for every task)

Every task, regardless of size, is done in its own git worktree — never directly on `main` in the primary checkout.

1. Create a GitHub issue for the task first (`gh issue create`). Every task gets an issue, even small ones.
2. Branch name and worktree directory: `issue-<number>-<short-slug>` (e.g. `issue-42-fix-lap-gap-calc`).
3. Create the worktree as a sibling of the repo: `git worktree add ../split-sync-worktrees/issue-<number>-<short-slug> -b issue-<number>-<short-slug>`.
4. Do all work (edits, installs, builds, commits) inside that worktree directory, not the main checkout.
5. Push the branch, open a PR referencing the issue (`Closes #N` when the PR fully resolves it), and verify per the rules above before merging.
6. After the PR is merged and verified, clean up: `git worktree remove ../split-sync-worktrees/issue-<number>-<short-slug>` from the main checkout, then delete the local/remote branch if not already deleted by the merge.

## Documentation Requirements

- Every user-facing feature must be self-documented on the website itself, not only in repo `docs/`. Add or update the on-site Help section (`apps/web/src/app/help`) so spectators, organizers, and (once shipped) the mobile tracker's in-app help can each find guidance for their own surface without leaving the product.
- Keep Help content scoped per surface: do not put organizer-only instructions on the spectator-facing Help page, and vice versa.
- Write an ADR (`docs/adr/000N-*.md`) whenever a change affects architecture, security, data model, or a cross-surface contract (e.g., new invariant, new auth flow, new realtime behavior). Skip an ADR for pure UI copy/style tweaks or bug fixes with no behavioral/architectural change.
- Update the relevant runbook (`docs/runbooks/`) whenever a change affects an operational workflow (race day, production setup, mobile build).
- Update `docs/architecture.md` whenever the schema, realtime model, or security model changes.

## Operational Docs

- `docs/architecture.md`: schema, realtime and security model.
- `docs/runbooks/race-day.md`: organizer workflow at an event.
- `docs/runbooks/production-setup.md`: Vercel, Supabase, DNS, Resend, migrations.
- `docs/runbooks/mobile-development.md`: Android/iOS tracker build setup.
- `docs/runbooks/functional-tests.md`: Playwright E2E suite prerequisites, local run, CI artifacts.
- `docs/adr/`: architectural decisions and rationale.
- `apps/web/src/app/help`: on-site self-service Help pages for spectators and organizers.
