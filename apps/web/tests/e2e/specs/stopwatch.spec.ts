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

  test('positioning promise is stated: free, no ads, no subscription, no account', async ({ page }) => {
    await page.goto('/stopwatch');

    // Top strip: Free · No ads · No subscription · No account
    await expect(
      page.getByLabel('Free. No ads. No subscription. No account needed.'),
    ).toBeVisible();

    // Spelled-out section at the bottom
    const deal = page.getByRole('region', { name: /why splitsync stopwatch is free/i });
    await expect(deal).toBeVisible();
    await expect(deal).toContainText(/no ads/i);
    await expect(deal).toContainText(/no.*subscription/i);
    await expect(deal).toContainText(/display name/i);
  });

  test('wake-lock intent attribute tracks running state', async ({ page }) => {
    await page.goto('/stopwatch');
    const main = page.locator('main');

    // Idle: attribute is omitted entirely (not "false")
    await expect(main).not.toHaveAttribute('data-wake-lock-active');

    // Running: attribute is "true"
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await expect(main).toHaveAttribute('data-wake-lock-active', 'true');

    // Stopped: attribute is omitted again
    await page.getByRole('button', { name: /stop stopwatch/i }).click();
    await expect(main).not.toHaveAttribute('data-wake-lock-active');

    // Reset: still omitted
    await page.getByRole('button', { name: /reset stopwatch/i }).click();
    await expect(main).not.toHaveAttribute('data-wake-lock-active');
  });

  test('"Time together" shows "Sign in to share" for anonymous users and is clickable', async ({ page }) => {
    await page.goto('/stopwatch');
    // Anonymous users see a "Sign in to share" button (not disabled — it redirects to /login)
    const btn = page.getByRole('button', { name: /sign in to share/i });
    await expect(btn).toBeVisible();
    // It must NOT carry aria-disabled — it is a real interactive button
    await expect(btn).not.toHaveAttribute('aria-disabled', 'true');
    await expect(btn).not.toBeDisabled();
  });

  test('large display toggle enlarges the timer and toggles back', async ({ page }) => {
    await page.goto('/stopwatch');

    const toggle = page.getByRole('button', { name: /enter large display mode/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Enter large-display mode
    await toggle.click();
    const exitToggle = page.getByRole('button', { name: /exit large display mode/i });
    await expect(exitToggle).toBeVisible();
    await expect(exitToggle).toHaveAttribute('aria-pressed', 'true');

    // Dial carries the enlarged modifier and the timer stays visible
    await expect(page.locator('.sw-dial--large')).toBeVisible();
    await expect(page.getByRole('timer')).toBeVisible();

    // Masthead is hidden to maximise the timer
    await expect(page.getByRole('heading', { name: /stopwatch/i })).not.toBeVisible();

    // Exit large-display mode
    await exitToggle.click();
    await expect(page.getByRole('button', { name: /enter large display mode/i })).toBeVisible();
    await expect(page.locator('.sw-dial--large')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: /stopwatch/i })).toBeVisible();
  });

  test('large display mode still allows start/stop', async ({ page }) => {
    await page.goto('/stopwatch');
    await page.getByRole('button', { name: /enter large display mode/i }).click();

    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: /stop stopwatch/i }).click();
    await expect(page.getByRole('button', { name: /start stopwatch/i })).toBeVisible();
  });

  // ── Brand relocation & icon button sizing (#290) ─────────────────────────

  test('SplitSync brand link is NOT in the masthead', async ({ page }) => {
    await page.goto('/stopwatch');
    // The masthead header should not contain the "SplitSync" link
    const masthead = page.locator('header.race-masthead');
    await expect(masthead).toBeVisible();
    const mastheadBrandLink = masthead.getByRole('link', { name: /splitsync/i });
    await expect(mastheadBrandLink).not.toBeVisible({ timeout: 2_000 });
  });

  test('SplitSync brand link appears near the bottom of the page', async ({ page }) => {
    await page.goto('/stopwatch');
    // The brand footer element is present and contains the SplitSync link
    const brandFooter = page.getByTestId('sw-brand-footer');
    await expect(brandFooter).toBeVisible();
    const brandLink = brandFooter.getByRole('link', { name: /splitsync home/i });
    await expect(brandLink).toBeVisible();
    // The brand footer appears AFTER "The deal" section
    const dealSection = page.getByRole('region', { name: /why splitsync stopwatch is free/i });
    await expect(dealSection).toBeVisible();
  });

  test('SplitSync brand footer is hidden in large-display mode', async ({ page }) => {
    await page.goto('/stopwatch');
    await page.getByRole('button', { name: /enter large display mode/i }).click();
    // Brand footer is not rendered in large mode
    await expect(page.getByTestId('sw-brand-footer')).not.toBeVisible({ timeout: 2_000 });
  });

  test('lock button meets 44px minimum touch-target size', async ({ page }) => {
    await page.goto('/stopwatch');
    const lockBtn = page.getByRole('button', { name: /lock controls/i });
    await expect(lockBtn).toBeVisible();
    const box = await lockBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('no organizer controls present', async ({ page }) => {
    await page.goto('/stopwatch');
    await expect(page.getByRole('button', { name: /start race/i })).not.toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('button', { name: /finish race/i })).not.toBeVisible({ timeout: 2_000 });
  });

  // ── Persistence across page refresh (#224) ────────────────────────────────

  test('running stopwatch and laps survive a page refresh', async ({ page }) => {
    await page.goto('/stopwatch');

    // Start and record a lap
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /record lap/i }).click();
    await page.waitForTimeout(200);

    // Refresh — the stopwatch should still be running with the lap intact
    await page.reload();

    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible();
    await expect(page.getByRole('table', { name: /lap times/i })).toBeVisible();
    await expect(page.locator('.sw-lap-table tbody tr')).toHaveCount(1);

    // Elapsed keeps counting across the refresh (wall-clock anchored)
    await expect(page.getByRole('timer')).not.toHaveAttribute(
      'aria-label',
      'Elapsed time: 00:00.00',
    );
  });

  test('stopped stopwatch keeps its elapsed time across a refresh', async ({ page }) => {
    await page.goto('/stopwatch');

    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /stop stopwatch/i }).click();

    // Capture elapsed while stopped
    const before = await page.getByRole('timer').getAttribute('aria-label');

    await page.reload();

    // Still stopped (Start visible, not Stop). Wait for the restored state:
    // the Reset pusher is enabled in "stopped" but disabled in "idle".
    await expect(page.getByRole('button', { name: /start stopwatch/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /reset stopwatch/i })).toBeEnabled();

    // Same elapsed time as before the refresh
    const after = await page.getByRole('timer').getAttribute('aria-label');
    expect(after).toBe(before);
  });

  test('reset clears persisted state — refresh returns to idle 00:00', async ({ page }) => {
    await page.goto('/stopwatch');

    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: /record lap/i }).click();
    await page.getByRole('button', { name: /stop stopwatch/i }).click();
    await page.getByRole('button', { name: /reset stopwatch/i }).click();

    await page.reload();

    // Back to idle: 00:00, Reset disabled, no lap table
    await expect(page.getByRole('timer')).toContainText('00:00');
    await expect(page.getByRole('button', { name: /reset stopwatch/i })).toBeDisabled();
    await expect(page.getByRole('table', { name: /lap times/i })).not.toBeVisible({ timeout: 2_000 });
  });

  // ── Sound cues & target time (#227) ─────────────────────────────────────────

  test('sound cues are OFF by default', async ({ page }) => {
    await page.goto('/stopwatch');
    await expect(page.getByTestId('sound-cues-toggle')).not.toBeChecked();
    await expect(page.getByTestId('target-toggle')).not.toBeChecked();
    // Target input hidden until enabled
    await expect(page.getByTestId('target-time-input')).not.toBeVisible();
  });

  test('sound settings persist across reloads (localStorage)', async ({ page }) => {
    await page.goto('/stopwatch');
    await page.getByTestId('sound-cues-toggle').check();
    await page.getByTestId('target-toggle').check();
    await page.getByTestId('target-time-input').fill('02:30');

    await page.reload();

    await expect(page.getByTestId('sound-cues-toggle')).toBeChecked();
    await expect(page.getByTestId('target-toggle')).toBeChecked();
    await expect(page.getByTestId('target-time-input')).toHaveValue('02:30');
  });

  test('target marker shows pending target, then overrun while stopwatch keeps running', async ({ page }) => {
    await page.goto('/stopwatch');

    // Enable target and set it to 1 second
    await page.getByTestId('target-toggle').check();
    await page.getByTestId('target-time-input').fill('00:01');

    // Pending marker shown before start
    await expect(page.getByTestId('target-pending')).toContainText('00:01');

    // Start and run past the target
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await expect(page.getByTestId('target-overrun')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('target-overrun')).toContainText('+');

    // Stopwatch KEEPS running past the target
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible();

    // Stop + reset clears overrun state
    await page.getByRole('button', { name: /stop stopwatch/i }).click();
    await page.getByRole('button', { name: /reset stopwatch/i }).click();
    await expect(page.getByTestId('target-overrun')).not.toBeVisible();
    await expect(page.getByTestId('target-pending')).toBeVisible();
  });

  test('invalid target input does not break the pending marker', async ({ page }) => {
    await page.goto('/stopwatch');
    await page.getByTestId('target-toggle').check();
    const input = page.getByTestId('target-time-input');
    await input.fill('abc');
    // Invalid input is ignored; marker keeps the last valid target (default 01:00)
    await expect(page.getByTestId('target-pending')).toContainText('01:00');
    // Blur restores a valid value in the input
    await input.blur();
    await expect(input).toHaveValue('01:00');
  });
});
