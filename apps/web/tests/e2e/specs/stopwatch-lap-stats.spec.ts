import { test, expect, type Page } from '@playwright/test';

/**
 * E2E spec: Stopwatch lap statistics strip (BEST / WORST / AVG) and trend chart.
 *
 * The stats strip is hidden until >= 2 laps are recorded. These tests drive the
 * solo web stopwatch through a scripted lap sequence, then assert the stats
 * values are mathematically consistent with the lap times rendered in the lap
 * table (the source of truth for the recorded sequence):
 *   - BEST equals the minimum lap time in the table
 *   - WORST equals the maximum lap time in the table
 *   - best <= avg <= worst
 *   - AVG equals the mean of the table lap times (within a small tolerance,
 *     since displayed values are truncated to hundredths)
 */

/** Parse a formatLapTime() string (`S.hh`, `M:SS.hh`, or `H:MM:SS.hh`) into ms. */
function parseLapTimeMs(text: string): number {
  const match = text.trim().match(/^(?:(\d+):)?(?:(\d+):)?(\d+)\.(\d{2})$/);
  if (!match) throw new Error(`Unparseable lap time: "${text}"`);
  const [, a, b, secStr, hunStr] = match;
  let hours = 0;
  let minutes = 0;
  if (a !== undefined && b !== undefined) {
    hours = Number(a);
    minutes = Number(b);
  } else if (a !== undefined) {
    minutes = Number(a);
  }
  return (
    hours * 3_600_000 +
    minutes * 60_000 +
    Number(secStr) * 1000 +
    Number(hunStr) * 10
  );
}

/** Read the per-lap times (second column) from the lap table, in ms. */
async function readLapTableTimesMs(page: Page): Promise<number[]> {
  const cells = page.locator(
    '[aria-label="Lap times table"] tbody tr td:nth-child(2)',
  );
  const texts = await cells.allTextContents();
  return texts.map(parseLapTimeMs);
}

test.describe('Stopwatch lap statistics', () => {
  test('stats strip is hidden with < 2 laps, then shows values consistent with the lap table', async ({
    page,
  }) => {
    await page.goto('/stopwatch');

    // Stats strip should not be present initially
    await expect(page.locator('[aria-label="Lap statistics"]')).not.toBeVisible();

    // Click Start
    await page.getByRole('button', { name: /start stopwatch/i }).click();

    // Record first lap — stats strip still hidden (only 1 lap)
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: /record lap/i }).click();
    await expect(page.locator('[aria-label="Lap statistics"]')).not.toBeVisible();

    // Record second lap — stats strip should now appear
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /record lap/i }).click();
    await expect(page.locator('[aria-label="Lap statistics"]')).toBeVisible();

    // Record a third lap with a different duration for more data
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /record lap/i }).click();

    // Stop the stopwatch so all values are frozen
    await page.getByRole('button', { name: /stop stopwatch/i }).click();

    // Stats strip must be visible with 3 laps
    const statsStrip = page.locator('[aria-label="Lap statistics"]');
    await expect(statsStrip).toBeVisible();

    // Labels
    const bestCell = statsStrip.locator('.sw-stat-cell--best');
    const worstCell = statsStrip.locator('.sw-stat-cell--worst');
    const avgCell = statsStrip.locator(
      '.sw-stat-cell:not(.sw-stat-cell--best):not(.sw-stat-cell--worst)',
    );
    await expect(bestCell.locator('.sw-stat-label')).toHaveText(/best/i);
    await expect(worstCell.locator('.sw-stat-label')).toHaveText(/worst/i);
    await expect(avgCell.locator('.sw-stat-label')).toHaveText(/avg/i);

    // Parse stat values into milliseconds
    const bestMs = parseLapTimeMs(
      await bestCell.locator('.sw-stat-value').innerText(),
    );
    const worstMs = parseLapTimeMs(
      await worstCell.locator('.sw-stat-value').innerText(),
    );
    const avgMs = parseLapTimeMs(
      await avgCell.locator('.sw-stat-value').innerText(),
    );

    // (a) Ordering invariant: best <= avg <= worst.
    // Allow 10ms slack on avg comparisons — displayed values are truncated to
    // hundredths while avg is a rounded mean of raw millisecond laps.
    expect(bestMs).toBeLessThanOrEqual(avgMs + 10);
    expect(avgMs).toBeLessThanOrEqual(worstMs + 10);
    expect(bestMs).toBeLessThanOrEqual(worstMs);

    // (b) Best/worst equal the min/max of the lap table lap times — the lap
    // table rows are the scripted sequence's source of truth, and both the
    // table and the stats strip render through the same formatter, so
    // equality is exact.
    const tableLapMs = await readLapTableTimesMs(page);
    expect(tableLapMs).toHaveLength(3);
    expect(bestMs).toBe(Math.min(...tableLapMs));
    expect(worstMs).toBe(Math.max(...tableLapMs));

    // (c) Avg equals the mean of the table lap times within a small tolerance
    // (each displayed lap time is truncated to the hundredth, so the mean of
    // displayed values can drift from the displayed avg by a few ms).
    const meanMs =
      tableLapMs.reduce((sum, ms) => sum + ms, 0) / tableLapMs.length;
    expect(Math.abs(avgMs - meanMs)).toBeLessThanOrEqual(25);
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
