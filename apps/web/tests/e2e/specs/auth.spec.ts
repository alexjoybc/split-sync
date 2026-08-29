/**
 * Auth E2E specs.
 *
 * Spec 1 — Login form: exercises the actual /login UI so that the happy-path
 *   sign-in flow is validated end-to-end against the real page markup.
 *
 * Spec 2 — Password reset email: exercises /auth/forgot-password → Mailpit
 *   email capture. We verify the email is received but do not follow the
 *   reset link (it points to the site_url, not localhost, when tested locally).
 */
import { test, expect } from '@playwright/test';
import { uniqueTestEmail, createTestOrganizer } from '../helpers/supabase';
import { getLatestEmailTo } from '../helpers/mailpit';

test.describe('Login form', () => {
  test('organizer can sign in via login form', async ({ page }) => {
    const email = uniqueTestEmail('login-form');
    const password = 'TestPass123!';

    // Create the user programmatically so the form test is isolated.
    await createTestOrganizer(email, password);

    await page.goto('/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button:has-text("Sign in")');

    // After a successful sign-in the app redirects to /events.
    await expect(page).toHaveURL(/\/events/, { timeout: 10_000 });
  });
});

test.describe('Password reset email flow', () => {
  test('sends a password-reset email that appears in Mailpit', async ({
    page,
  }) => {
    const email = uniqueTestEmail('reset');
    await createTestOrganizer(email, 'OldPass123!');

    await page.goto('/auth/forgot-password');
    await page.fill('input[type="email"]', email);
    await page.click('button[type="submit"]');

    // The page should show a confirmation message.
    await expect(page.getByText(/check your/i)).toBeVisible({
      timeout: 5_000,
    });

    // Verify the email arrived in Mailpit (local SMTP sink).
    const { body } = await getLatestEmailTo(email, 15_000);
    expect(body.toLowerCase()).toContain('reset');
  });
});
