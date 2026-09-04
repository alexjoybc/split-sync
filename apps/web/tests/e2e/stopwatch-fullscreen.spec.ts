/**
 * E2E spec — stopwatch fullscreen entry point (#422)
 *
 * Covers:
 * 1. Stopwatch mode: existing "Large display" button enters/exits fullscreen.
 * 2. Timer mode: new "Fullscreen" button on CountdownTimer opens the on-demand
 *    fullscreen overlay and dismisses it.
 *
 * Note: The Fullscreen API is not available inside Playwright's non-headed
 * browser, so we test the overlay's visibility (via data-testid and
 * aria-pressed) rather than the OS fullscreen state itself.
 */
import { test, expect } from "@playwright/test";

test.describe("Stopwatch fullscreen", () => {
  test.beforeEach(async ({ page }) => {
    // The stopwatch requires sign-in for shared sessions, but the solo
    // stopwatch renders without auth. Navigate directly.
    await page.goto("/stopwatch");
    // Wait for the page to hydrate
    await page.waitForSelector('[data-testid="sw-mode-stopwatch"]', { timeout: 10000 });
  });

  test("stopwatch mode: Large display button is present and toggles aria-pressed", async ({ page }) => {
    // Make sure we are in stopwatch mode (default)
    await expect(page.getByTestId("sw-mode-stopwatch")).toHaveAttribute("aria-pressed", "true");

    const largeBtn = page.getByRole("button", { name: /large display/i });
    await expect(largeBtn).toBeVisible();
    await expect(largeBtn).toHaveAttribute("aria-pressed", "false");

    await largeBtn.click();
    await expect(largeBtn).toHaveAttribute("aria-pressed", "true");

    // Click again to exit
    await largeBtn.click();
    await expect(largeBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("timer mode: Fullscreen button opens and closes the on-demand overlay", async ({ page }) => {
    // Switch to timer mode
    await page.getByTestId("sw-mode-timer").click();
    await expect(page.getByTestId("timer-mode")).toBeVisible();

    // Fullscreen button should be present. It's an `<md-outlined-button>` /
    // `<md-filled-tonal-button>` (#443 MD3 chrome) — `@material/web`'s
    // `mixinDelegatesAria` moves `aria-*` set on a delegates-focus host into
    // `data-aria-*` and applies the real ARIA state to the internal
    // focusable element instead (see
    // `@material/web/internal/aria/delegate.js`); the accessible state is
    // still correct, only the literal host attribute name differs from a
    // plain `<button>`.
    const fsBtn = page.getByTestId("timer-fullscreen-btn");
    await expect(fsBtn).toBeVisible();
    await expect(fsBtn).toHaveAttribute("data-aria-pressed", "false");

    // Open fullscreen overlay
    await fsBtn.click();
    const overlay = page.getByTestId("timer-manual-fs-overlay");
    await expect(overlay).toBeVisible();
    await expect(fsBtn).toHaveAttribute("data-aria-pressed", "true");

    // Dismiss via the exit button inside the overlay
    const exitBtn = page.getByTestId("timer-fs-exit-btn");
    await expect(exitBtn).toBeVisible();
    await exitBtn.click();
    await expect(overlay).not.toBeVisible();
    await expect(fsBtn).toHaveAttribute("data-aria-pressed", "false");
  });

  test("timer mode: overlay shows timer display and correct role", async ({ page }) => {
    await page.getByTestId("sw-mode-timer").click();
    await expect(page.getByTestId("timer-mode")).toBeVisible();

    // Open fullscreen
    await page.getByTestId("timer-fullscreen-btn").click();
    const overlay = page.getByTestId("timer-manual-fs-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute("role", "dialog");

    // The overlay should contain text (the remaining time digits), which
    // are rendered as large monospace spans — just verify the overlay exists
    // and has accessible label text.
    await expect(overlay).toHaveAttribute("aria-label", /.+remaining/i);
  });

  test("timer mode: auto-fullscreen (5-second) overlay is unchanged", async ({ page }) => {
    await page.getByTestId("sw-mode-timer").click();
    await expect(page.getByTestId("timer-mode")).toBeVisible();

    // Set a very short duration (1 second) so the auto-overlay fires quickly.
    // `timer-duration-input` is an `<md-outlined-text-field>` (#443 MD3
    // chrome) — its editable `<input>` is in shadow DOM; Playwright's CSS
    // engine pierces open shadow roots so this descendant selector reaches it.
    const input = page.locator('[data-testid="timer-duration-input"] input');
    await input.fill("0:01");
    await input.blur();

    // Start the timer
    await page.getByTestId("timer-primary-btn").click();

    // Wait for the auto-fullscreen countdown overlay (the existing 5→1 overlay
    // fires at ≤5 s remaining; here the whole duration is 1 s, so it fires
    // as soon as the timer starts). Give it 3 s to appear.
    const autoOverlay = page.getByTestId("timer-countdown-overlay");
    await expect(autoOverlay).toBeVisible({ timeout: 3000 });
  });
});
