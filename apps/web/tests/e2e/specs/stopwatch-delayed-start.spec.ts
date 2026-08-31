/**
 * E2E spec: /stopwatch — delayed start (countdown-to-start) feature
 *
 * Solo mode only. Tests:
 *   1. Delay selector is visible in idle state.
 *   2. Select 3 s → click Start → countdown appears (shows "3", "2", or "1").
 *   3. Wait for countdown to end → stopwatch transitions to RUNNING.
 *   4. Cancel during countdown → returns to the prior state without starting
 *      (idle for a fresh start; stopped — with Reset reachable and elapsed
 *      frozen — for a delayed resume).
 *   5. With OFF delay, clicking Start immediately transitions to running (no countdown).
 *   6. Stop → Start resumes with accumulated time intact (with and without a delay).
 */
import { test, expect, type Page } from '@playwright/test';

/** Read the current elapsed time (ms) from the dial's aria-label ("Elapsed time: MM:SS.hh"). */
async function readElapsedMs(page: Page): Promise<number> {
  const label = await page.getByRole('timer').getAttribute('aria-label');
  const match = label?.match(/Elapsed time: (\d+):(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unexpected timer aria-label: ${label}`);
  const [, mm, ss, hh] = match;
  return Number(mm) * 60_000 + Number(ss) * 1000 + Number(hh) * 10;
}

test.describe('/stopwatch delayed start', () => {

  test('delay selector is visible when idle', async ({ page }) => {
    await page.goto('/stopwatch');
    const selector = page.getByTestId('sw-delay-selector');
    await expect(selector).toBeVisible();
    // All four options should be rendered
    await expect(page.getByTestId('sw-delay-0')).toBeVisible();
    await expect(page.getByTestId('sw-delay-3')).toBeVisible();
    await expect(page.getByTestId('sw-delay-5')).toBeVisible();
    await expect(page.getByTestId('sw-delay-10')).toBeVisible();
  });

  test('selecting a delay option marks it as active', async ({ page }) => {
    await page.goto('/stopwatch');
    const btn3 = page.getByTestId('sw-delay-3');
    await btn3.click();
    await expect(btn3).toHaveAttribute('aria-pressed', 'true');
  });

  test('3s delay: countdown is visible after Start', async ({ page }) => {
    await page.goto('/stopwatch');

    // Select 3 s delay
    await page.getByTestId('sw-delay-3').click();

    // Click Start
    await page.getByTestId('sw-primary-btn').click();

    // Within 1 s the countdown number (3, 2, or 1) should be visible on the dial
    await expect(page.getByTestId('sw-countdown-number')).toBeVisible({ timeout: 1000 });

    // The number shown must be 3, 2, or 1 (countdown in progress)
    const text = await page.getByTestId('sw-countdown-number').textContent();
    const num = Number(text?.trim());
    expect(num).toBeGreaterThanOrEqual(1);
    expect(num).toBeLessThanOrEqual(3);
  });

  test('3s delay: stopwatch starts running after countdown ends', async ({ page }) => {
    await page.goto('/stopwatch');

    // Select 3 s delay
    await page.getByTestId('sw-delay-3').click();

    // Click Start
    await page.getByTestId('sw-primary-btn').click();

    // Wait for countdown to finish (3 s + 500 ms buffer)
    await page.waitForTimeout(3600);

    // Countdown number should be gone; Stop button should be visible
    await expect(page.getByTestId('sw-countdown-number')).not.toBeVisible({ timeout: 1000 });
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible({ timeout: 1000 });
  });

  test('cancel during countdown returns to idle', async ({ page }) => {
    await page.goto('/stopwatch');

    // Select 5 s delay (gives us time to cancel)
    await page.getByTestId('sw-delay-5').click();

    // Click Start → countdown begins
    await page.getByTestId('sw-primary-btn').click();
    await expect(page.getByTestId('sw-countdown-number')).toBeVisible({ timeout: 1000 });

    // Click Cancel (secondary button)
    await page.getByTestId('sw-secondary-btn').click();

    // Countdown number should disappear
    await expect(page.getByTestId('sw-countdown-number')).not.toBeVisible({ timeout: 500 });

    // We should be back to idle: Start button visible, delay selector visible
    await expect(page.getByRole('button', { name: /start stopwatch/i })).toBeVisible();
    await expect(page.getByTestId('sw-delay-selector')).toBeVisible();
  });

  test('stop then delayed start then cancel returns to stopped, not idle', async ({ page }) => {
    await page.goto('/stopwatch');

    // Run ~1 s with no delay, then stop (accumulated time > 0)
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /stop stopwatch/i }).click();
    const stoppedMs = await readElapsedMs(page);
    expect(stoppedMs).toBeGreaterThanOrEqual(800);

    // Select a 5 s delay and start again → countdown begins
    await page.getByTestId('sw-delay-5').click();
    await page.getByTestId('sw-primary-btn').click();
    await expect(page.getByTestId('sw-countdown-number')).toBeVisible({ timeout: 1000 });

    // Cancel the countdown
    await page.getByTestId('sw-secondary-btn').click();
    await expect(page.getByTestId('sw-countdown-number')).not.toBeVisible({ timeout: 500 });

    // We must be back in the STOPPED state, not idle:
    // Reset (secondary button) remains enabled...
    const resetBtn = page.getByRole('button', { name: /reset stopwatch/i });
    await expect(resetBtn).toBeVisible();
    await expect(resetBtn).toBeEnabled();

    // ...and the elapsed time still shows the frozen stopped time.
    expect(await readElapsedMs(page)).toBe(stoppedMs);
  });

  test('OFF delay: Start immediately begins running without countdown', async ({ page }) => {
    await page.goto('/stopwatch');

    // Ensure OFF is selected (default)
    await page.getByTestId('sw-delay-0').click();

    // Click Start
    await page.getByRole('button', { name: /start stopwatch/i }).click();

    // Countdown should never appear
    await expect(page.getByTestId('sw-countdown-number')).not.toBeVisible({ timeout: 300 });

    // Stop button should be visible immediately
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible({ timeout: 500 });
  });

  /**
   * #292 — audio beep countdown.
   * Audio itself is not assertable in Playwright; we assert on the UI state
   * transitions that are synchronised with the beep timing:
   *   • initial value shown on the dial is exactly the selected delay,
   *   • the displayed number decrements each second,
   *   • the countdown exits normally after the full delay.
   */
  test('#292 3s delay: countdown dial shows initial value then decrements', async ({ page }) => {
    await page.goto('/stopwatch');

    // Select 3 s delay
    await page.getByTestId('sw-delay-3').click();

    // Trigger Start (user gesture that also unlocks AudioContext)
    await page.getByTestId('sw-primary-btn').click();

    // The countdown number should appear immediately showing "3"
    const number = page.getByTestId('sw-countdown-number');
    await expect(number).toBeVisible({ timeout: 500 });
    const initialText = await number.textContent();
    expect(Number(initialText?.trim())).toBe(3);

    // After ~1.1 s the displayed value must have decremented to ≤ 2
    await page.waitForTimeout(1100);
    const afterOneSecText = await page.getByTestId('sw-countdown-number').textContent();
    expect(Number(afterOneSecText?.trim())).toBeLessThanOrEqual(2);

    // Wait for the full countdown to complete — stopwatch must transition to running
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible({ timeout: 4000 });
    await expect(number).not.toBeVisible();
  });

  test('#292 0s delay: no countdown (no beep sequence, instant start)', async ({ page }) => {
    await page.goto('/stopwatch');

    // Ensure OFF is selected
    await page.getByTestId('sw-delay-0').click();

    // Click Start
    await page.getByRole('button', { name: /start stopwatch/i }).click();

    // Countdown number must never appear (0 s delay = instant start)
    await expect(page.getByTestId('sw-countdown-number')).not.toBeVisible({ timeout: 300 });

    // Stop button should be visible immediately
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible({ timeout: 500 });
  });

  test('delay selector is hidden while running', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start without delay
    await page.getByRole('button', { name: /start stopwatch/i }).click();

    // Delay selector should not be visible during run
    await expect(page.getByTestId('sw-delay-selector')).not.toBeVisible({ timeout: 500 });
  });

  test('stop then start (no delay) resumes with accumulated time intact', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start (OFF delay by default), let it run ~1.2 s, then stop
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /stop stopwatch/i }).click();

    const stoppedMs = await readElapsedMs(page);
    expect(stoppedMs).toBeGreaterThanOrEqual(1000);

    // While stopped, elapsed stays frozen
    await page.waitForTimeout(700);
    expect(await readElapsedMs(page)).toBe(stoppedMs);

    // Start again → must RESUME (elapsed continues from stoppedMs, not reset to 0)
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await page.waitForTimeout(500);
    const resumedMs = await readElapsedMs(page);
    expect(resumedMs).toBeGreaterThanOrEqual(stoppedMs);
    expect(resumedMs).toBeLessThan(stoppedMs + 2000);
  });

  test('stop then delayed start resumes without countdown drift', async ({ page }) => {
    await page.goto('/stopwatch');

    // Run ~1 s with no delay, then stop
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /stop stopwatch/i }).click();
    const stoppedMs = await readElapsedMs(page);
    expect(stoppedMs).toBeGreaterThanOrEqual(800);

    // Select a 3 s delay and start again → countdown runs first
    await page.getByTestId('sw-delay-3').click();
    await page.getByTestId('sw-primary-btn').click();
    await expect(page.getByTestId('sw-countdown-number')).toBeVisible({ timeout: 1000 });

    // Wait for countdown to finish and the stopwatch to be running again
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible({ timeout: 4500 });

    // Elapsed resumes from stoppedMs: the 3 s countdown must NOT be added,
    // and the accumulated time must NOT be reset to 0.
    await page.waitForTimeout(300);
    const resumedMs = await readElapsedMs(page);
    expect(resumedMs).toBeGreaterThanOrEqual(stoppedMs);
    expect(resumedMs).toBeLessThan(stoppedMs + 2000);
  });

});
