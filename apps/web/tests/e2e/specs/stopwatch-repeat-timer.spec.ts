/**
 * E2E spec: /stopwatch — repeat / Pomodoro countdown timer mode (#417)
 *
 * Tests:
 *   1. Repeat-mode toggle is present in timer-mode idle state.
 *   2. Enabling repeat mode reveals rest-duration and repeat-count inputs.
 *   3. Automated work→rest→work transition (no manual tap required between phases).
 *   4. After N cycles complete the final alert fires.
 *   5. Stop (Reset) button is available and works during any phase.
 *   6. Repeat config persists across a page reload.
 *
 * Notes:
 *   - Work/rest durations are kept very short (2–3 s) for speed.
 *   - All existing single-shot countdown tests remain unaffected because repeat
 *     mode is OFF by default. This spec never disables the existing toggle tests.
 */
import { test, expect, type Page } from '@playwright/test';

async function enterTimerMode(page: Page) {
  await page.goto('/stopwatch');
  await page.getByTestId('sw-mode-timer').click();
  await expect(page.getByTestId('timer-mode')).toBeVisible();
}

/** Read remaining ms from the dial ("MM:SS" or "H:MM:SS"). */
async function readRemainingMs(page: Page): Promise<number> {
  const text = (await page.getByTestId('timer-display').textContent())?.trim();
  const match = text?.match(/^(?:(\d+):)?(\d+):(\d+)$/);
  if (!match) throw new Error(`Unexpected timer display: ${text}`);
  const [, h, mm, ss] = match;
  return (h ? Number(h) * 3_600_000 : 0) + Number(mm) * 60_000 + Number(ss) * 1000;
}

test.describe('/stopwatch repeat / Pomodoro timer mode', () => {

  test('repeat-mode toggle is visible in timer idle state', async ({ page }) => {
    await enterTimerMode(page);
    // Repeat toggle should be visible in idle state
    await expect(page.getByTestId('repeat-mode-toggle')).toBeVisible();
    // By default it is unchecked
    await expect(page.getByTestId('repeat-mode-toggle')).not.toBeChecked();
  });

  test('enabling repeat mode reveals rest-duration and repeat-count inputs', async ({ page }) => {
    await enterTimerMode(page);

    // Inputs should not be visible yet
    await expect(page.getByTestId('repeat-rest-input')).not.toBeVisible();
    await expect(page.getByTestId('repeat-count-input')).not.toBeVisible();

    // Enable repeat mode
    await page.getByTestId('repeat-mode-toggle').check();

    // Now both inputs should appear
    await expect(page.getByTestId('repeat-rest-input')).toBeVisible();
    await expect(page.getByTestId('repeat-count-input')).toBeVisible();
  });

  test('automated work→rest→work transition without manual tap', async ({ page }) => {
    await enterTimerMode(page);

    // Set a very short work duration
    await page.getByTestId('timer-duration-input').fill('00:02');

    // Enable repeat mode
    await page.getByTestId('repeat-mode-toggle').check();
    // Set 1-second rest
    await page.getByTestId('repeat-rest-input').fill('00:01');
    // Set 3 repeats so we don't loop forever
    await page.getByTestId('repeat-count-input').fill('3');

    // Start the timer
    await page.getByTestId('timer-primary-btn').click();

    // Wait for work phase to complete and rest phase to begin automatically.
    // After ~3s (2s work + transition) we should see the REST phase label.
    await expect(page.getByTestId('repeat-phase-label')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('repeat-phase-label')).toHaveText('REST', { timeout: 5000 });

    // No manual tap was needed — the timer is still running
    await expect(page.getByTestId('timer-primary-btn')).toHaveText('Pause');
  });

  test('phase and cycle labels update correctly through cycles', async ({ page }) => {
    await enterTimerMode(page);

    await page.getByTestId('timer-duration-input').fill('00:02');

    await page.getByTestId('repeat-mode-toggle').check();
    await page.getByTestId('repeat-rest-input').fill('00:01');
    await page.getByTestId('repeat-count-input').fill('2');

    // Start
    await page.getByTestId('timer-primary-btn').click();

    // Initially in WORK phase
    await expect(page.getByTestId('repeat-phase-label')).toBeVisible({ timeout: 2000 });
    await expect(page.getByTestId('repeat-phase-label')).toHaveText('WORK');
    await expect(page.getByTestId('repeat-cycle-label')).toContainText('Cycle 1 of 2');

    // Wait for REST phase
    await expect(page.getByTestId('repeat-phase-label')).toHaveText('REST', { timeout: 5000 });
  });

  test('after N cycles complete, the final alert fires', async ({ page }) => {
    await enterTimerMode(page);

    await page.getByTestId('timer-duration-input').fill('00:02');

    await page.getByTestId('repeat-mode-toggle').check();
    await page.getByTestId('repeat-rest-input').fill('00:01');
    await page.getByTestId('repeat-count-input').fill('2');

    await page.getByTestId('timer-primary-btn').click();

    // After 2 work phases (2s each) + 1 rest (1s) + transition = ~5-6s, the alert
    // should appear. Allow generous timeout for CI.
    await expect(page.getByTestId('timer-complete')).toBeVisible({ timeout: 15000 });

    // Display resets to original work duration
    expect(await readRemainingMs(page)).toBe(2000);
  });

  test('Stop / Reset button works during any phase', async ({ page }) => {
    await enterTimerMode(page);

    await page.getByTestId('timer-duration-input').fill('00:20');

    await page.getByTestId('repeat-mode-toggle').check();
    await page.getByTestId('repeat-rest-input').fill('00:20');
    await page.getByTestId('repeat-count-input').fill('10');

    await page.getByTestId('timer-primary-btn').click();

    // Pause it mid-work
    await page.waitForTimeout(500);
    await page.getByTestId('timer-primary-btn').click(); // Pause
    await expect(page.getByTestId('timer-primary-btn')).toHaveText('Start');

    // Reset from paused state
    await page.getByTestId('timer-secondary-btn').click(); // Reset
    await expect(page.getByTestId('timer-primary-btn')).toHaveText('Start');
    expect(await readRemainingMs(page)).toBe(20000);

    // Phase/cycle labels should be gone (back to idle)
    await expect(page.getByTestId('repeat-phase-label')).not.toBeVisible();
  });

  test('repeat config persists across a page reload', async ({ page }) => {
    await enterTimerMode(page);

    // Enable repeat mode and configure it
    await page.getByTestId('repeat-mode-toggle').check();
    await page.getByTestId('repeat-rest-input').fill('00:30');
    await page.getByTestId('repeat-count-input').fill('5');

    // Reload
    await page.reload();

    // Should still be in timer mode
    await expect(page.getByTestId('timer-mode')).toBeVisible();

    // Repeat toggle should still be checked
    await expect(page.getByTestId('repeat-mode-toggle')).toBeChecked();

    // Inputs should still be visible and populated
    await expect(page.getByTestId('repeat-rest-input')).toBeVisible();
    await expect(page.getByTestId('repeat-count-input')).toHaveValue('5');
  });

  test('existing single-shot countdown is unaffected with repeat mode OFF', async ({ page }) => {
    await enterTimerMode(page);

    // Repeat toggle exists but is NOT enabled
    await expect(page.getByTestId('repeat-mode-toggle')).not.toBeChecked();

    await page.getByTestId('timer-duration-input').fill('00:02');
    await page.getByTestId('timer-primary-btn').click();

    // Should complete with the standard alert (not a repeat transition)
    await expect(page.getByTestId('timer-complete')).toBeVisible({ timeout: 5000 });
    // No phase label shown in single-shot mode
    await expect(page.getByTestId('repeat-phase-label')).not.toBeVisible();
  });

});
