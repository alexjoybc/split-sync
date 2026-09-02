/**
 * E2E spec: creator retains owner identity on their own shared session (#332)
 *
 * Regression covered:
 *   Before the fix, create_casual_session's session_id/participant_id were
 *   discarded on the /stopwatch create modal, so the creator's own browser
 *   had no stored participant for the new session. Landing on
 *   /stopwatch/s/[code] then treated them as a first-time visitor, routing
 *   them through JoinForm and creating a second, non-owner participant row.
 *   That broke the owner-only `reset` (rematch) RPC for the actual creator.
 *
 * This spec asserts the creator:
 *   1. Lands directly on the shared session view after creating (no JoinForm)
 *   2. Is shown as the sole participant, tagged "owner" and "you"
 *   3. Can start/stop the session
 *   4. Can successfully call the owner-only reset ("Reset & start again")
 *      after the session is stopped, and the session returns to "Waiting"
 *
 * Prerequisites:
 *   - Local Supabase must be running (supabase start + supabase db reset)
 *   - If Supabase is unavailable all tests are skipped automatically
 *
 * Mirrors the setup/teardown pattern in stopwatch-shared.spec.ts.
 */
import { test, expect } from '../fixtures/auth';

test.beforeEach(async () => {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  try {
    const res = await fetch(`${supabaseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) {
      test.skip(true, 'Local Supabase not running — skipping owner identity tests');
    }
  } catch {
    test.skip(true, 'Local Supabase not running — skipping owner identity tests');
  }
});

test.describe('Creator owner identity', () => {
  test('creator lands on shared session as owner, stops, and resets (rematch)', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/stopwatch');

    await page.getByRole('button', { name: /time together/i }).click({ timeout: 5_000 });
    await expect(
      page.getByRole('dialog', { name: /time together/i }),
    ).toBeVisible({ timeout: 5_000 });

    await page.getByLabel(/session name/i).fill('Owner Identity Test');
    await page.getByLabel(/your display name/i).fill('Creator');
    await page.getByRole('button', { name: /create session/i }).click();

    await page.getByRole('button', { name: /open session/i }).click({ timeout: 10_000 });
    await page.waitForURL(/\/stopwatch\/s\/[A-Z0-9]{6}/i, { timeout: 10_000 });

    // The creator lands directly on the session view — no JoinForm
    // ("Your display name" input must not appear).
    await expect(page.getByLabel(/your display name/i)).not.toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Owner Identity Test',
      { timeout: 10_000 },
    );

    // Exactly one participant: the creator, tagged both "owner" and "you".
    const participantChips = page.locator(
      'section[aria-label="Participants"] .flex > span',
    );
    await expect(participantChips).toHaveCount(1, { timeout: 5_000 });
    await expect(participantChips.first()).toContainText('Creator');
    await expect(participantChips.first()).toContainText(/owner/i);
    await expect(participantChips.first()).toContainText(/you/i);

    // Start then stop the session.
    await page.getByRole('button', { name: /start session/i }).click();
    await expect(
      page.locator('.race-kicker').filter({ hasText: /live/i }),
    ).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: /stop session/i }).click();
    await expect(
      page.locator('.race-kicker').filter({ hasText: /stopped/i }),
    ).toBeVisible({ timeout: 5_000 });

    // Owner-only reset ("Reset & start again") succeeds for the creator.
    const resetBtn = page.getByRole('button', { name: /reset & start again/i });
    await expect(resetBtn).toBeVisible({ timeout: 5_000 });
    await resetBtn.click();

    // Session returns to "Waiting" — no owner-check error surfaced.
    await expect(
      page.locator('.race-kicker').filter({ hasText: /waiting/i }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.text-race-red')).toHaveCount(0);
  });
});
