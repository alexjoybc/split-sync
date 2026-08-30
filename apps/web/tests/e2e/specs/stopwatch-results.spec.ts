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
