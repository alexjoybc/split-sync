/**
 * E2E spec: /stopwatch solo page
 *
 * Tests that:
 *   - Page loads with no sign-in
 *   - Dial and pushers are visible
 *   - Start/stop/reset basic flow
 *   - Lap records and best-lap highlight
 *   - No organizer controls present
 *   - Keyboard shortcuts (Space / L)
 */
import { test, expect } from '@playwright/test';

test.describe('/stopwatch solo page', () => {

  test('page loads without sign-in', async ({ page }) => {
    await page.goto('/stopwatch');
    await expect(page).toHaveTitle(/stopwatch.*SplitSync|SplitSync/i);
    await expect(page.locator('body')).toBeVisible();
  });

  test('dial timer is visible and starts at 00:00', async ({ page }) => {
    await page.goto('/stopwatch');
    const timer = page.getByRole('timer');
    await expect(timer).toBeVisible();
    await expect(timer).toContainText('00:00');
  });

  test('Start and Stop pushers are visible', async ({ page }) => {
    await page.goto('/stopwatch');
    await expect(page.getByRole('button', { name: /start stopwatch/i })).toBeVisible();
    // Secondary pusher in idle state is disabled but visible
    await expect(page.getByRole('button', { name: /reset stopwatch/i })).toBeVisible();
  });

  test('start, stop, reset cycle works', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    // After starting, button label changes to "Stop"
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible();

    // Let it run briefly
    await page.waitForTimeout(200);

    // Stop
    await page.getByRole('button', { name: /stop stopwatch/i }).click();
    await expect(page.getByRole('button', { name: /start stopwatch/i })).toBeVisible();

    // Reset via secondary pusher
    await page.getByRole('button', { name: /reset stopwatch/i }).click();
    // After reset: timer shows 00:00 again
    const timer = page.getByRole('timer');
    await expect(timer).toContainText('00:00');
  });

  test('lap recording shows lap list and highlights best lap', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start
    await page.getByRole('button', { name: /start stopwatch/i }).click();

    // Record first lap
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: /record lap/i }).click();

    // Record second lap (shorter — will be best)
    await page.waitForTimeout(50);
    await page.getByRole('button', { name: /record lap/i }).click();

    // Lap section should be visible
    await expect(page.getByRole('table', { name: /lap times/i })).toBeVisible();

    // Best lap row should carry star indicator
    await expect(page.locator('.sw-lap-row--best')).toBeVisible();
  });

  test('keyboard shortcut Space starts and stops', async ({ page }) => {
    await page.goto('/stopwatch');

    // Focus body so keydown fires
    await page.locator('body').click();

    // Space starts
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible();

    await page.waitForTimeout(100);

    // Space stops
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /start stopwatch/i })).toBeVisible();
  });

  test('keyboard shortcut L records a lap while running', async ({ page }) => {
    await page.goto('/stopwatch');
    await page.locator('body').click();

    // Start
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);

    // Lap
    await page.keyboard.press('l');
    await expect(page.getByRole('table', { name: /lap times/i })).toBeVisible();
  });

  test('"Time together" stub is visible but disabled', async ({ page }) => {
    await page.goto('/stopwatch');
    const stub = page.getByLabel(/time together/i);
    await expect(stub).toBeVisible();
    await expect(stub).toHaveAttribute('aria-disabled', 'true');
  });

  test('no organizer controls present', async ({ page }) => {
    await page.goto('/stopwatch');
    await expect(page.getByRole('button', { name: /start race/i })).not.toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('button', { name: /finish race/i })).not.toBeVisible({ timeout: 2_000 });
  });
});
