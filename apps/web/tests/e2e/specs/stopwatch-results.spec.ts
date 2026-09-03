/**
 * E2E spec: casual stopwatch results permalink + export (#226)
 *
 * Covers:
 *   - /stopwatch/s/[code]/results renders a stopped session's results
 *     without any sign-in (session name, total, lap table, best lap, actor)
 *   - Copy-to-clipboard and CSV download from the results view
 *   - Unknown code shows the unavailable state, never a lap table
 *   - No session controls on the read-only results page
 *   - Solo /stopwatch copy + CSV export of the lap table
 *
 * Requires local Supabase running (migrations applied) — same prerequisite
 * as the rest of the suite.
 */
import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  createTestSupabaseClient,
  uniqueTestEmail,
} from '../helpers/supabase';

const SESSION_NAME = 'Hill Repeats';
const OWNER_NAME = 'Coach Alex';

/**
 * Creates a session as an authenticated owner, replays a deterministic event
 * log (start, 2 laps, stop), and returns the join code.
 *
 * Timeline: lap 1 at +62.5s (split 1:02.50), lap 2 at +121.3s (split 58.80,
 * best), stop at +180s (total 3:00.00).
 */
async function createStoppedSession(): Promise<string> {
  const client = createTestSupabaseClient();
  const email = uniqueTestEmail('sw-results');
  const password = 'stopwatch-e2e-password-1';

  const { error: signUpError } = await client.auth.signUp({ email, password });
  if (signUpError) throw new Error(`signUp failed: ${signUpError.message}`);
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);

  const { data: created, error: createError } = await client.rpc(
    'create_casual_session',
    { p_name: SESSION_NAME, p_display_name: OWNER_NAME }
  );
  if (createError || !created) {
    throw new Error(`create_casual_session failed: ${createError?.message}`);
  }
  const { session_id, participant_id, code } = created as {
    session_id: string;
    participant_id: string;
    code: string;
  };

  const t0 = Date.now() - 10 * 60 * 1000; // ten minutes ago
  const record = async (eventType: string, atMs: number) => {
    const { error } = await client.rpc('record_session_event', {
      p_session_id: session_id,
      p_participant_id: participant_id,
      p_event_type: eventType,
      p_client_recorded_at: new Date(atMs).toISOString(),
      p_client_event_id: randomUUID(),
    });
    if (error) throw new Error(`record ${eventType} failed: ${error.message}`);
  };

  await record('start', t0);
  await record('lap', t0 + 62_500);
  await record('lap', t0 + 121_300);
  await record('stop', t0 + 180_000);

  return code;
}

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('shared session results permalink', () => {
  let code: string;

  test.beforeAll(async () => {
    code = await createStoppedSession();
  });

  test('renders stopped session results without sign-in', async ({ page }) => {
    await page.goto(`/stopwatch/s/${code}/results`);

    await expect(page.getByRole('heading', { name: SESSION_NAME })).toBeVisible();

    // Summary: total time and lap count
    const summary = page.getByLabel('Session summary');
    await expect(summary).toContainText('3:00.00');
    await expect(summary).toContainText(code);

    // Lap table with splits, cumulative times, and actor
    const table = page.getByRole('table', { name: /lap times/i });
    await expect(table).toBeVisible();
    await expect(table).toContainText('1:02.50');
    await expect(table).toContainText('58.80');
    await expect(table).toContainText('2:01.30');
    await expect(table).toContainText(OWNER_NAME);

    // Best lap (58.80) highlighted
    await expect(page.locator('.sw-lap-row--best')).toContainText('58.80');
  });

  test('copy-to-clipboard exports the lap data', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/stopwatch/s/${code}/results`);

    await page.getByRole('button', { name: /copy laps/i }).click();
    await expect(page.getByRole('button', { name: /copied/i })).toBeVisible();

    const text = await readClipboard(page);
    expect(text).toContain(`${SESSION_NAME} — SplitSync Stopwatch`);
    expect(text).toContain('Total 3:00.00');
    expect(text).toContain('Lap 1  1:02.50');
    expect(text).toContain(`by ${OWNER_NAME}`);
  });

  test('CSV download contains header and lap rows', async ({ page }) => {
    await page.goto(`/stopwatch/s/${code}/results`);
    await expect(page.getByRole('table', { name: /lap times/i })).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /download csv/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(
      `stopwatch-${code}-results.csv`
    );
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf-8');

    expect(csv).toContain('lap,split,total,split_ms,total_ms,recorded_by');
    expect(csv).toContain(`1,1:02.50,1:02.50,62500,62500,${OWNER_NAME}`);
    expect(csv).toContain(`2,58.80,2:01.30,58800,121300,${OWNER_NAME}`);
  });

  test('unknown code shows unavailable state', async ({ page }) => {
    await page.goto('/stopwatch/s/ZZZZZZ/results');
    await expect(page.getByLabel(/results not available/i)).toBeVisible();
    await expect(
      page.getByRole('table', { name: /lap times/i })
    ).not.toBeVisible();
  });

  test('results page is read-only — no session controls', async ({ page }) => {
    await page.goto(`/stopwatch/s/${code}/results`);
    await expect(page.getByRole('table', { name: /lap times/i })).toBeVisible();

    for (const name of [/^start/i, /^stop/i, /^lap$/i, /^reset/i]) {
      await expect(page.getByRole('button', { name })).not.toBeVisible({
        timeout: 1_000,
      });
    }
  });
});

// The supabase-js client derives its localStorage key as:
//   `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
// e.g. for production (bsihlrzncucrglqltjrc.supabase.co) → sb-bsihlrzncucrglqltjrc-auth-token
//      for local CI (127.0.0.1:54321)                    → sb-127-auth-token
// We must compute the correct key at runtime from the env var.
const SUPABASE_STORAGE_KEY = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
})();

test.describe('SessionHistory stopped session links', () => {
  test('stopped session shows Results link pointing to /results route', async ({ page }) => {
    // 1. Create user and sign in (Node.js context — not the browser)
    const client = createTestSupabaseClient();
    const email = uniqueTestEmail('sw-hist-results');
    const password = 'stopwatch-e2e-hist-1';
    await client.auth.signUp({ email, password });
    const { data: signInData } = await client.auth.signInWithPassword({ email, password });
    // Full session object required: supabase-js _isValidSession() checks expires_at.
    const session = signInData.session;
    if (!session) throw new Error('signInWithPassword returned no session');

    // 2. Create and stop a session in the DB before the page loads.
    //    The page's sessions query will find it already stopped when it runs.
    const { data: created } = await client.rpc('create_casual_session', {
      p_name: 'Hist Test Session',
      p_display_name: 'Hist Owner',
    });
    if (!created) throw new Error('create_casual_session returned null');
    const { session_id, participant_id, code: histCode } = created as {
      session_id: string;
      participant_id: string;
      code: string;
    };
    const t0 = Date.now() - 5 * 60 * 1000;
    const rec = async (ev: string, atMs: number) => {
      const { error } = await client.rpc('record_session_event', {
        p_session_id: session_id,
        p_participant_id: participant_id,
        p_event_type: ev,
        p_client_recorded_at: new Date(atMs).toISOString(),
        p_client_event_id: randomUUID(),
      });
      if (error) throw new Error(`record_session_event(${ev}) failed: ${error.message}`);
    };
    await rec('start', t0);
    await rec('lap', t0 + 30_000);
    await rec('stop', t0 + 60_000);

    // 3. Inject auth into localStorage BEFORE the first page load via addInitScript.
    //    This ensures the supabase client on the page finds the session the very
    //    first time it reads localStorage — no reload race condition.
    await page.addInitScript(
      ({ key, sessionData }: { key: string; sessionData: unknown }) => {
        window.localStorage.setItem(key, JSON.stringify(sessionData));
      },
      { key: SUPABASE_STORAGE_KEY, sessionData: session }
    );

    // 4. Navigate to /stopwatch. The supabase client initialises with auth already
    //    in localStorage, so INITIAL_SESSION fires with the real user on first load.
    await page.goto('/stopwatch');

    // 5. Wait for the sessions section to confirm auth + fetch completed, then
    //    assert the Results link.
    //    Bug fixed: the previous version used filter({ has: locator('[href*=...]') })
    //    which searches for DESCENDANTS with that href. The href is on the <a> itself,
    //    not on any child. Use locator.and() to require both locators on the same element.
    const resultsLink = page
      .getByRole('link', { name: 'Results' })
      .and(page.locator(`[href*="${histCode}/results"]`));
    await expect(resultsLink).toBeVisible({ timeout: 15_000 });
    const href = await resultsLink.getAttribute('href');
    expect(href).toContain(`/stopwatch/s/${histCode}/results`);
  });

  test('stopped session shows Share results button that copies /results URL', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // 1. Create user and sign in (Node.js context)
    const client = createTestSupabaseClient();
    const email = uniqueTestEmail('sw-hist-share');
    const password = 'stopwatch-e2e-share-1';
    await client.auth.signUp({ email, password });
    const { data: signInData } = await client.auth.signInWithPassword({ email, password });
    // Full session object required: supabase-js _isValidSession() checks expires_at.
    const session = signInData.session;
    if (!session) throw new Error('signInWithPassword returned no session');

    // 2. Create and stop a session in the DB before the page loads.
    const { data: created } = await client.rpc('create_casual_session', {
      p_name: 'Share Hist Session',
      p_display_name: 'Share Owner',
    });
    if (!created) throw new Error('create_casual_session returned null');
    const { session_id, participant_id, code: shareCode } = created as {
      session_id: string;
      participant_id: string;
      code: string;
    };
    const t0 = Date.now() - 5 * 60 * 1000;
    const rec = async (ev: string, atMs: number) => {
      const { error } = await client.rpc('record_session_event', {
        p_session_id: session_id,
        p_participant_id: participant_id,
        p_event_type: ev,
        p_client_recorded_at: new Date(atMs).toISOString(),
        p_client_event_id: randomUUID(),
      });
      if (error) throw new Error(`record_session_event(${ev}) failed: ${error.message}`);
    };
    await rec('start', t0);
    await rec('lap', t0 + 30_000);
    await rec('stop', t0 + 60_000);

    // 3. Inject auth into localStorage BEFORE the first page load via addInitScript.
    await page.addInitScript(
      ({ key, sessionData }: { key: string; sessionData: unknown }) => {
        window.localStorage.setItem(key, JSON.stringify(sessionData));
      },
      { key: SUPABASE_STORAGE_KEY, sessionData: session }
    );

    // 4. Navigate to /stopwatch — supabase client initialises with auth already
    //    in localStorage (no reload needed).
    await page.goto('/stopwatch');

    // 5. The "Share results" button is only rendered for stopped sessions.
    //    Wait for it to appear (auth + session fetch + status='stopped' all confirmed).
    const shareBtn = page.getByRole('button', { name: /share results/i }).first();
    await expect(shareBtn).toBeVisible({ timeout: 15_000 });
    await shareBtn.click();

    // After clicking, it should show "Copied!"
    await expect(page.getByRole('button', { name: /copied/i }).first()).toBeVisible();

    // The clipboard should contain the /results URL
    const clipText = await readClipboard(page);
    expect(clipText).toContain(`/stopwatch/s/${shareCode}/results`);
  });
});

test.describe('solo stopwatch export', () => {
  async function recordTwoLaps(page: Page) {
    await page.goto('/stopwatch');
    await page.getByRole('button', { name: /start stopwatch/i }).click();
    await page.waitForTimeout(150);
    await page.getByRole('button', { name: /record lap/i }).click();
    await page.waitForTimeout(60);
    await page.getByRole('button', { name: /record lap/i }).click();
    await page.getByRole('button', { name: /stop stopwatch/i }).click();
    await expect(page.getByRole('table', { name: /lap times/i })).toBeVisible();
  }

  test('copy laps puts lap text on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await recordTwoLaps(page);

    await page.getByRole('button', { name: /copy laps/i }).click();
    await expect(page.getByRole('button', { name: /copied/i })).toBeVisible();

    const text = await readClipboard(page);
    expect(text).toContain('Solo stopwatch — SplitSync Stopwatch');
    expect(text).toContain('Lap 1');
    expect(text).toContain('Lap 2');
  });

  test('CSV download of the solo lap table', async ({ page }) => {
    await recordTwoLaps(page);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /download csv/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('stopwatch-laps.csv');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf-8');

    expect(csv.startsWith('lap,split,total,split_ms,total_ms')).toBe(true);
    expect(csv.split('\n').filter(Boolean)).toHaveLength(3); // header + 2 laps
  });
});
