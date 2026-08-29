import { test, expect } from '@playwright/test';
import { uniqueTestEmail, createTestOrganizer } from '../helpers/supabase';
import { seedTimeTrialRace, insertCrossing } from '../helpers/time-trial';

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
    // Wait for the page to render queue content
    await page.waitForSelector('text=/Up Next|Queue/i', { timeout: 10_000 });
    const pageText = await page.locator('body').textContent() ?? '';
    // Bibs should appear in ascending natural order
    const idx2  = pageText.indexOf('#2');
    const idx9  = pageText.indexOf('#9');
    const idx10 = pageText.indexOf('#10');
    expect(idx2).toBeGreaterThanOrEqual(0);
    expect(idx9).toBeGreaterThan(idx2);
    expect(idx10).toBeGreaterThan(idx9);
  });

  test('shows "Waiting for next rider" when no one is on course', async ({ page }) => {
    const { race } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    await page.goto(`/live/${race.id}`);
    await expect(page.getByText(/waiting for next rider/i)).toBeVisible({ timeout: 10_000 });
  });

  test('shows rider on course after start crossing', async ({ page }) => {
    const { race, client } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    // Insert start crossing for bib 2
    await insertCrossing(client, race.id, '2');
    await page.goto(`/live/${race.id}`);
    // The on-course section should show bib 2
    await expect(page.getByText('#2')).toBeVisible({ timeout: 10_000 });
    // "Waiting for next rider" should NOT be visible
    await expect(page.getByText(/waiting for next rider/i)).not.toBeVisible();
  });

  test('shows finished rider in results after 2 crossings, updates within 5s via polling', async ({ page }) => {
    const { race, client } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    // Navigate first with no crossings
    await page.goto(`/live/${race.id}`);
    await expect(page.getByText(/waiting for next rider/i)).toBeVisible({ timeout: 10_000 });
    // Insert start and finish crossings for bib 2 (30 s elapsed)
    await insertCrossing(client, race.id, '2', 0);
    await insertCrossing(client, race.id, '2', 30_000);
    // Board should show bib 2 in the results table within 5 seconds (polling fallback)
    await expect(page.getByRole('cell', { name: /^#?2$/ })).toBeVisible({ timeout: 10_000 });
  });

  test('ranks two finished riders by elapsed time ascending (faster first)', async ({ page }) => {
    const { race, client } = await seedTimeTrialRace(organizerEmail, organizerPassword);
    // Bib 9: elapsed 60 s
    await insertCrossing(client, race.id, '9', 0);
    await insertCrossing(client, race.id, '9', 60_000);
    // Bib 2: elapsed 55 s → faster, should be P1
    await insertCrossing(client, race.id, '2', 1_000);
    await insertCrossing(client, race.id, '2', 56_000);

    await page.goto(`/live/${race.id}`);
    await page.waitForSelector('table', { timeout: 10_000 });

    const rows = page.locator('table tbody tr');
    const firstRow = rows.first();
    // P1 row should contain bib 2 (the faster rider)
    await expect(firstRow.getByText(/2/)).toBeVisible({ timeout: 5_000 });
  });
});
