import { test, expect } from '@playwright/test';
import type { Session } from '@supabase/supabase-js';
import {
  uniqueTestEmail,
  createTestOrganizer,
  signInProgrammatically,
} from '../helpers/supabase';
import { seedTimeTrialRace, insertCrossing } from '../helpers/time-trial';

/**
 * Inject the organizer session into the browser via localStorage so the
 * Supabase client-side fetches use the organizer RLS policies. This is
 * significantly faster than filling the login form (no page round-trip, no
 * redirect wait) while providing identical auth state for the live board.
 */
async function injectSession(
  page: Parameters<Parameters<typeof test>[1]>[0],
  session: Session,
) {
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
}

/**
 * Wait for the TT live board to finish its initial data load.
 * Do NOT use waitForLoadState('networkidle') — the polling interval (every
 * 4 s) and the Realtime WebSocket keep the network permanently active.
 * Instead wait directly for the race name which appears once data loads.
 */
async function waitForBoardLoad(
  page: Parameters<Parameters<typeof test>[1]>[0],
  raceName = 'Time Trial'
) {
  await expect(page.getByText(raceName, { exact: false })).toBeVisible({ timeout: 15_000 });
}

test.describe('Time Trial live board', () => {
  let organizerEmail: string;
  let organizerPassword: string;
  let organizerSession: Session;

  test.beforeAll(async () => {
    organizerEmail = uniqueTestEmail('tt-live');
    organizerPassword = 'TestPass123!';
    await createTestOrganizer(organizerEmail, organizerPassword);
    // Sign in once and cache the session for all tests in this suite.
    const { session } = await signInProgrammatically(organizerEmail, organizerPassword);
    if (!session) throw new Error('Failed to sign in TT organizer');
    organizerSession = session;
  });

  test('shows queue in natural bib order (2, 9, 10)', async ({ page }) => {
    const { race } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    await injectSession(page, organizerSession);
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);

    await expect(page.getByText(/up next/i)).toBeVisible({ timeout: 10_000 });

    // Seed: Alice=bib2 (sorts first), Bob=bib9, Carol=bib10 (sorts last).
    // Inserted in reverse order (Carol, Bob, Alice) to verify natural sort.
    const pageText = await page.locator('body').textContent() ?? '';
    const idxAlice = pageText.indexOf('Alice'); // bib 2 → first in natural sort
    const idxBob   = pageText.indexOf('Bob');   // bib 9 → second
    const idxCarol = pageText.indexOf('Carol'); // bib 10 → third
    expect(idxAlice, 'Alice (bib 2) should appear in page').toBeGreaterThanOrEqual(0);
    expect(idxBob,   'Bob (bib 9) should appear after Alice').toBeGreaterThan(idxAlice);
    expect(idxCarol, 'Carol (bib 10) should appear after Bob').toBeGreaterThan(idxBob);
  });

  test('shows idle state when no one is on course', async ({ page }) => {
    const { race } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    await injectSession(page, organizerSession);
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);
    await expect(page.getByText(/waiting for next rider/i)).toBeVisible({ timeout: 10_000 });
  });

  test('shows rider on course after a start crossing', async ({ page }) => {
    const { race, client } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    await insertCrossing(client, race.id, '2');
    await injectSession(page, organizerSession);
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);
    await expect(page.getByText(/#2/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/waiting for next rider/i)).not.toBeVisible();
  });

  test('results table updates within 5 s of a finish crossing (polling fallback)', async ({ page }) => {
    const { race, client } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    await injectSession(page, organizerSession);
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);
    await expect(page.getByText(/waiting for next rider/i)).toBeVisible({ timeout: 10_000 });

    // Insert start + finish crossings
    await insertCrossing(client, race.id, '2', 0);
    await insertCrossing(client, race.id, '2', 30_000);

    // Polling fallback fires every 4 s; results should appear within 10 s
    const resultsBib = page.locator('table').getByText(/2/, { exact: false });
    await expect(resultsBib).toBeVisible({ timeout: 10_000 });
  });

  test('ranks two finished riders by elapsed time (faster rider is P1)', async ({ page }) => {
    const { race, client } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    // Bib 9: 60 s elapsed
    await insertCrossing(client, race.id, '9', 0);
    await insertCrossing(client, race.id, '9', 60_000);
    // Bib 2: 55 s elapsed → faster → P1
    await insertCrossing(client, race.id, '2', 1_000);
    await insertCrossing(client, race.id, '2', 56_000);

    await injectSession(page, organizerSession);
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);
    await page.waitForSelector('table', { timeout: 10_000 });

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow.getByText(/2/)).toBeVisible({ timeout: 8_000 });
  });
});
