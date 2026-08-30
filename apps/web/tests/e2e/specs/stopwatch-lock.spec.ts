/**
 * E2E spec: /stopwatch lock controls (#235)
 *
 * Covers:
 *   - Lock button visible and toggles locked state
 *   - While locked: Stop tap does nothing (timer still running)
 *   - While locked: Reset tap does nothing (timer stays stopped)
 *   - Lap still records while locked
 *   - Press-and-hold the lock icon for 1.5 s unlocks controls
 *   - After unlock: Stop works normally
 */
import { test, expect } from '@playwright/test';

test.describe('/stopwatch lock controls', () => {

  test('lock button is visible', async ({ page }) => {
    await page.goto('/stopwatch');
    const lockBtn = page.getByRole('button', { name: /lock controls/i });
    await expect(lockBtn).toBeVisible();
    await expect(lockBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('clicking lock button locks controls', async ({ page }) => {
    await page.goto('/stopwatch');

    const lockBtn = page.getByRole('button', { name: /lock controls/i });
    await lockBtn.click();

    // aria-label changes to reflect locked state
    await expect(
      page.getByRole('button', { name: /controls locked/i })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /controls locked/i })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('Stop does nothing while locked (timer keeps running)', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start the timer
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible();

    // Wait a moment so the display advances
    await page.waitForTimeout(300);

    // Lock controls
    await page.getByRole('button', { name: /lock controls/i }).click();
    await expect(page.getByRole('button', { name: /controls locked/i })).toBeVisible();

    // The Stop pusher should still be present but clicking it should do nothing
    await page.getByRole('button', { name: /stop stopwatch/i }).click();

    // After the click, Stop should still be the button label (timer is still running)
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible();

    // Lock hint should appear
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(/locked/i);
  });

  test('Lap still records while locked', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start
    await page.getByRole('button', { name: /start stopwatch/i }).click();

    // Lock
    await page.getByRole('button', { name: /lock controls/i }).click();

    // Record a lap — should still work
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: /record lap/i }).click();

    // Lap table should appear
    await expect(page.getByRole('table', { name: /lap times/i })).toBeVisible();
  });

  test('Reset does nothing while locked (stopped state)', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start then stop
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /stop stopwatch/i }).click();
    await expect(page.getByRole('button', { name: /start stopwatch/i })).toBeVisible();

    // Lock
    await page.getByRole('button', { name: /lock controls/i }).click();

    // Click Reset — should do nothing (timer value should remain non-zero and visible)
    const timer = page.getByRole('timer');
    const valueBefore = await timer.textContent();
    await page.getByRole('button', { name: /reset stopwatch/i }).click();
    const valueAfter = await timer.textContent();

    // Value should not have reset to 00:00
    expect(valueAfter).toBe(valueBefore);

    // Hint is shown
    await expect(page.getByRole('alert')).toBeVisible();
  });

  test('press-and-hold lock icon for 1.5 s unlocks controls', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start
    await page.getByRole('button', { name: /start stopwatch/i }).click();

    // Lock
    await page.getByRole('button', { name: /lock controls/i }).click();
    const lockedBtn = page.getByRole('button', { name: /controls locked/i });
    await expect(lockedBtn).toBeVisible();

    // Simulate press-and-hold on the lock icon: pointerdown → wait 1600 ms → pointerup
    await lockedBtn.dispatchEvent('pointerdown');
    await page.waitForTimeout(1600);
    await lockedBtn.dispatchEvent('pointerup');

    // Should now be unlocked
    await expect(page.getByRole('button', { name: /lock controls/i })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /lock controls/i })
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('Stop works normally after unlocking', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start
    await page.getByRole('button', { name: /start stopwatch/i }).click();

    // Lock
    await page.getByRole('button', { name: /lock controls/i }).click();

    // Unlock via long press
    const lockedBtn = page.getByRole('button', { name: /controls locked/i });
    await lockedBtn.dispatchEvent('pointerdown');
    await page.waitForTimeout(1600);
    await lockedBtn.dispatchEvent('pointerup');

    // Stop should now work
    await page.getByRole('button', { name: /stop stopwatch/i }).click();
    await expect(page.getByRole('button', { name: /start stopwatch/i })).toBeVisible();
  });

  test('short press on locked icon does not unlock', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start and lock
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await page.getByRole('button', { name: /lock controls/i }).click();

    // Short press (< 1.5 s) should NOT unlock
    const lockedBtn = page.getByRole('button', { name: /controls locked/i });
    await lockedBtn.dispatchEvent('pointerdown');
    await page.waitForTimeout(500);
    await lockedBtn.dispatchEvent('pointerup');

    // Still locked
    await expect(lockedBtn).toBeVisible();
    await expect(lockedBtn).toHaveAttribute('aria-pressed', 'true');
  });
});
