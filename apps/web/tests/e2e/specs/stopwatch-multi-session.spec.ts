/**
 * E2E spec: /stopwatch multiple parallel solo sessions (#368)
 *
 * Covers:
 *   1. Two-session independence — creating/viewing a second session while the
 *      first has a running stopwatch leaves the first session's state untouched.
 *   2. Session switching — switching between sessions preserves each session's
 *      independent running/paused state.
 *   3. Deleting a session — deleting with confirmation removes it from the list
 *      and does not affect other sessions.
 *   4. Session cap — hitting the 10-session cap shows the expected message and
 *      blocks further creation.
 *   5. Legacy migration — seeding the old single-session storage keys causes
 *      them to appear as "Session 1" in the new multi-session list.
 *
 * Storage key constants (mirror soloSessionStorage.ts — do not import from src):
 *   Index:          splitsync_stopwatch_sessions_index_v1
 *   Per-session:    splitsync_stopwatch_session_<id>_v1
 *   Active pointer: splitsync_stopwatch_active_session_v1
 *   Legacy SW:      splitsync_stopwatch_solo_v1
 *   Legacy mode:    splitsync_stopwatch_mode_v1
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Storage key constants (keep in sync with soloSessionStorage.ts)
// ---------------------------------------------------------------------------

const INDEX_KEY = 'splitsync_stopwatch_sessions_index_v1';
const ACTIVE_KEY = 'splitsync_stopwatch_active_session_v1';
const LEGACY_SW_KEY = 'splitsync_stopwatch_solo_v1';
const LEGACY_MODE_KEY = 'splitsync_stopwatch_mode_v1';

// ---------------------------------------------------------------------------
// 1. Two-session independence
// ---------------------------------------------------------------------------

test.describe('/stopwatch multi-session: two-session independence', () => {
  test('first session running state is preserved while viewing second session', async ({ page }) => {
    const id1 = 'e2e-indep-aa';
    const id2 = 'e2e-indep-bb';

    // Navigate first so we have a page context for localStorage access.
    await page.goto('/stopwatch');

    // Seed two sessions: session1 is running (started ~5 s ago), session2 is idle.
    await page.evaluate(
      ({ indexKey, activeKey, id1, id2 }) => {
        const now = new Date().toISOString();
        const startedAtWall = Date.now() - 5_000; // 5 seconds ago

        localStorage.setItem(indexKey, JSON.stringify({ ids: [id1, id2] }));

        localStorage.setItem(`splitsync_stopwatch_session_${id1}_v1`, JSON.stringify({
          id: id1,
          name: 'Morning Ride',
          mode: 'stopwatch',
          stopwatchState: {
            state: 'running',
            accMs: 0,
            startedAtWall,
            laps: [],
          },
          timerState: null,
          timerDurationMs: 300_000,
          lastUsedAt: now,
          createdAt: now,
        }));

        localStorage.setItem(`splitsync_stopwatch_session_${id2}_v1`, JSON.stringify({
          id: id2,
          name: 'Afternoon Sprint',
          mode: 'stopwatch',
          stopwatchState: null,
          timerState: null,
          timerDurationMs: 300_000,
          lastUsedAt: now,
          createdAt: now,
        }));

        localStorage.setItem(activeKey, id1);
      },
      { indexKey: INDEX_KEY, activeKey: ACTIVE_KEY, id1, id2 }
    );

    // Reload so the migration/init code picks up the seeded data.
    await page.reload();

    // Session1 should be active and running.
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible();

    // Open the sessions panel.
    await page.getByTestId('open-session-panel').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Session1 row shows "RUNNING" and correct name.
    const row1 = page.getByTestId(`solo-session-row-${id1}`);
    await expect(row1).toBeVisible();
    await expect(row1).toContainText('Morning Ride');
    await expect(row1).toContainText('RUNNING');

    // Session2 row shows "IDLE" and correct name.
    const row2 = page.getByTestId(`solo-session-row-${id2}`);
    await expect(row2).toBeVisible();
    await expect(row2).toContainText('Afternoon Sprint');
    await expect(row2).toContainText('IDLE');

    // Close the panel — session1 should still be running.
    await page.getByRole('button', { name: /close sessions panel/i }).click();
    await expect(page.getByRole('button', { name: /stop stopwatch/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Session switching
// ---------------------------------------------------------------------------

test.describe('/stopwatch multi-session: session switching', () => {
  test('switching preserves each session\'s independent running/paused state', async ({ page }) => {
    const idA = 'e2e-switch-aa';
    const idB = 'e2e-switch-bb';

    await page.goto('/stopwatch');

    // Session A: idle. Session B: stopped with 10 s accumulated.
    await page.evaluate(
      ({ indexKey, activeKey, idA, idB }) => {
        const now = new Date().toISOString();

        localStorage.setItem(indexKey, JSON.stringify({ ids: [idA, idB] }));

        localStorage.setItem(`splitsync_stopwatch_session_${idA}_v1`, JSON.stringify({
          id: idA,
          name: 'Session A',
          mode: 'stopwatch',
          stopwatchState: null,
          timerState: null,
          timerDurationMs: 300_000,
          lastUsedAt: now,
          createdAt: now,
        }));

        localStorage.setItem(`splitsync_stopwatch_session_${idB}_v1`, JSON.stringify({
          id: idB,
          name: 'Session B',
          mode: 'stopwatch',
          stopwatchState: {
            state: 'stopped',
            accMs: 10_000, // 10 seconds accumulated
            startedAtWall: null,
            laps: [],
          },
          timerState: null,
          timerDurationMs: 300_000,
          lastUsedAt: now,
          createdAt: now,
        }));

        localStorage.setItem(activeKey, idA);
      },
      { indexKey: INDEX_KEY, activeKey: ACTIVE_KEY, idA, idB }
    );

    await page.reload();

    // Session A active and idle: timer shows 00:00, Reset is disabled.
    await expect(page.getByRole('timer')).toContainText('00:00');
    await expect(page.getByRole('button', { name: /reset stopwatch/i })).toBeDisabled();

    // Open panel and switch to Session B.
    await page.getByTestId('open-session-panel').click();
    await page.getByTestId(`session-switch-${idB}`).click();

    // Session B (stopped, 10 s elapsed): timer shows a non-zero time, Reset is enabled.
    await expect(page.getByRole('button', { name: /reset stopwatch/i })).toBeEnabled({ timeout: 3_000 });
    // The timer should display "00:10" (10 seconds).
    await expect(page.getByRole('timer')).toContainText('00:10');

    // Switch back to Session A.
    await page.getByTestId('open-session-panel').click();
    await page.getByTestId(`session-switch-${idA}`).click();

    // Session A (idle): timer back to 00:00, Reset disabled again.
    await expect(page.getByRole('button', { name: /reset stopwatch/i })).toBeDisabled({ timeout: 3_000 });
    await expect(page.getByRole('timer')).toContainText('00:00');
  });
});

// ---------------------------------------------------------------------------
// 3. Deleting a session
// ---------------------------------------------------------------------------

test.describe('/stopwatch multi-session: deleting a session', () => {
  test('deleting a session removes it from the list without affecting other sessions', async ({ page }) => {
    const idKeep = 'e2e-del-keep';
    const idGone = 'e2e-del-gone';

    await page.goto('/stopwatch');

    await page.evaluate(
      ({ indexKey, activeKey, idKeep, idGone }) => {
        const now = new Date().toISOString();

        localStorage.setItem(indexKey, JSON.stringify({ ids: [idKeep, idGone] }));

        localStorage.setItem(`splitsync_stopwatch_session_${idKeep}_v1`, JSON.stringify({
          id: idKeep,
          name: 'Keep Me',
          mode: 'stopwatch',
          stopwatchState: null,
          timerState: null,
          timerDurationMs: 300_000,
          lastUsedAt: now,
          createdAt: now,
        }));

        localStorage.setItem(`splitsync_stopwatch_session_${idGone}_v1`, JSON.stringify({
          id: idGone,
          name: 'Delete Me',
          mode: 'stopwatch',
          stopwatchState: null,
          timerState: null,
          timerDurationMs: 300_000,
          lastUsedAt: now,
          createdAt: now,
        }));

        // Active session is "Keep Me" — deleting "Delete Me" is a non-active delete.
        localStorage.setItem(activeKey, idKeep);
      },
      { indexKey: INDEX_KEY, activeKey: ACTIVE_KEY, idKeep, idGone }
    );

    await page.reload();

    // Open the sessions panel.
    await page.getByTestId('open-session-panel').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Both sessions should be visible.
    await expect(page.getByTestId(`solo-session-row-${idKeep}`)).toBeVisible();
    await expect(page.getByTestId(`solo-session-row-${idGone}`)).toBeVisible();

    // Click the delete button on "Delete Me".
    await page.getByTestId(`delete-solo-btn-${idGone}`).click();

    // Inline confirmation prompt appears — confirm the delete.
    await page.getByTestId(`confirm-delete-solo-${idGone}`).click();

    // "Delete Me" row should be gone; panel stays open for non-active deletes.
    await expect(page.getByTestId(`solo-session-row-${idGone}`)).not.toBeVisible({ timeout: 3_000 });

    // "Keep Me" should still be listed and unaffected.
    await expect(page.getByTestId(`solo-session-row-${idKeep}`)).toBeVisible();
    await expect(page.getByTestId(`solo-session-row-${idKeep}`)).toContainText('Keep Me');
  });
});

// ---------------------------------------------------------------------------
// 4. Session cap
// ---------------------------------------------------------------------------

test.describe('/stopwatch multi-session: session cap', () => {
  test('reaching the 10-session cap shows cap message and hides the create button', async ({ page }) => {
    // Create exactly 10 sessions to hit the cap.
    const ids = Array.from({ length: 10 }, (_, i) => `e2e-cap-${String(i).padStart(2, '0')}`);

    await page.goto('/stopwatch');

    await page.evaluate(
      ({ indexKey, activeKey, ids }) => {
        const now = new Date().toISOString();
        localStorage.setItem(indexKey, JSON.stringify({ ids }));
        for (const id of ids) {
          localStorage.setItem(`splitsync_stopwatch_session_${id}_v1`, JSON.stringify({
            id,
            name: `Session ${id}`,
            mode: 'stopwatch',
            stopwatchState: null,
            timerState: null,
            timerDurationMs: 300_000,
            lastUsedAt: now,
            createdAt: now,
          }));
        }
        localStorage.setItem(activeKey, ids[0]);
      },
      { indexKey: INDEX_KEY, activeKey: ACTIVE_KEY, ids }
    );

    await page.reload();

    // Open the sessions panel.
    await page.getByTestId('open-session-panel').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Cap message should be visible and contain the expected copy.
    const capMsg = page.getByTestId('session-cap-message');
    await expect(capMsg).toBeVisible();
    await expect(capMsg).toContainText(/maximum 10 sessions/i);

    // The "New session" create button must NOT be present (replaced by cap message).
    await expect(page.getByTestId('open-create-session-btn')).not.toBeVisible({ timeout: 2_000 });
  });
});

// ---------------------------------------------------------------------------
// 5. Legacy migration
// ---------------------------------------------------------------------------

test.describe('/stopwatch multi-session: legacy migration', () => {
  test('old single-session keys are migrated and appear as "Session 1" in the list', async ({ page }) => {
    // Navigate first to get an origin for localStorage.
    await page.goto('/stopwatch');

    // Clear all storage and seed only the legacy (pre-multi-session) keys.
    await page.evaluate(
      ({ legacySwKey, legacyModeKey }) => {
        localStorage.clear();

        // Legacy stopwatch state: stopped at 30 s with 2 laps.
        localStorage.setItem(legacySwKey, JSON.stringify({
          state: 'stopped',
          accMs: 30_000,
          startedAtWall: null,
          laps: [
            { n: 1, lapMs: 15_000, totalMs: 15_000 },
            { n: 2, lapMs: 15_000, totalMs: 30_000 },
          ],
        }));

        // Legacy mode key: stopwatch.
        localStorage.setItem(legacyModeKey, 'stopwatch');
      },
      { legacySwKey: LEGACY_SW_KEY, legacyModeKey: LEGACY_MODE_KEY }
    );

    // Reload — runMigrationIfNeeded() runs on mount and converts legacy keys.
    await page.reload();

    // The stopwatch should restore the migrated stopped state.
    await expect(page.getByRole('button', { name: /start stopwatch/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /reset stopwatch/i })).toBeEnabled();

    // Laps should also be migrated (2 laps visible in the table).
    await expect(page.getByRole('table', { name: /lap times/i })).toBeVisible();
    await expect(page.locator('.sw-lap-table tbody tr')).toHaveCount(2);

    // Open the sessions panel — "Session 1" should appear in the list.
    await page.getByTestId('open-session-panel').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const sessionList = page.getByRole('list', { name: /solo sessions/i });
    await expect(sessionList).toBeVisible();
    await expect(sessionList).toContainText('Session 1');

    // The migrated session should show PAUSED status (stopped state).
    await expect(sessionList).toContainText('PAUSED');
  });
});

// ---------------------------------------------------------------------------
// 6. Drag-to-reorder
// ---------------------------------------------------------------------------

test.describe('/stopwatch multi-session: drag-to-reorder', () => {
  /**
   * Seed helper — creates three sessions with a known ID order and returns the IDs.
   */
  async function seedThreeSessions(page: import('@playwright/test').Page) {
    const idFirst = 'e2e-reorder-first';
    const idSecond = 'e2e-reorder-second';
    const idThird = 'e2e-reorder-third';

    await page.goto('/stopwatch');

    await page.evaluate(
      ({ indexKey, activeKey, ids }) => {
        const now = new Date().toISOString();
        const names = ['Alpha', 'Beta', 'Gamma'];
        localStorage.setItem(indexKey, JSON.stringify({ ids }));
        ids.forEach((id: string, i: number) => {
          localStorage.setItem(`splitsync_stopwatch_session_${id}_v1`, JSON.stringify({
            id,
            name: names[i],
            mode: 'stopwatch',
            stopwatchState: null,
            timerState: null,
            timerDurationMs: 300_000,
            lastUsedAt: now,
            createdAt: now,
          }));
        });
        localStorage.setItem(activeKey, ids[0]);
      },
      {
        indexKey: INDEX_KEY,
        activeKey: ACTIVE_KEY,
        ids: [idFirst, idSecond, idThird],
      }
    );

    await page.reload();
    return { idFirst, idSecond, idThird };
  }

  test('dragging a session row to a new position reorders the list immediately', async ({ page }) => {
    const { idFirst, idThird } = await seedThreeSessions(page);

    await page.getByTestId('open-session-panel').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const sessionList = page.getByRole('list', { name: /solo sessions/i });
    const rows = sessionList.locator('md-list-item');

    // Initial order: Alpha (0), Beta (1), Gamma (2)
    await expect(rows.nth(0)).toContainText('Alpha');
    await expect(rows.nth(1)).toContainText('Beta');
    await expect(rows.nth(2)).toContainText('Gamma');

    // Simulate HTML5 drag: drag "Gamma" (third row) onto "Alpha" (first row).
    // page.dragAndDrop fires the native HTML5 drag events that our handlers listen to.
    await page.dragAndDrop(
      `[data-testid="solo-session-row-${idThird}"]`,
      `[data-testid="solo-session-row-${idFirst}"]`
    );

    // After drop: Gamma should have moved before Alpha.
    await expect(rows.nth(0)).toContainText('Gamma');
    await expect(rows.nth(1)).toContainText('Alpha');
    await expect(rows.nth(2)).toContainText('Beta');
  });

  test('reordered session list persists after closing and reopening the panel', async ({ page }) => {
    const { idFirst, idThird } = await seedThreeSessions(page);

    await page.getByTestId('open-session-panel').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Drag "Gamma" onto "Alpha"
    await page.dragAndDrop(
      `[data-testid="solo-session-row-${idThird}"]`,
      `[data-testid="solo-session-row-${idFirst}"]`
    );

    // Close the panel
    await page.getByRole('button', { name: /close sessions panel/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 2_000 });

    // Reopen the panel — new order must still be in place (verified from storage)
    await page.getByTestId('open-session-panel').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const sessionList = page.getByRole('list', { name: /solo sessions/i });
    const rows = sessionList.locator('md-list-item');

    await expect(rows.nth(0)).toContainText('Gamma');
    await expect(rows.nth(1)).toContainText('Alpha');
    await expect(rows.nth(2)).toContainText('Beta');
  });

  test('keyboard reorder: Space to pick up, ArrowDown to move, Enter to confirm and persist', async ({ page }) => {
    const { idFirst } = await seedThreeSessions(page);

    await page.getByTestId('open-session-panel').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const sessionList = page.getByRole('list', { name: /solo sessions/i });
    const rows = sessionList.locator('md-list-item');

    // Anchor the handle to Alpha's data-testid so the locator stays stable
    // even after ArrowDown changes the DOM order (rows.nth(0) would drift to
    // Beta after the first move, targeting the wrong element for Enter).
    const firstHandle = page
      .getByTestId(`solo-session-row-${idFirst}`)
      .getByRole('button', { name: /drag to reorder/i });
    await firstHandle.focus();
    await firstHandle.press('Space');

    // Move it down once (Alpha → position 1, Beta → position 0)
    await firstHandle.press('ArrowDown');

    // Confirm with Enter — still targets Alpha's handle (now at position 1)
    await firstHandle.press('Enter');

    // Alpha should now be in second position
    await expect(rows.nth(0)).toContainText('Beta');
    await expect(rows.nth(1)).toContainText('Alpha');

    // Close and reopen to verify persistence
    await page.getByRole('button', { name: /close sessions panel/i }).click();
    await page.getByTestId('open-session-panel').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const rows2 = page.getByRole('list', { name: /solo sessions/i }).locator('md-list-item');
    await expect(rows2.nth(0)).toContainText('Beta');
    await expect(rows2.nth(1)).toContainText('Alpha');

    // Verify the index stored the new order
    const storedIds: string[] = await page.evaluate(
      ({ indexKey }) => {
        const raw = localStorage.getItem(indexKey);
        return raw ? JSON.parse(raw).ids : [];
      },
      { indexKey: INDEX_KEY }
    );
    // Beta (idSecond) should precede Alpha (idFirst) in storage
    const firstIdx = storedIds.indexOf(idFirst);
    const secondIdx = storedIds.indexOf('e2e-reorder-second');
    expect(secondIdx).toBeLessThan(firstIdx);
  });
});
