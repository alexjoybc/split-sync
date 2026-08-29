# Functional Tests Runbook

## Overview

The E2E test suite uses Playwright + local Supabase to exercise the full user journey headlessly. It runs on every PR in CI (required to pass before merge).

## Prerequisites

- Docker Desktop (for local Supabase)
- Supabase CLI (`brew install supabase/tap/supabase` or see https://supabase.com/docs/guides/cli)
- pnpm (via `npm install -g pnpm`)

## One-command local run

```bash
pnpm test:e2e
```

This script (`scripts/e2e.mjs`) will:
1. Start local Supabase if not already running
2. Reset the database (apply all migrations + seed data)
3. Start the Next.js app
4. Run Playwright tests headlessly

**Note:** Never run against the hosted Supabase project (`bsihlrzncucrglqltjrc`). The script guards against this automatically.

## UI mode (for debugging)

```bash
pnpm test:e2e:ui
```

Opens the Playwright UI to run, pause, and inspect tests interactively.

## Running a specific spec

```bash
cd apps/web
pnpm test:e2e -- tests/e2e/specs/auth.spec.ts
```

## Test structure

```
apps/web/tests/e2e/
  fixtures/
    auth.ts          # Playwright fixtures: authenticated organizer context
  helpers/
    fixtures.ts      # Programmatic builders: buildEvent, recordCrossings + SEED constants
    mailpit.ts       # Email capture from local Mailpit (port 54324)
    supabase.ts      # User creation helpers (anon key only, no service_role)
  specs/
    smoke.spec.ts             # Landing page smoke test
    auth.spec.ts              # Login form and password reset
    organizer-flow.spec.ts    # Create event, roster, races, publish
    scoring-flow.spec.ts      # Start race, crossings, statuses, finish
    spectator-surfaces.spec.ts # Live board, results, announce, startlist
  README.md                   # Seed data constants and fixture docs
```

## Seed data

After `supabase db reset`, the database contains:

| Constant | Description |
|---|---|
| `SEED.PUBLISHED_EVENT_ID` | Published (live) event with 8 riders and 2 races |
| `SEED.DRAFT_EVENT_ID` | Draft event (not visible to spectators) |
| `SEED.RACE_A_ID` | A Race (5 entries, 3 seed crossings) |
| `SEED.RACE_B_ID` | B Race (3 entries, no crossings) |

## Auth fixtures

Use `authenticatedPage` fixture for organizer-authenticated tests:
```typescript
import { test, expect } from '../fixtures/auth';
test('my test', async ({ authenticatedPage: page }) => { ... });
```

This injects a session via localStorage — no login form UI round-trip.

## CI artifacts

On failure, the CI job uploads a Playwright HTML report to GitHub Actions artifacts (7-day retention). To view it:
1. Go to the failed PR's CI run
2. Click on the `e2e (Playwright + Supabase)` job
3. Download the `playwright-report` artifact
4. Open `index.html` locally
