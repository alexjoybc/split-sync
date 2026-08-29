/**
 * Playwright fixtures for organizer authentication.
 *
 * `authenticatedPage` gives a Page with a Supabase session already injected
 * via localStorage — no round-trip through the login UI, so it completes well
 * under the 5 s target.
 *
 * Import `test` and `expect` from this module instead of `@playwright/test`
 * when you need an authenticated context.
 */
import { test as base, type Page } from '@playwright/test';
import {
  uniqueTestEmail,
  createTestOrganizer,
  signInProgrammatically,
} from '../helpers/supabase';

type AuthFixtures = {
  organizerEmail: string;
  organizerPassword: string;
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  organizerEmail: async ({}, use) => {
    await use(uniqueTestEmail('organizer'));
  },

  organizerPassword: async ({}, use) => {
    await use('TestPass123!');
  },

  /**
   * Returns a Playwright Page that has a valid Supabase session injected via
   * localStorage (storageState pattern). Creating a fresh user + signing in
   * programmatically avoids the full login-form round-trip and keeps fixture
   * setup well under 5 s on a local stack.
   */
  authenticatedPage: async ({ page, organizerEmail, organizerPassword }, use) => {
    await createTestOrganizer(organizerEmail, organizerPassword);
    const sessionData = await signInProgrammatically(
      organizerEmail,
      organizerPassword,
    );

    // Navigate first so localStorage is scoped to the right origin.
    await page.goto('/');

    // Supabase stores the session under a key derived from the project hostname.
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';

    await page.evaluate(
      ([url, session]: [string, unknown]) => {
        const hostname = new URL(url).hostname;
        // Local Supabase uses "127" as the project-ref segment.
        const projectRef = hostname.split('.')[0];
        const key = `sb-${projectRef}-auth-token`;
        localStorage.setItem(key, JSON.stringify(session));
      },
      [supabaseUrl, sessionData.session] as [string, unknown],
    );

    await page.reload();
    await use(page);
  },
});

export { expect } from '@playwright/test';
