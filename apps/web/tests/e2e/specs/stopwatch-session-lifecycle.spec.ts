/**
 * E2E spec: owner-initiated close/delete of a shared stopwatch session (#345)
 *
 * Prior to this, a session had no way to be ended or removed by its creator
 * other than letting its 4-hour join expiry pass — and the row was never
 * cleaned up. This asserts the two new owner actions from the in-session
 * view:
 *   1. Closing a session marks it closed, disables Start, and shows the
 *      "closed by the host" banner.
 *   2. Deleting a session removes it from the creator's "My Sessions" list.
 *
 * Prerequisites:
 *   - Local Supabase must be running (supabase start + supabase db reset)
 *   - If Supabase is unavailable all tests are skipped automatically
 *
 * Mirrors the setup/teardown pattern in stopwatch-owner-identity.spec.ts.
 */
import { test, expect } from '../fixtures/auth';

test.beforeEach(async () => {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) {
      test.skip(true, 'Local Supabase not running — skipping session lifecycle tests');
    }
  } catch {
    test.skip(true, 'Local Supabase not running — skipping session lifecycle tests');
  }
});

async function createSession(page: import('@playwright/test').Page, name: string) {
  await page.goto('/stopwatch');
  await page.getByRole('button', { name: /time together/i }).click({ timeout: 5_000 });
  await expect(
    page.getByRole('dialog', { name: /time together/i }),
  ).toBeVisible({ timeout: 5_000 });
  await page.getByLabel(/session name/i).fill(name);
  await page.getByLabel(/your display name/i).fill('Creator');
  await page.getByRole('button', { name: /create session/i }).click();
  await page.getByRole('button', { name: /open session/i }).click({ timeout: 10_000 });
  await page.waitForURL(/\/stopwatch\/s\/[A-Z0-9]{6}/i, { timeout: 10_000 });
}

test.describe('Owner session lifecycle: close and delete', () => {
  test('owner can close a session — Start disables, closed banner appears', async ({
    authenticatedPage: page,
  }) => {
    await createSession(page, 'Close Me');

    const closeBtn = page.getByRole('button', { name: /^close session$/i });
    await expect(closeBtn).toBeVisible({ timeout: 5_000 });

    page.once('dialog', (dialog) => dialog.accept());
    await closeBtn.click();

    await expect(
      page.locator('.race-kicker').filter({ hasText: /closed/i }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/closed by the host/i)).toBeVisible({
      timeout: 5_000,
    });
    // Start/Lap controls are gone once closed.
    await expect(
      page.getByRole('button', { name: /start session/i }),
    ).not.toBeVisible();
    // "Close session" is a one-way action — the button disappears once closed.
    await expect(closeBtn).not.toBeVisible();
  });

  test('owner can delete a session — it disappears from My Sessions', async ({
    authenticatedPage: page,
  }) => {
    await createSession(page, 'Delete Me');

    const deleteBtn = page.getByRole('button', { name: /^delete session$/i });
    await expect(deleteBtn).toBeVisible({ timeout: 5_000 });

    page.once('dialog', (dialog) => dialog.accept());
    await deleteBtn.click();

    // Deleting from the in-session view returns to the solo stopwatch page.
    await page.waitForURL(/\/stopwatch$/, { timeout: 10_000 });
    await expect(
      page.locator('section[aria-label="My timing sessions"]').getByText('Delete Me'),
    ).toHaveCount(0);
  });
});
