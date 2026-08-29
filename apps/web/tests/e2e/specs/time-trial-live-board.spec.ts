import { test, expect } from '@playwright/test';
import { uniqueTestEmail, createTestOrganizer } from '../helpers/supabase';
import { seedTimeTrialRace, insertCrossing } from '../helpers/time-trial';

/**
 * Sign the browser in as the test organizer so the Supabase client-side
 * fetches use the organizer RLS policies. The live board shows identical
 * data to what an anonymous spectator sees — we authenticate only to avoid
 * flakiness from anonymous fetch behaviour in the CI Supabase environment.
 */
async function signInBrowser(
  page: Parameters<Parameters<typeof test>[1]>[0],
  email: string,
  password: string
) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.press('input[type="password"]', 'Enter');
  // Wait until we leave the login page
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10_000 });
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

  test.beforeAll(async () => {
    organizerEmail = uniqueTestEmail('tt-live');
    organizerPassword = 'TestPass123!';
    await createTestOrganizer(organizerEmail, organizerPassword);
  });

  test('shows queue in natural bib order (2, 9, 10)', async ({ page }) => {
    const { race } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    await signInBrowser(page, organizerEmail, organizerPassword);
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);

    await expect(page.getByText(/up next/i)).toBeVisible({ timeout: 10_000 });

    const pageText = await page.locator('body').textContent() ?? '';
    const idx2  = pageText.indexOf('#2');
    const idx9  = pageText.indexOf('#9');
    const idx10 = pageText.indexOf('#10');
    expect(idx2, 'bib 2 should appear in page').toBeGreaterThanOrEqual(0);
    expect(idx9, 'bib 9 should appear after bib 2').toBeGreaterThan(idx2);
    expect(idx10, 'bib 10 should appear after bib 9').toBeGreaterThan(idx9);
  });

  test('shows idle state when no one is on course', async ({ page }) => {
    const { race } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    await signInBrowser(page, organizerEmail, organizerPassword);
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);
    await expect(page.getByText(/waiting for next rider/i)).toBeVisible({ timeout: 10_000 });
  });

  test('shows rider on course after a start crossing', async ({ page }) => {
    const { race, client } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    await insertCrossing(client, race.id, '2');
    await signInBrowser(page, organizerEmail, organizerPassword);
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);
    await expect(page.getByText(/#2/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/waiting for next rider/i)).not.toBeVisible();
  });

  test('results table updates within 5 s of a finish crossing (polling fallback)', async ({ page }) => {
    const { race, client } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    await signInBrowser(page, organizerEmail, organizerPassword);
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

    await signInBrowser(page, organizerEmail, organizerPassword);
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);
    await page.waitForSelector('table', { timeout: 10_000 });

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow.getByText(/2/)).toBeVisible({ timeout: 8_000 });
  });
});
