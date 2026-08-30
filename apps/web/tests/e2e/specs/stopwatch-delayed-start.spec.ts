/**
 * E2E spec: /stopwatch — delayed start (countdown-to-start) feature
 *
 * Solo mode only. Tests:
 *   1. Delay selector is visible in idle state.
 *   2. Select 3 s → click Start → countdown appears (shows "3", "2", or "1").
 *   3. Wait for countdown to end → stopwatch transitions to RUNNING.
 *   4. Cancel during countdown → returns to idle without starting.
 *   5. With OFF delay, clicking Start immediately transitions to running (no countdown).
 */
import { test, expect } from '@playwright/test';

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

  test('delay selector is hidden while running', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start without delay
    await page.getByRole('button', { name: /start stopwatch/i }).click();

    // Delay selector should not be visible during run
    await expect(page.getByTestId('sw-delay-selector')).not.toBeVisible({ timeout: 500 });
  });

});
