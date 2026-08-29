# E2E Test Helpers

## Prerequisites

Run `supabase db reset` before executing specs. This applies migrations and
`supabase/seed.sql`, which inserts the stable fixture data described below.

## Seed data (stable UUIDs)

All seed constants are exported from `helpers/fixtures.ts` as `SEED`.

| Constant | UUID suffix | Description |
|---|---|---|
| `SEED.PUBLISHED_EVENT_ID` | `…000001` | Live event — visible to spectators |
| `SEED.DRAFT_EVENT_ID`     | `…000002` | Draft event — hidden from spectators (negative tests) |
| `SEED.RACE_A_ID`          | `…000001` | A Race — 5 entries, 3 crossings seeded |
| `SEED.RACE_B_ID`          | `…000002` | B Race — 3 entries, no crossings |

The seed follows domain invariant #3: participants are inserted into the
`participants` roster before entries are created for each race.

## Fixture builders

`helpers/fixtures.ts` exports two programmatic builders for specs that need
isolated, bespoke state and cannot rely on the shared seed:

### `buildEvent(opts?)`

Creates an independent event, roster, race, and entries. Returns `{ eventId, raceId }`.

```typescript
import { buildEvent } from '../helpers/fixtures';

const { eventId, raceId } = await buildEvent({
  title: 'My Isolated Test Event',
  status: 'live',
  bibs: ['10', '20', '30'],
});
```

Options:

| Option | Default | Description |
|---|---|---|
| `title` | `"Test Event <timestamp>"` | Event title |
| `status` | `'draft'` | `'draft' \| 'live' \| 'finished'` |
| `bibs` | `['1','2','3']` | Bib numbers (roster + entries) |

### `recordCrossings(raceId, bibs)`

Inserts one crossing per bib (1 s apart) so standings are deterministic.

```typescript
import { recordCrossings } from '../helpers/fixtures';

await recordCrossings(raceId, ['10', '20', '30']);
// bib 10 finishes first, bib 30 finishes last
```

## Usage pattern

Use `SEED` constants when your spec reads shared seed data (fast, no DB
writes). Use fixture builders when your spec needs a specific pre-condition
(e.g. a race already started, or a unique title to assert on).

```typescript
import { test, expect } from '@playwright/test';
import { SEED, buildEvent, recordCrossings } from './helpers/fixtures';

// Reading seed data
test('spectator sees published event', async ({ page }) => {
  await page.goto(`/live/${SEED.PUBLISHED_EVENT_ID}`);
  // …
});

// Bespoke state
test('live board shows standings after crossings', async ({ page }) => {
  const { eventId, raceId } = await buildEvent({ status: 'live', bibs: ['1','2'] });
  await recordCrossings(raceId, ['1', '2']);
  await page.goto(`/live/${eventId}`);
  // …
});
```
