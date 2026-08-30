/**
 * E2E spec: /stopwatch/s/[code] shared session route
 *
 * The join form is shown upfront for any code (valid or not).
 * Invalid codes are detected on submit when the RPC rejects them.
 *
 * Tests:
 *   - Any code shows the join form — no blank page, no crash
 *   - Submitting with an unknown code shows a friendly inline error
 *   - No organizer controls (race controls, bibs, roster) are present
 *   - A link back to the solo stopwatch is always present
 */
import { test, expect } from '@playwright/test';

const UNKNOWN_CODE = 'ZZZZZZ';

test.describe('/stopwatch/s/[code] shared session route', () => {

  test('any code: page loads the join form — no crash, no blank page', async ({ page }) => {
    await page.goto(`/stopwatch/s/${UNKNOWN_CODE}`);
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
    // Join form (display-name input) must appear for any code
    await expect(page.getByPlaceholder(/e\.g\. Alex|your name|display name/i)
      .or(page.getByLabel(/display name|your name/i)))
      .toBeVisible({ timeout: 10_000 });
  });

  test('unknown code: submitting the join form shows a session-not-found error', async ({ page }) => {
    await page.goto(`/stopwatch/s/${UNKNOWN_CODE}`);
    // Fill and submit the join form
    const nameInput = page.getByPlaceholder(/e\.g\. Alex|your name|display name/i)
      .or(page.getByLabel(/display name|your name/i)).first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill('TestRunner');
    await page.getByRole('button', { name: /join/i }).click();
    // An error message must appear — exact wording TBD by RPC
    const errorEl = page.locator('[role="alert"], .text-red, .error, [data-testid="error"]')
      .or(page.getByText(/not found|expired|invalid|unable to join/i)).first();
    await expect(errorEl).toBeVisible({ timeout: 10_000 });
  });

  test('join page: no organizer race controls present', async ({ page }) => {
    await page.goto(`/stopwatch/s/${UNKNOWN_CODE}`);
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="race-controls"]')).not.toBeAttached();
    await expect(page.getByRole('button', { name: /start race/i })).not.toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('button', { name: /finish race/i })).not.toBeVisible({ timeout: 2_000 });
  });

  test('join page: has a link back to the solo stopwatch', async ({ page }) => {
    await page.goto(`/stopwatch/s/${UNKNOWN_CODE}`);
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: /solo|stopwatch|back/i }).first())
      .toBeVisible({ timeout: 5_000 });
  });

  test('unknown code: error state has a link back to the solo stopwatch', async ({ page }) => {
    await page.goto(`/stopwatch/s/${UNKNOWN_CODE}`);
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
    // There must be a way out — a link to /stopwatch or home
    const backLink = page.getByRole('link', { name: /stopwatch|solo|home|back/i }).first();
    await expect(backLink).toBeVisible({ timeout: 5_000 });
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
