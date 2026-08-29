/**
 * E2E spec: scoring flow
 *
 * Covers the organizer scoring console at /score/[raceId]:
 *   1. Start race — verify "Start race" button activates the race and locks
 *      entry editing (the race-lock invariant).
 *   2. Record crossings via bib tiles — verify lap counts update.
 *   3. Set entry status (DNS/DNF/DSQ) via the rider detail sheet.
 *   4. Crossing idempotency — a retried insert with the same client_id is
 *      rejected by the unique constraint; no duplicate crossing is created.
 *   5. Finish the race.
 *
 * These specs require a running local Supabase stack (`supabase start`).
 * They are NOT included in CI yet — that is tracked by issue #153.
 * CI validates only lint / typecheck / build for this file.
 *
 * Auth note: the scoring console uses RLS that checks events.owner_id against
 * auth.jwt()->>'sub'. We therefore create each test event with an authenticated
 * Supabase client (accessToken from signInProgrammatically) so the organizer
 * user owns the event and the console grants full access.
 */
import { test as base, type Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  uniqueTestEmail,
  createTestOrganizer,
  signInProgrammatically,
} from '../helpers/supabase';
import { authedDb, buildEvent } from '../helpers/fixtures';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7b6b7xNHPnjyxvFnDpvnuN51o4MXVToypGc';

// `authedDb` is imported from helpers/fixtures — no need to duplicate the
// client-construction logic here.

/** Anon client for reads that don't require authentication. */
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// Combined fixture: authenticated page + owned event
// ---------------------------------------------------------------------------

type ScoringFixtures = {
  /**
   * A page with a valid Supabase session injected, plus the IDs of a fresh
   * event and race owned by the authenticated user.
   */
  scoringContext: {
    page: Page;
    accessToken: string;
    eventId: string;
    raceId: string;
  };
};

const test = base.extend<ScoringFixtures>({
  scoringContext: async ({ page }, use) => {
    const email = uniqueTestEmail('scoring');
    const password = 'TestPass123!';

    // 1. Create organizer user and sign in to get a JWT.
    await createTestOrganizer(email, password);
    const { session } = await signInProgrammatically(email, password);
    if (!session) throw new Error('signInProgrammatically returned no session');
    const accessToken = session.access_token;

    // 2. Build an isolated event owned by that user.
    //    status='live' makes it published (visible to scorers); race is created
    //    in status='upcoming' by default so we can test the Start button.
    const { eventId, raceId } = await buildEvent({
      status: 'live',
      bibs: ['10', '20', '30'],
      accessToken,
    });

    // 3. Inject the Supabase session into the browser via localStorage so
    //    the scoring console recognises the user without a login round-trip.
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';

    await page.goto('/');
    await page.evaluate(
      ([url, sess]: [string, unknown]) => {
        const hostname = new URL(url).hostname;
        const projectRef = hostname.split('.')[0];
        const key = `sb-${projectRef}-auth-token`;
        localStorage.setItem(key, JSON.stringify(sess));
      },
      [supabaseUrl, session] as [string, unknown],
    );
    await page.reload();

    await use({ page, accessToken, eventId, raceId });
  },
});

// ---------------------------------------------------------------------------
// Suite 1 — Full scoring flow: start → crossings → finish
// ---------------------------------------------------------------------------

test.describe('Scoring flow — start, crossings, finish', () => {
  test('start race, record crossings, verify lap counts, finish', async ({
    scoringContext: { page, raceId },
  }) => {
    // Navigate to the scoring console.
    await page.goto(`/score/${raceId}`);

    // ── 1. Pre-start state ──────────────────────────────────────────────────
    // The "Start race" button must be visible; the bib tiles should show
    // "Race not started" (no crossings recordable yet).
    await expect(
      page.getByRole('button', { name: 'Start race' }),
    ).toBeVisible({ timeout: 10_000 });

    // Tile for bib 10 shows "Race not started" while race is upcoming.
    const tile10 = page.getByRole('button', {
      name: /Record crossing for #10/,
    });
    await expect(tile10).toBeDisabled();

    // ── 2. Start the race ───────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Start race' }).click();

    // After starting, the "Finish" button should appear and "Start race"
    // should be gone — confirming the race is now active.
    await expect(
      page.getByRole('button', { name: 'Finish' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('button', { name: 'Start race' }),
    ).not.toBeVisible();

    // ── 3. Race-lock invariant: bib tiles become interactive, not edit UIs ──
    // Entries are locked (no roster edits) once active, but crossing tiles
    // are now enabled for lap recording.
    await expect(tile10).toBeEnabled();

    // ── 4. Record a crossing via bib tile ───────────────────────────────────
    await tile10.click();
    // After a tap, the tile text updates to "Lap 1" (derived from crossings).
    await expect(page.getByText(/Lap 1/)).toBeVisible({ timeout: 8_000 });

    // ── 5. Record a second crossing for bib 10 ─────────────────────────────
    await tile10.click();
    await expect(page.getByText(/Lap 2/)).toBeVisible({ timeout: 8_000 });

    // ── 6. Record a crossing for bib 20 ────────────────────────────────────
    const tile20 = page.getByRole('button', {
      name: /Record crossing for #20/,
    });
    await tile20.click();
    // Bib 20 now has Lap 1 in the recent crossings list.
    await expect(
      page.getByText(/#20/).first(),
    ).toBeVisible({ timeout: 8_000 });

    // ── 7. Finish the race ──────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Finish' }).click();

    // Post-finish: "Reopen race" button appears; "Finish" is gone.
    await expect(
      page.getByRole('button', { name: 'Reopen race' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('button', { name: 'Finish' }),
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Race-lock invariant
// ---------------------------------------------------------------------------

test.describe('Race-lock invariant', () => {
  test('bib tiles are disabled (race not started) until Start race is clicked', async ({
    scoringContext: { page, raceId },
  }) => {
    await page.goto(`/score/${raceId}`);

    // All bib crossing buttons must be disabled before the race starts.
    await expect(
      page.getByRole('button', { name: 'Start race' }),
    ).toBeVisible({ timeout: 10_000 });

    const tile10 = page.getByRole('button', {
      name: /Record crossing for #10/,
    });
    const tile20 = page.getByRole('button', {
      name: /Record crossing for #20/,
    });
    const tile30 = page.getByRole('button', {
      name: /Record crossing for #30/,
    });

    await expect(tile10).toBeDisabled();
    await expect(tile20).toBeDisabled();
    await expect(tile30).toBeDisabled();

    // Start the race.
    await page.getByRole('button', { name: 'Start race' }).click();
    await expect(
      page.getByRole('button', { name: 'Finish' }),
    ).toBeVisible({ timeout: 10_000 });

    // Now tiles should be enabled.
    await expect(tile10).toBeEnabled();
    await expect(tile20).toBeEnabled();
    await expect(tile30).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Entry statuses (DNS / DNF / DSQ) via detail sheet
// ---------------------------------------------------------------------------

test.describe('Entry status changes', () => {
  test('set entry to DNF via detail sheet; tile reflects DNF status', async ({
    scoringContext: { page, raceId },
  }) => {
    await page.goto(`/score/${raceId}`);
    await expect(
      page.getByRole('button', { name: 'Start race' }),
    ).toBeVisible({ timeout: 10_000 });

    // Start the race first (status changes only meaningful while active).
    await page.getByRole('button', { name: 'Start race' }).click();
    await expect(
      page.getByRole('button', { name: 'Finish' }),
    ).toBeVisible({ timeout: 10_000 });

    // Open the detail sheet for bib 20 via the ••• corner button.
    await page
      .getByRole('button', { name: /Open detail for #20/ })
      .click();

    // The rider detail sheet should appear.
    await expect(page.getByText('Rider detail')).toBeVisible({
      timeout: 5_000,
    });

    // Click the DNF status chip.
    // The button uses aria-label "Set status to DNF for #20 Rider 20".
    // window.prompt is called for the reason; we accept the default (empty).
    page.once('dialog', (dialog) => dialog.accept(''));
    await page
      .getByRole('button', { name: /Set status to DNF for #20/ })
      .click();

    // Close the sheet.
    await page.getByRole('button', { name: 'Close rider detail' }).click();

    // After closing, the tile for bib 20 should show "DNF".
    // The tile text falls through to entry.status.toUpperCase() when statused.
    await expect(page.getByText('DNF').first()).toBeVisible({
      timeout: 8_000,
    });
  });

  test('set entry to DNS before race starts', async ({
    scoringContext: { page, raceId },
  }) => {
    await page.goto(`/score/${raceId}`);
    await expect(
      page.getByRole('button', { name: 'Start race' }),
    ).toBeVisible({ timeout: 10_000 });

    // DNS can be set before start (common pre-race workflow).
    await page
      .getByRole('button', { name: /Open detail for #30/ })
      .click();
    await expect(page.getByText('Rider detail')).toBeVisible({
      timeout: 5_000,
    });

    page.once('dialog', (dialog) => dialog.accept(''));
    await page
      .getByRole('button', { name: /Set status to DNS for #30/ })
      .click();

    await page.getByRole('button', { name: 'Close rider detail' }).click();

    await expect(page.getByText('DNS').first()).toBeVisible({
      timeout: 8_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — Crossing idempotency
// ---------------------------------------------------------------------------

test.describe('Crossing idempotency', () => {
  /**
   * This test does NOT go through the UI for the duplicate insert — it
   * exercises the database constraint directly. The scoring console's
   * crossingQueue already guarantees unique client_ids per crossing attempt,
   * but this test validates the hard invariant at the DB layer so that an
   * offline retry (same client_id replayed) can never produce a phantom lap.
   */
  test('duplicate client_id crossing is rejected; only one crossing persists', async ({
    scoringContext: { accessToken, raceId },
  }) => {
    // Authenticated client — crossings write RLS checks event ownership via
    // auth.jwt()->>'sub', so inserts must carry the organizer's access token.
    // Imported from helpers/fixtures (not duplicated inline).
    const db = authedDb(accessToken);

    // Activate the race so the crossing insert policy is satisfied.
    await db.from('races').update({ status: 'active' }).eq('id', raceId);

    // ── Race-lock invariant (DB layer) ──────────────────────────────────────
    // Migration 20260825000005_lock_race_roster.sql replaces the broad
    // "organizer manage entries" policy with one that gates on
    // races.status = 'upcoming'. Once a race is active the RLS policy's
    // WITH CHECK expression evaluates to false, so any INSERT into entries
    // for that race must be rejected — regardless of what the UI does.
    const { error: lockError } = await db.from('entries').insert({
      race_id: raceId,
      bib: '99',
      name: 'Late Entrant',
    });
    // RLS must reject the insert; a null error here would mean the lock is broken.
    expect(lockError).not.toBeNull();

    const clientId = crypto.randomUUID();
    const crossingPayload = {
      race_id: raceId,
      bib: '10',
      client_id: clientId,
      client_recorded_at: new Date().toISOString(),
    };

    // First insert — must succeed.
    const { error: firstError } = await db
      .from('crossings')
      .insert(crossingPayload);
    expect(firstError).toBeNull();

    // Second insert with identical client_id — must be rejected by the unique
    // constraint on (client_id) declared in the crossings table.
    const { error: dupeError } = await db
      .from('crossings')
      .insert(crossingPayload);
    expect(dupeError).not.toBeNull();
    // Postgres error code 23505 = unique_violation.
    expect(dupeError?.code).toBe('23505');

    // Confirm only one crossing exists for this client_id.
    // The anon client can read crossings for active races (public read policy).
    const { data: rows } = await anonClient
      .from('crossings')
      .select('id')
      .eq('race_id', raceId)
      .eq('client_id', clientId);
    expect(rows?.length).toBe(1);
  });
});
