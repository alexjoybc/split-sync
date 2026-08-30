/**
 * E2E spec: result finalization and publishing (#72)
 *
 * Covers the organizer review/publish screen at /score/[raceId]/finalize:
 *   1. A finished race with an entry that never crossed the line surfaces
 *      in the "riders with no crossings" checklist section.
 *   2. Publishing sets `races.results_published_at`.
 *   3. Reopening a published race clears `results_published_at` and flags
 *      `results_under_revision`.
 *   4. Re-finalizing after a reopen publishes again and clears the
 *      under-revision flag.
 *
 * Requires a running local Supabase stack (`supabase start`).
 *
 * Auth note: same pattern as scoring-flow.spec.ts — the scoring/finalize
 * console is RLS-gated on events.owner_id, so each test event is created
 * with an authenticated organizer.
 */
import { test as base, type Page } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  uniqueTestEmail,
  createTestOrganizer,
  signInProgrammatically,
} from '../helpers/supabase';
import { authedDb, buildEvent, recordCrossings } from '../helpers/fixtures';

type FinalizationFixtures = {
  finalizationContext: {
    page: Page;
    accessToken: string;
    eventId: string;
    raceId: string;
  };
};

const test = base.extend<FinalizationFixtures>({
  finalizationContext: async ({ page }, use) => {
    const email = uniqueTestEmail('finalize');
    const password = 'TestPass123!';

    await createTestOrganizer(email, password);
    const { session } = await signInProgrammatically(email, password);
    if (!session) throw new Error('signInProgrammatically returned no session');
    const accessToken = session.access_token;

    // Bib 10 will cross; bib 20 never will — the "no crossings" checklist case.
    const { eventId, raceId } = await buildEvent({
      status: 'live',
      bibs: ['10', '20'],
      accessToken,
      userId: session.user.id,
    });

    const db = authedDb(accessToken);
    await db.from('races').update({ status: 'active' }).eq('id', raceId);
    await recordCrossings(raceId, ['10'], accessToken);
    await db.from('races').update({ status: 'finished' }).eq('id', raceId);

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';

    await page.goto('/');
    await page.evaluate(
      ([url, sess]: [string, unknown]) => {
        const hostname = new URL(url).hostname;
        const projectRef = hostname.split('.')[0];
        const key = `sb-${projectRef}-auth-token`;
        localStorage.setItem(key, JSON.stringify(sess));
      },
      [supabaseUrl, session] as [string, unknown],
    );
    await page.reload();

    await use({ page, accessToken, eventId, raceId });
  },
});

test.describe('Result finalization and publishing', () => {
  test('review checklist, publish, reopen flags under revision, re-publish', async ({
    finalizationContext: { page, accessToken, raceId },
  }) => {
    const db = authedDb(accessToken);

    // ── 1. Scorer page offers "Review & publish" once finished ─────────────
    await page.goto(`/score/${raceId}`);
    const reviewLink = page.getByRole('link', { name: 'Review & publish' });
    await expect(reviewLink).toBeVisible({ timeout: 10_000 });
    await reviewLink.click();

    // ── 2. Review screen surfaces the rider with no crossings ──────────────
    await expect(page).toHaveURL(new RegExp(`/score/${raceId}/finalize$`));
    await expect(page.getByText('Riders with no crossings')).toBeVisible();
    await expect(page.getByText('20').first()).toBeVisible();

    // ── 3. Publish ───────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Finalize & publish' }).click();
    await expect(page.getByRole('button', { name: 'Republish results' })).toBeVisible({ timeout: 10_000 });

    const { data: publishedRace } = await db
      .from('races')
      .select('results_published_at, results_under_revision')
      .eq('id', raceId)
      .single();
    expect(publishedRace?.results_published_at).not.toBeNull();
    expect(publishedRace?.results_under_revision).toBe(false);

    // ── 4. Live board reflects the published state ─────────────────────────
    await page.goto(`/live/${raceId}`);
    await expect(page.getByText('Final classification').first()).toBeVisible({ timeout: 10_000 });

    // ── 5. Reopen the race — results become "under revision" ───────────────
    await page.goto(`/score/${raceId}`);
    await page.getByRole('button', { name: 'Reopen race' }).click();
    await page.getByPlaceholder('Why does this race need to reopen?').fill('Missed a crossing');
    await page.getByRole('button', { name: 'Confirm reopen' }).click();
    await expect(page.getByRole('button', { name: 'Finish' })).toBeVisible({ timeout: 10_000 });

    const { data: reopenedRace } = await db
      .from('races')
      .select('status, results_published_at, results_under_revision')
      .eq('id', raceId)
      .single();
    expect(reopenedRace?.status).toBe('active');
    expect(reopenedRace?.results_published_at).toBeNull();
    expect(reopenedRace?.results_under_revision).toBe(true);

    await page.goto(`/live/${raceId}`);
    await expect(page.getByText('Results under revision').first()).toBeVisible({ timeout: 10_000 });

    // ── 6. Finish and re-publish clears the under-revision flag ────────────
    await page.goto(`/score/${raceId}`);
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByRole('link', { name: 'Review & publish' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('link', { name: 'Review & publish' }).click();
    await page.getByRole('button', { name: 'Finalize & publish' }).click();
    await expect(page.getByRole('button', { name: 'Republish results' })).toBeVisible({ timeout: 10_000 });

    const { data: republishedRace } = await db
      .from('races')
      .select('results_published_at, results_under_revision')
      .eq('id', raceId)
      .single();
    expect(republishedRace?.results_published_at).not.toBeNull();
    expect(republishedRace?.results_under_revision).toBe(false);
  });
});
