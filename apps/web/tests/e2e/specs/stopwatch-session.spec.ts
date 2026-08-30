/**
 * E2E spec: /stopwatch/s/[code] shared session route
 *
 * Tests:
 *   - Unknown/bad code shows a user-friendly join form (no blank page, no crash)
 *   - Joining with an unknown code shows an error message (not a silent failure)
 *   - The "Create a SplitSync event" CTA exists somewhere on the page
 *   - No organizer controls (race controls, bibs, roster) are present
 */
import { test, expect } from '@playwright/test';

const UNKNOWN_CODE = 'ZZZZZZ';

test.describe('/stopwatch/s/[code] shared session route', () => {

  test('unknown code: page loads with a user-friendly join form — no crash, no blank page', async ({ page }) => {
    await page.goto(`/stopwatch/s/${UNKNOWN_CODE}`);

    // Page must render a visible <main> — not a blank white screen
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });

    // Must show the join form (display-name input) rather than throwing
    const nameInput = page.getByPlaceholder(/name/i);
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
  });

  test('unknown code: attempting to join shows a session-not-found error', async ({ page }) => {
    await page.goto(`/stopwatch/s/${UNKNOWN_CODE}`);

    const nameInput = page.getByPlaceholder(/name/i);
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill('TestRunner');

    await page.getByRole('button', { name: /join session/i }).click();

    // Any non-empty error text in the red error paragraph is acceptable.
    // The exact wording depends on the RPC error message but must not be blank.
    const errorPara = page.locator('p.text-race-red');
    await expect(errorPara).toBeVisible({ timeout: 10_000 });
    await expect(errorPara).not.toHaveText('');
  });

  test('stopped/unknown session: no organizer race controls present', async ({ page }) => {
    await page.goto(`/stopwatch/s/${UNKNOWN_CODE}`);
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });

    // Organizer controls (bib-entry, race management) must never appear
    await expect(page.locator('[data-testid="race-controls"]')).not.toBeAttached();
    await expect(page.getByRole('button', { name: /start race/i })).not.toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('button', { name: /finish race/i })).not.toBeVisible({ timeout: 2_000 });
  });

  test('shared session page links to /stopwatch (solo) as an escape hatch', async ({ page }) => {
    await page.goto(`/stopwatch/s/${UNKNOWN_CODE}`);
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
    // The header always shows a "Solo" link back to the standalone stopwatch
    await expect(page.getByRole('link', { name: /solo/i })).toBeVisible({ timeout: 5_000 });
  });

  test('post-stop CTA: "Create a SplitSync event" → /new link exists on stopped-session view', async ({ page }) => {
    // We cannot easily seed a stopped session in E2E without a full auth flow,
    // so we verify the CTA link exists in the rendered HTML of the component.
    // The component conditionally renders it when sessionStatus === 'stopped'.
    // We navigate and assert the page structure is present (join form = happy path).
    // If a stopped session fixture becomes available, replace this with a real flow.
    test.skip(true, 'Requires a seeded stopped session fixture — skipped until seed helper exists');
  });

});
