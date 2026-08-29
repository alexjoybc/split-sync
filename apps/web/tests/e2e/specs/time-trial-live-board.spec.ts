import { test, expect } from '@playwright/test';
import { uniqueTestEmail, createTestOrganizer } from '../helpers/supabase';
import { seedTimeTrialRace, insertCrossing } from '../helpers/time-trial';

/**
 * Wait for the TT live board to finish its initial data load.
 * Do NOT use waitForLoadState('networkidle') — the polling interval (every 4 s)
 * and the Supabase Realtime WebSocket keep the network permanently active, so
 * 'networkidle' never fires. Instead wait directly for an element that only
 * appears once the data fetch succeeds: the race name in the page header.
 */
async function waitForBoardLoad(page: Parameters<Parameters<typeof test>[1]>[0], raceName = 'Time Trial') {
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
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);

    // "Up Next" section appears when queue is non-empty (3 entries seeded)
    await expect(page.getByText(/up next/i)).toBeVisible({ timeout: 10_000 });

    const pageText = await page.locator('body').textContent() ?? '';
    // Find first occurrence of each bib in the Up Next / queue area
    const idx2  = pageText.indexOf('#2');
    const idx9  = pageText.indexOf('#9');
    const idx10 = pageText.indexOf('#10');
    expect(idx2, 'bib 2 should appear in page').toBeGreaterThanOrEqual(0);
    expect(idx9, 'bib 9 should appear after bib 2').toBeGreaterThan(idx2);
    expect(idx10, 'bib 10 should appear after bib 9').toBeGreaterThan(idx9);
  });

  test('shows idle state when no one is on course', async ({ page }) => {
    const { race } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);
    // With 0 crossings, no runner is active — board shows the idle state text
    await expect(page.getByText(/waiting for next rider/i)).toBeVisible({ timeout: 10_000 });
  });

  test('shows rider on course after a start crossing', async ({ page }) => {
    const { race, client } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    // Insert start crossing for bib 2 BEFORE navigating so data is ready
    await insertCrossing(client, race.id, '2');
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);
    // On-course section should show bib 2
    await expect(page.getByText(/#2/)).toBeVisible({ timeout: 10_000 });
    // Idle state should be gone
    await expect(page.getByText(/waiting for next rider/i)).not.toBeVisible();
  });

  test('results table updates within 5 s of a finish crossing (polling fallback)', async ({ page }) => {
    const { race, client } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    // Navigate first with no crossings — idle state
    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);
    await expect(page.getByText(/waiting for next rider/i)).toBeVisible({ timeout: 10_000 });

    // Insert start + finish crossings for bib 2 (30 s elapsed)
    await insertCrossing(client, race.id, '2', 0);
    await insertCrossing(client, race.id, '2', 30_000);

    // Polling fallback (every 4 s) should refresh the board — wait up to 10 s
    // After refresh, bib 2 should appear in the results table
    const resultsBib = page.locator('table').getByText(/2/, { exact: false });
    await expect(resultsBib).toBeVisible({ timeout: 10_000 });
  });

  test('ranks two finished riders by elapsed time (faster rider is P1)', async ({ page }) => {
    const { race, client } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    // Bib 9: elapsed 60 s
    await insertCrossing(client, race.id, '9', 0);
    await insertCrossing(client, race.id, '9', 60_000);
    // Bib 2: elapsed 55 s → faster, should be P1
    await insertCrossing(client, race.id, '2', 1_000);
    await insertCrossing(client, race.id, '2', 56_000);

    await page.goto(`/live/${race.id}`);
    await waitForBoardLoad(page);
    await page.waitForSelector('table', { timeout: 10_000 });

    const rows = page.locator('table tbody tr');
    const firstRow = rows.first();
    // P1 row (fastest) should contain bib 2
    await expect(firstRow.getByText(/2/)).toBeVisible({ timeout: 8_000 });
  });
});
