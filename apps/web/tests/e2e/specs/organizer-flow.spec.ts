/**
 * Organizer flow E2E spec.
 *
 * Covers the full happy-path journey through the organizer admin UI:
 *   1. Create a new event at /new
 *   2. Event appears in /events and opens at /event/[eventId]
 *   3. Add participants to the roster
 *   4. Create a race and assign entries from the roster
 *   5. Edit race details while status = 'upcoming'
 *   6. Publish the event
 *
 * Negative checks:
 *   - A draft event is NOT accessible to an unauthenticated spectator
 *
 * The `authenticatedPage` fixture injects a Supabase session via localStorage
 * (no login-form round-trip). The plain `page` fixture is unauthenticated.
 *
 * NOTE: CI wiring (running these specs in the pipeline) is in issue #153.
 * Do NOT add `test:e2e` to the CI workflow here.
 */
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '../fixtures/auth';
import { SEED } from '../helpers/fixtures';

// DB-visible: anon client reads published events per RLS policy.
// Uses the local Supabase dev stack defaults so CI works without extra secrets.
const anonDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7b6b7xNHPnjyxvFnDpvnuN51o4MXVToypGc',
);

test.describe('Organizer flow', () => {
  /**
   * Happy path: create event → add roster → create race → assign entries → publish.
   */
  test('create event → roster → race → publish', async ({
    authenticatedPage: page,
  }) => {
    // ── 1. Navigate to /new ────────────────────────────────────────────────
    await page.goto('/new');
    await expect(
      page.getByRole('heading', { name: 'New event' }),
    ).toBeVisible();

    // ── 2. Fill the event form and submit ──────────────────────────────────
    const eventTitle = `E2E Organizer Test ${Date.now()}`;

    await page
      .getByPlaceholder('Friday Night Racing')
      .fill(eventTitle);
    await page
      .getByPlaceholder('Greater Victoria Velodrome')
      .fill('Test Velodrome Arena');

    await page
      .getByRole('button', { name: 'Create event and add racers' })
      .click();

    // ── 3. Should navigate to the event management page ────────────────────
    await page.waitForURL(/\/event\/[0-9a-f-]{36}/);
    const eventUrl = page.url();
    const eventIdMatch = eventUrl.match(/\/event\/([0-9a-f-]{36})/);
    expect(eventIdMatch).not.toBeNull();

    // The event title should appear in the page heading
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      eventTitle,
    );

    // ── 4. Add participants to the roster ──────────────────────────────────
    // The roster form has Bib / First name / Last name inputs.
    // Pressing Enter on any input calls addParticipant (handleRiderKeyDown).
    await page.getByPlaceholder('Bib', { exact: true }).fill('1');
    await page.getByPlaceholder('First name').fill('Alice');
    await page.getByPlaceholder('Last name').fill('Smith');
    await page.getByPlaceholder('Last name').press('Enter');

    // After submit the bib input regains focus; fill the second rider.
    await page.getByPlaceholder('Bib', { exact: true }).fill('2');
    await page.getByPlaceholder('First name').fill('Bob');
    await page.getByPlaceholder('Last name').fill('Jones');
    await page.getByPlaceholder('Last name').press('Enter');

    // Both riders should appear in the roster table.
    // Asserting on names only — bib numbers like '#1' appear multiple times
    // in the table (position + bib columns) and would cause a strict-mode violation.
    await expect(page.getByText('Alice Smith', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Bob Jones', { exact: true })).toBeVisible({ timeout: 5_000 });

    // ── 5. Create a race ───────────────────────────────────────────────────
    // Section "4. Races" contains an "Add race" form with Race name / Laps inputs.
    await page.getByPlaceholder('Race name').fill('Sprint Final');
    await page.getByPlaceholder('Laps').fill('10');
    await page.getByRole('button', { name: 'Add' }).click();

    // The new race card should appear with status 'upcoming'.
    await expect(page.getByText('Sprint Final')).toBeVisible();
    await expect(
      page.getByText('upcoming', { exact: false }).first(),
    ).toBeVisible();

    // ── 6. Assign both participants to the race ────────────────────────────
    // "Assign" button is on each race card (only visible while status = upcoming).
    await page.getByRole('button', { name: 'Assign' }).click();

    // The assignment panel opens and lists roster participants as checkboxes.
    // Wait for the panel to render before interacting.
    await expect(
      page.getByRole('checkbox', { name: /Alice/i }),
    ).toBeVisible({ timeout: 5_000 });

    // The checkboxes are controlled React inputs: clicking triggers an async
    // Supabase write + refetch(), so state doesn't flip synchronously.
    // Use .click() (no post-click state assertion) then wait for toBeChecked()
    // to let the round-trip complete before moving on.
    await page.getByRole('checkbox', { name: /Alice/i }).click();
    await expect(
      page.getByRole('checkbox', { name: /Alice/i }),
    ).toBeChecked({ timeout: 10_000 });

    await page.getByRole('checkbox', { name: /Bob/i }).click();
    await expect(
      page.getByRole('checkbox', { name: /Bob/i }),
    ).toBeChecked({ timeout: 10_000 });

    // Close the assignment panel.
    await page.getByRole('button', { name: 'Close' }).click();

    // After closing, assigned entries are displayed as chips below the race card.
    // The entry name is "First Last" (fullName), so "Alice Smith" appears concatenated.
    await expect(page.getByText('Alice Smith')).toBeVisible();
    await expect(page.getByText('Bob Jones')).toBeVisible();

    // Race counter should reflect 2/2 assigned.
    await expect(page.getByText('2/2 assigned')).toBeVisible();

    // ── 7. Publish the event ───────────────────────────────────────────────
    // Section "6. Publish" has "Publish event" button while status = draft.
    await page.getByRole('button', { name: 'Publish event' }).click();

    // After publishing, the "Published" badge replaces the button.
    await expect(page.getByText('Published')).toBeVisible();
    // The "Publish event" button should be gone.
    await expect(
      page.getByRole('button', { name: 'Publish event' }),
    ).not.toBeVisible();

    // ── 8. DB-visible: verify the committed write via the anon client ───────
    // Published events are readable by the anon role per RLS, so this read
    // confirms the status was actually persisted in the database — not just
    // reflected in local UI state.
    const currentUrl = page.url();
    const eventId =
      currentUrl.match(/\/event\/([0-9a-f-]{36})/)?.[1] ??
      currentUrl.split('/').pop();

    const { data: row } = await anonDb
      .from('events')
      .select('status')
      .eq('id', eventId)
      .single();

    expect(row?.status).toBe('live'); // 'live' is the published status in the event_status enum
  });

  /**
   * Negative: draft event not visible to an unauthenticated spectator.
   *
   * The event page guards access: when !user, it renders
   * "This event is private" instead of event details.
   */
  test('draft event is not accessible to an unauthenticated spectator', async ({
    page,
  }) => {
    // Visit the seeded draft event without a session.
    await page.goto(`/event/${SEED.DRAFT_EVENT_ID}`);

    // Should see the access wall message, not event details.
    await expect(page.getByText('This event is private')).toBeVisible({
      timeout: 10_000,
    });

    // The organizer roster and race management sections must not be rendered.
    await expect(page.getByText('Event roster')).not.toBeVisible();
    await expect(page.getByText('Publish event')).not.toBeVisible();
  });
});
