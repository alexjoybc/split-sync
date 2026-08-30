import { test, expect } from '@playwright/test';

/**
 * E2E spec: Stopwatch lap statistics strip (BEST / WORST / AVG) and trend chart.
 *
 * The stats strip is hidden until >= 2 laps are recorded. This test drives the
 * solo web stopwatch, records three laps, then asserts the stats cells are
 * visible and contain non-empty formatted time values.
 */
test.describe('Stopwatch lap statistics', () => {
  test('stats strip is hidden with < 2 laps and visible after', async ({ page }) => {
    await page.goto('/stopwatch');

    // Stats strip should not be present initially
    await expect(page.locator('[aria-label="Lap statistics"]')).not.toBeVisible();

    // Click Start
    await page.getByRole('button', { name: /start stopwatch/i }).click();

    // Record first lap — stats strip still hidden (only 1 lap)
    await page.waitForTimeout(120);
    await page.getByRole('button', { name: /record lap/i }).click();
    await expect(page.locator('[aria-label="Lap statistics"]')).not.toBeVisible();

    // Record second lap — stats strip should now appear
    await page.waitForTimeout(120);
    await page.getByRole('button', { name: /record lap/i }).click();
    await expect(page.locator('[aria-label="Lap statistics"]')).toBeVisible();

    // Record a third lap for more data
    await page.waitForTimeout(120);
    await page.getByRole('button', { name: /record lap/i }).click();

    // Stop the stopwatch
    await page.getByRole('button', { name: /stop stopwatch/i }).click();

    // Stats strip must be visible with 3 laps
    const statsStrip = page.locator('[aria-label="Lap statistics"]');
    await expect(statsStrip).toBeVisible();

    // BEST cell: label and non-empty value
    const bestCell = statsStrip.locator('.sw-stat-cell--best');
    await expect(bestCell).toBeVisible();
    const bestLabel = bestCell.locator('.sw-stat-label');
    await expect(bestLabel).toHaveText(/best/i);
    const bestValue = bestCell.locator('.sw-stat-value');
    await expect(bestValue).not.toBeEmpty();

    // WORST cell: label and non-empty value
    const worstCell = statsStrip.locator('.sw-stat-cell--worst');
    await expect(worstCell).toBeVisible();
    const worstLabel = worstCell.locator('.sw-stat-label');
    await expect(worstLabel).toHaveText(/worst/i);
    const worstValue = worstCell.locator('.sw-stat-value');
    await expect(worstValue).not.toBeEmpty();

    // AVG cell: label and non-empty value
    const avgCell = statsStrip.locator('.sw-stat-cell:not(.sw-stat-cell--best):not(.sw-stat-cell--worst)');
    await expect(avgCell).toBeVisible();
    const avgLabel = avgCell.locator('.sw-stat-label');
    await expect(avgLabel).toHaveText(/avg/i);
    const avgValue = avgCell.locator('.sw-stat-value');
    await expect(avgValue).not.toBeEmpty();
  });

  test('trend chart rows match lap count', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start and record 4 laps
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(100);
      await page.getByRole('button', { name: /record lap/i }).click();
    }
    await page.getByRole('button', { name: /stop stopwatch/i }).click();

    // Trend chart should have exactly 4 bars (one per lap)
    const chart = page.locator('[aria-label="Lap trend chart"]');
    await expect(chart).toBeVisible();
    const rows = chart.locator('.sw-trend-row');
    await expect(rows).toHaveCount(4);
  });
});
