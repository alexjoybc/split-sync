/**
 * Playwright fixtures for organizer authentication.
 *
 * `authenticatedPage` gives a Page with a Supabase session already injected
 * via localStorage — no round-trip through the login UI, so it completes well
 * under the 5 s target.
 *
 * The underlying organizer user is worker-scoped: it is created once per
 * Playwright worker and reused across all tests that run in that worker,
 * eliminating repeated signUp + signInWithPassword round-trips.
 *
 * Import `test` and `expect` from this module instead of `@playwright/test`
 * when you need an authenticated context.
 */
import { test as base, type Page } from '@playwright/test';
import type { Session } from '@supabase/supabase-js';
import {
  uniqueTestEmail,
  createTestOrganizer,
  signInProgrammatically,
} from '../helpers/supabase';

/** Worker-scoped fixtures — created once per worker, shared across tests. */
type AuthWorkerFixtures = {
  organizerSession: Session;
};

/** Per-test fixtures. */
type AuthFixtures = {
  organizerEmail: string;
  organizerPassword: string;
  authenticatedPage: Page;
};

export const test = base.extend<AuthFixtures, AuthWorkerFixtures>({
  /**
   * Worker-scoped: one Supabase user is created per Playwright worker and its
   * session is reused by every test that runs in that worker.
   */
  organizerSession: [
    async ({}, use) => {
      const email = uniqueTestEmail('organizer');
      const password = 'TestPass123!';
      await createTestOrganizer(email, password);
      const { session } = await signInProgrammatically(email, password);
      if (!session) throw new Error('Failed to sign in organizer');
      await use(session);
    },
    { scope: 'worker' },
  ],

  // Kept for backwards-compat with specs that destructure these directly.
  organizerEmail: async ({}, use) => {
    await use(uniqueTestEmail('organizer'));
  },

  organizerPassword: async ({}, use) => {
    await use('TestPass123!');
  },

  /**
   * Returns a Playwright Page with a valid Supabase session injected via
   * localStorage. Uses the worker-scoped session — no new signUp or
   * signInWithPassword call per test.
   */
  authenticatedPage: async ({ page, organizerSession }, use) => {
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
      [supabaseUrl, organizerSession] as [string, unknown],
    );

    await page.reload();
    await use(page);
  },
});

export { expect } from '@playwright/test';
