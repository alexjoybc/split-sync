/**
 * E2E spec: delete session from SessionHistory (#381)
 *
 * Covers:
 *   1. Creator (signed-in) creates a session via the "Time together" modal.
 *   2. Session appears in "My Sessions" history list.
 *   3. Creator clicks the trash icon → inline confirmation prompt appears.
 *   4. Creator confirms → session row disappears from the list.
 *
 * Auth model:
 *   - Uses `authenticatedPage` fixture (Supabase session injected via
 *     localStorage — same pattern as stopwatch-shared.spec.ts).
 *
 * Prerequisites:
 *   - Local Supabase must be running (supabase start + supabase db reset).
 *   - If Supabase is unavailable all tests in this file are skipped.
 */
import { test, expect } from '../fixtures/auth';

// ---------------------------------------------------------------------------
// Skip when local Supabase is not running
// ---------------------------------------------------------------------------

test.beforeEach(async () => {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
  try {
    const res = await fetch(`${supabaseUrl}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) {
      test.skip(true, 'Local Supabase not running — skipping delete session tests');
    }
  } catch {
    test.skip(true, 'Local Supabase not running — skipping delete session tests');
  }
});

// ---------------------------------------------------------------------------
// Helper: create a session via the modal and return to /stopwatch
// ---------------------------------------------------------------------------

async function createSessionViaModal(
  page: import('@playwright/test').Page,
  sessionName = 'Delete Me',
  creatorName = 'TestRunner',
): Promise<void> {
  await page.goto('/stopwatch');

  // Open the "Time together" modal
  await page.getByRole('button', { name: /time together/i }).click({ timeout: 5_000 });
  await expect(
    page.getByRole('dialog', { name: /time together/i }),
  ).toBeVisible({ timeout: 5_000 });

  // Fill session name and display name
  await page.getByLabel(/session name/i).fill(sessionName);
  await page.getByLabel(/your display name/i).fill(creatorName);

  // Submit
  await page.getByRole('button', { name: /create session/i }).click();

  // Wait for share-link view then close the modal by navigating back to /stopwatch
  await expect(
    page.getByRole('button', { name: /open session/i }),
  ).toBeVisible({ timeout: 10_000 });

  // Close modal / go back to session list
  const closeBtn = page
    .getByRole('button', { name: /close/i })
    .or(page.getByLabel(/close/i))
    .first();
  if (await closeBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await closeBtn.click();
  } else {
    // Navigate directly back to /stopwatch so the session history is visible
    await page.goto('/stopwatch');
  }

  // The session history section must be present
  await expect(
    page.getByRole('region', { name: /my timing sessions/i }),
  ).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Session delete — SessionHistory', () => {
  test(
    'create session → delete button shows inline confirmation → confirm → row disappears',
    async ({ authenticatedPage: page }) => {
      const sessionName = `Delete-${Date.now()}`;
      await createSessionViaModal(page, sessionName, 'TestRunner');

      // The session row must be present in the list
      const sessionRow = page
        .getByRole('region', { name: /my timing sessions/i })
        .getByText(sessionName)
        .first();
      await expect(sessionRow).toBeVisible({ timeout: 10_000 });

      // Find the trash icon button for this session row.
      // We locate the section, then the row container that contains the name,
      // then the delete button inside it.
      const historySection = page.getByRole('region', { name: /my timing sessions/i });
      const rowContainer = historySection
        .locator('[data-testid^="session-row-"]')
        .filter({ hasText: sessionName })
        .first();
      await expect(rowContainer).toBeVisible({ timeout: 5_000 });

      // Click the trash icon (delete) button
      const deleteBtn = rowContainer.getByRole('button', { name: /delete session/i });
      await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
      await deleteBtn.click();

      // Inline confirmation prompt must appear
      await expect(rowContainer.getByText(/delete\?/i)).toBeVisible({
        timeout: 3_000,
      });

      // Click "Yes" to confirm
      const confirmBtn = rowContainer.getByRole('button', { name: /yes/i });
      await expect(confirmBtn).toBeVisible({ timeout: 3_000 });
      await confirmBtn.click();

      // The session row must disappear (real-time subscription re-renders the list)
      await expect(sessionRow).not.toBeVisible({ timeout: 15_000 });
    },
  );

  test(
    'delete confirmation: clicking No cancels the prompt without deleting',
    async ({ authenticatedPage: page }) => {
      const sessionName = `NoDelete-${Date.now()}`;
      await createSessionViaModal(page, sessionName, 'TestRunner');

      const historySection = page.getByRole('region', { name: /my timing sessions/i });
      const rowContainer = historySection
        .locator('[data-testid^="session-row-"]')
        .filter({ hasText: sessionName })
        .first();
      await expect(rowContainer).toBeVisible({ timeout: 10_000 });

      // Click trash
      await rowContainer.getByRole('button', { name: /delete session/i }).click();

      // Confirmation prompt visible
      await expect(rowContainer.getByText(/delete\?/i)).toBeVisible({
        timeout: 3_000,
      });

      // Click "No"
      await rowContainer.getByRole('button', { name: /no/i }).click();

      // Prompt disappears, row is still present
      await expect(rowContainer.getByText(/delete\?/i)).not.toBeVisible({
        timeout: 3_000,
      });
      await expect(rowContainer).toBeVisible({ timeout: 3_000 });
    },
  );
});
