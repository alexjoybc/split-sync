/**
 * E2E spec: public spectator surfaces.
 *
 * Covers the read-only public routes that any unauthenticated visitor can
 * reach for a published event:
 *
 *   /live/[raceId]        — live classification board
 *   /results/[eventId]    — event results / race list
 *   /announce/[raceId]    — announcer / TV view
 *   /startlist/[raceId]   — start list (auth-gated; unauthenticated visitors
 *                            see a "Sign-in required" prompt, not rider data)
 *   /help                 — self-service help page
 *
 * Realtime assertion: a crossing inserted via an authenticated Supabase
 * client (organizer role) should trigger the Realtime subscription in
 * `useRaceData` and cause the live board to update without a page reload.
 * The anon client cannot insert crossings — migration 20260825000004 revoked
 * anon writes and the organizer_manage_crossings policy requires event
 * ownership — so the test builds a fresh owned event.
 *
 * Seed data (from supabase/seed.sql):
 *   Published event  : a0000000-0000-0000-0000-000000000001
 *   Draft event      : a0000000-0000-0000-0000-000000000002
 *   A Race (5 entries, 3 crossings for bibs 12/7/23): b0000000-0000-0000-0000-000000000001
 *   B Race (3 entries, no crossings): b0000000-0000-0000-0000-000000000002
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { SEED } from '../helpers/fixtures';
import {
  createTestOrganizer,
  uniqueTestEmail,
  signInProgrammatically,
} from '../helpers/supabase';

test.describe('Public spectator surfaces', () => {
  // ---------------------------------------------------------------------------
  // Live board
  // ---------------------------------------------------------------------------

  test('live board renders standings for a published race', async ({ page }) => {
    await page.goto(`/live/${SEED.RACE_A_ID}`);

    // Page should render the live classification heading.
    await expect(
      page.getByText(/live classification/i).first()
    ).toBeVisible({ timeout: 10_000 });

    // A Race has 3 crossings (bibs 12, 7, 23) — Maya Chen led lap 1.
    await expect(page.getByText('Maya Chen')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Liam O\'Brien')).toBeVisible();
    await expect(page.getByText('Sofia Marchetti')).toBeVisible();
  });

  test('live board shows race name and classification section', async ({ page }) => {
    await page.goto(`/live/${SEED.RACE_A_ID}`);

    // Race name from seed
    await expect(page.getByText('A Race — Scratch 20 laps')).toBeVisible({
      timeout: 10_000,
    });

    // Classification header
    await expect(
      page.getByRole('heading', { name: /classification/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // Results page
  // ---------------------------------------------------------------------------

  test('results page renders for a published event', async ({ page }) => {
    await page.goto(`/results/${SEED.PUBLISHED_EVENT_ID}`);
    await expect(page).toHaveURL(/\/results\//);

    // Event title from seed
    await expect(
      page.getByText('Friday Night Racing — E2E Test Event')
    ).toBeVisible({ timeout: 10_000 });

    // Both races listed
    await expect(page.getByText('A Race — Scratch 20 laps')).toBeVisible();
    await expect(page.getByText('B Race — Scratch 15 laps')).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Announce page
  // ---------------------------------------------------------------------------

  test('announce page renders for a published race', async ({ page }) => {
    await page.goto(`/announce/${SEED.RACE_A_ID}`);

    // Announcer masthead kicker
    await expect(
      page.getByText(/announcer view/i)
    ).toBeVisible({ timeout: 10_000 });

    // Race name
    await expect(page.getByText('A Race — Scratch 20 laps')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('announce page shows current leader from seed crossings', async ({ page }) => {
    await page.goto(`/announce/${SEED.RACE_A_ID}`);

    // Leader section is present
    await expect(page.getByText(/current leader/i)).toBeVisible({
      timeout: 10_000,
    });

    // Maya Chen (bib 12) crossed first — she should be the leader
    await expect(page.getByText('Maya Chen')).toBeVisible({ timeout: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // Start list (auth-gated)
  // ---------------------------------------------------------------------------

  test('startlist is not accessible to unauthenticated spectators', async ({ page }) => {
    await page.goto(`/startlist/${SEED.RACE_A_ID}`);

    // The page should gate entry with a sign-in prompt.
    await expect(page.getByText(/sign.?in required/i)).toBeVisible({
      timeout: 10_000,
    });

    // Rider data must NOT be exposed to unauthenticated visitors.
    await expect(page.getByText('Maya Chen')).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Help page
  // ---------------------------------------------------------------------------

  test('/help page renders', async ({ page }) => {
    await page.goto('/help');
    await expect(page).toHaveURL('/help');

    // Help page has an h1
    await expect(
      page.locator('h1').filter({ hasText: /help/i })
    ).toBeVisible({ timeout: 5_000 });

    // Contains spectator and organizer sections
    await expect(page.getByText(/for spectators/i).first()).toBeVisible();
    await expect(page.getByText(/for organizers/i).first()).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Draft event visibility
  // ---------------------------------------------------------------------------

  test('draft event is NOT accessible to spectators', async ({ page }) => {
    await page.goto(`/results/${SEED.DRAFT_EVENT_ID}`);

    // RLS blocks the draft event — the results page gets no data and stays in
    // a loading/empty state rather than rendering the draft event's details.
    await expect(
      page.getByText('Draft Event — Not Visible to Public')
    ).not.toBeVisible({ timeout: 5_000 });
  });

  // ---------------------------------------------------------------------------
  // No organizer controls on public pages
  // ---------------------------------------------------------------------------

  test('live board exposes no organizer controls', async ({ page }) => {
    await page.goto(`/live/${SEED.RACE_A_ID}`);

    // Wait for data to load so we're not asserting on a blank page.
    await expect(page.getByText('Maya Chen')).toBeVisible({ timeout: 10_000 });

    // Organizer-only actions must not be present.
    await expect(
      page.getByRole('button', { name: /start race/i })
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: /finish race/i })
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: /reopen/i })
    ).not.toBeVisible();
  });

  test('announce page exposes no organizer controls', async ({ page }) => {
    await page.goto(`/announce/${SEED.RACE_A_ID}`);

    await expect(page.getByText(/announcer view/i)).toBeVisible({
      timeout: 10_000,
    });

    await expect(
      page.getByRole('button', { name: /start race/i })
    ).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: /finish race/i })
    ).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Realtime: crossing appears on live board without reload
  // ---------------------------------------------------------------------------

  test('realtime: crossing appears on live board without page reload', async ({
    browser,
  }) => {
    // The anon client cannot insert crossings: migration 20260825000004 revokes
    // anon writes and the `organizer manage crossings` RLS policy requires
    // events.owner_id = auth.jwt()->>'sub'. Seed events have owner_id = null,
    // so we must build a fresh owned event with an authenticated client.

    const email = uniqueTestEmail('realtime-scorer');
    const password = 'TestPass123!';
    await createTestOrganizer(email, password);
    const session = await signInProgrammatically(email, password);

    const SUPABASE_URL =
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
    const SUPABASE_ANON_KEY =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7b6b7xNHPnjyxvFnDpvnuN51o4MXVToypGc';

    // Pass the organizer's JWT in every request so RLS policies are satisfied.
    const authedDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: { Authorization: `Bearer ${session.session?.access_token}` },
      },
    });

    // Create a 'live' event owned by the test user so:
    //   • spectator RLS (status in ('live','finished')) allows reads
    //   • organizer RLS (owner_id = jwt sub) allows crossing inserts
    const ownerSub = session.user?.id ?? '';
    const { data: event, error: eventErr } = await authedDb
      .from('events')
      .insert({
        title: `Realtime Test Event ${Date.now()}`,
        sport_type: 'velodrome',
        status: 'live',
        owner_id: ownerSub,
      })
      .select('id')
      .single();
    expect(eventErr).toBeNull();
    const eventId = (event as { id: string }).id;

    // Participants — first_name/last_name columns (name was dropped in
    // migration 20260827000002).
    const { error: pErr } = await authedDb.from('participants').insert([
      { event_id: eventId, bib: '1', first_name: 'Alice', last_name: 'Scorer', team: 'Team A' },
      { event_id: eventId, bib: '2', first_name: 'Bob',   last_name: 'Scorer', team: 'Team B' },
    ]);
    expect(pErr).toBeNull();

    // Race (default status is 'upcoming'; entries are what matter for the board).
    const { data: race, error: raceErr } = await authedDb
      .from('races')
      .insert({ event_id: eventId, name: 'Realtime Race', sequence_order: 1, laps_planned: 5 })
      .select('id')
      .single();
    expect(raceErr).toBeNull();
    const raceId = (race as { id: string }).id;

    // Entries (entries.name is still a single text column).
    const { error: eErr } = await authedDb.from('entries').insert([
      { race_id: raceId, bib: '1', name: 'Alice Scorer', team: 'Team A' },
      { race_id: raceId, bib: '2', name: 'Bob Scorer',   team: 'Team B' },
    ]);
    expect(eErr).toBeNull();

    // Open the spectator live board in a separate browser context.
    const spectatorCtx = await browser.newContext();
    const spectatorPage = await spectatorCtx.newPage();
    await spectatorPage.goto(`/live/${raceId}`);

    // Wait for the board to load — entries are visible with 0 laps.
    await expect(spectatorPage.getByText('Alice Scorer')).toBeVisible({
      timeout: 10_000,
    });

    // Insert a crossing via the authenticated scorer client.
    // This exercises the full realtime path:
    //   authenticated INSERT → Supabase Realtime → useRaceData refetch → re-render
    const { error: crossingErr } = await authedDb.from('crossings').insert({
      race_id: raceId,
      bib: '1', // Alice Scorer — no prior crossings in this fresh race
      client_id: crypto.randomUUID(),
      client_recorded_at: new Date().toISOString(),
    });
    expect(crossingErr).toBeNull(); // hard assertion: fail explicitly if RLS blocks this

    // The live board subscribes to crossings changes via Supabase Realtime.
    // After the insert, useRaceData refetches and Alice Scorer's lap count
    // should advance to 1 — without any page reload.
    const aliceRow = spectatorPage
      .locator('tbody tr')
      .filter({ hasText: 'Alice Scorer' });
    await expect(aliceRow.getByText('1')).toBeVisible({ timeout: 15_000 });

    await spectatorCtx.close();
  });
});
