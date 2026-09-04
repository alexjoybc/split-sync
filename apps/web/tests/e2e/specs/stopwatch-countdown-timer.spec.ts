/**
 * E2E spec: /stopwatch — countdown timer mode (#232)
 *
 * Solo mode only (shared sessions are unaffected). Tests:
 *   1. Mode toggle is visible; TIMER switches to the countdown view and hides
 *      the stopwatch controls.
 *   2. The selected mode persists across a page reload.
 *   3. Setting a duration updates the dial; invalid input is flagged.
 *   4. Start counts down; Pause freezes the remaining time; Resume continues.
 *   5. Completion auto-resets the display to the ORIGINAL duration and shows
 *      the completion alert; Dismiss silences it with a single tap.
 *   6. After completion, one tap on Start restarts a full round (rest-interval
 *      workflow).
 *   7. A running timer survives a page refresh via the wall-clock anchor.
 *   8. Reset returns a paused timer to the set duration.
 */
import { test, expect, type Page } from '@playwright/test';

/** Read remaining ms from the dial's digits ("MM:SS" or "H:MM:SS"). */
async function readRemainingMs(page: Page): Promise<number> {
  const text = (await page.getByTestId('timer-display').textContent())?.trim();
  const match = text?.match(/^(?:(\d+):)?(\d+):(\d+)$/);
  if (!match) throw new Error(`Unexpected timer display: ${text}`);
  const [, h, mm, ss] = match;
  return (h ? Number(h) * 3_600_000 : 0) + Number(mm) * 60_000 + Number(ss) * 1000;
}

async function enterTimerMode(page: Page) {
  await page.goto('/stopwatch');
  await page.getByTestId('sw-mode-timer').click();
  await expect(page.getByTestId('timer-mode')).toBeVisible();
}

test.describe('/stopwatch countdown timer mode', () => {

  test('mode toggle switches between stopwatch and timer views', async ({ page }) => {
    await page.goto('/stopwatch');

    // Default: stopwatch view, no timer view
    await expect(page.getByTestId('sw-mode-toggle')).toBeVisible();
    await expect(page.getByTestId('sw-primary-btn')).toBeVisible();
    await expect(page.getByTestId('timer-mode')).not.toBeVisible();

    // Switch to timer: countdown view appears, stopwatch controls disappear
    await page.getByTestId('sw-mode-timer').click();
    await expect(page.getByTestId('sw-mode-timer')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('timer-mode')).toBeVisible();
    await expect(page.getByTestId('timer-duration-input')).toBeVisible();
    await expect(page.getByTestId('sw-primary-btn')).not.toBeVisible();

    // And back
    await page.getByTestId('sw-mode-stopwatch').click();
    await expect(page.getByTestId('timer-mode')).not.toBeVisible();
    await expect(page.getByTestId('sw-primary-btn')).toBeVisible();
  });

  test('selected mode persists across a reload', async ({ page }) => {
    await enterTimerMode(page);
    await page.reload();
    await expect(page.getByTestId('timer-mode')).toBeVisible();
    await expect(page.getByTestId('sw-mode-timer')).toHaveAttribute('aria-pressed', 'true');
  });

  test('setting a duration updates the dial; H:MM:SS accepted; invalid flagged', async ({ page }) => {
    await enterTimerMode(page);

    const input = page.getByTestId('timer-duration-input');
    await input.fill('10:30');
    expect(await readRemainingMs(page)).toBe(10 * 60_000 + 30_000);

    await input.fill('1:05:00');
    expect(await readRemainingMs(page)).toBe(3_600_000 + 5 * 60_000);

    await input.fill('nonsense');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    // Blur restores the last valid duration
    await input.blur();
    await expect(input).toHaveValue('1:05:00');
  });

  test('start counts down; pause freezes; resume continues', async ({ page }) => {
    await enterTimerMode(page);

    await page.getByTestId('timer-duration-input').fill('00:30');
    await page.getByTestId('timer-primary-btn').click();

    // Counting down: remaining drops below the set duration
    await page.waitForTimeout(1500);
    const running = await readRemainingMs(page);
    expect(running).toBeLessThan(30_000);
    expect(running).toBeGreaterThan(25_000);

    // Pause: value freezes
    await page.getByTestId('timer-primary-btn').click(); // Pause
    const paused = await readRemainingMs(page);
    await page.waitForTimeout(800);
    expect(await readRemainingMs(page)).toBe(paused);

    // Resume: continues from the paused value, not from the full duration
    await page.getByTestId('timer-primary-btn').click(); // Start (resume)
    await page.waitForTimeout(1200);
    const resumed = await readRemainingMs(page);
    expect(resumed).toBeLessThan(paused);
    expect(resumed).toBeGreaterThan(paused - 3000);
  });

  test('completion auto-resets to the original duration and can be dismissed with one tap', async ({ page }) => {
    await enterTimerMode(page);

    await page.getByTestId('timer-duration-input').fill('00:02');
    await page.getByTestId('timer-primary-btn').click();

    // Completion: alert visible, display reset to the ORIGINAL value
    await expect(page.getByTestId('timer-complete')).toBeVisible({ timeout: 4000 });
    expect(await readRemainingMs(page)).toBe(2000);

    // Single tap dismisses the alert
    await page.getByTestId('timer-secondary-btn').click(); // Dismiss
    await expect(page.getByTestId('timer-complete')).not.toBeVisible();

    // Ready to restart: still showing the original duration, Start available
    expect(await readRemainingMs(page)).toBe(2000);
    await expect(page.getByTestId('timer-primary-btn')).toHaveText('Start');
  });

  test('after completion, one tap on Start runs a full round again', async ({ page }) => {
    await enterTimerMode(page);

    await page.getByTestId('timer-duration-input').fill('00:02');
    await page.getByTestId('timer-primary-btn').click();
    await expect(page.getByTestId('timer-complete')).toBeVisible({ timeout: 4000 });

    // One tap: dismisses the alert AND starts the next round from the full value
    await page.getByTestId('timer-primary-btn').click();
    await expect(page.getByTestId('timer-complete')).not.toBeVisible();
    await page.waitForTimeout(700);
    const remaining = await readRemainingMs(page);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(2000);
    await expect(page.getByTestId('timer-primary-btn')).toHaveText('Pause');
  });

  test('a running timer survives a page refresh (wall-clock anchor)', async ({ page }) => {
    await enterTimerMode(page);

    await page.getByTestId('timer-duration-input').fill('00:30');
    await page.getByTestId('timer-primary-btn').click();
    await page.waitForTimeout(1200);

    await page.reload();

    // Restored in timer mode, still running (Pause shown), remaining below 30 s
    await expect(page.getByTestId('timer-mode')).toBeVisible();
    await expect(page.getByTestId('timer-primary-btn')).toHaveText('Pause');
    const remaining = await readRemainingMs(page);
    expect(remaining).toBeLessThan(30_000);
    expect(remaining).toBeGreaterThan(20_000);
  });

  test('reset returns a paused timer to the set duration', async ({ page }) => {
    await enterTimerMode(page);

    await page.getByTestId('timer-duration-input').fill('00:20');
    await page.getByTestId('timer-primary-btn').click();
    await page.waitForTimeout(1200);
    await page.getByTestId('timer-primary-btn').click(); // Pause
    expect(await readRemainingMs(page)).toBeLessThan(20_000);

    await page.getByTestId('timer-secondary-btn').click(); // Reset
    expect(await readRemainingMs(page)).toBe(20_000);
    await expect(page.getByTestId('timer-primary-btn')).toHaveText('Start');
  });

});
