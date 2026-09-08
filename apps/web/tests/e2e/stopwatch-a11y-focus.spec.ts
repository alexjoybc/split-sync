/**
 * E2E spec — stopwatch MD3 accessibility QA (#445)
 *
 * Covers accessibility properties introduced/verified by the #445 MD3
 * contrast + focus-visible audit that aren't already exercised by
 * `stopwatch-fullscreen.spec.ts` or the `specs/` timer suites:
 *
 * 1. A plain-`<button>` MD3-scope control (`.race-action--outline`, styled
 *    via the existing global `:focus-visible` rule in globals.css) shows a
 *    2px blue-primary focus ring on keyboard focus.
 * 2. The `.md3-stopwatch-scope` root exposes `--md-focus-ring-color` /
 *    `--md-focus-ring-width` resolving to the same blue-primary/2px pair,
 *    which is what every `@material/web` custom element (`md-filled-button`,
 *    `md-icon-button`, `md-outlined-button`, etc.) reads for its internal
 *    shadow-DOM focus ring. `@material/web`'s own default
 *    (`--md-sys-color-secondary` / blue-accent, 3px) fails WCAG 1.4.11's
 *    3:1 UI-component contrast minimum against this app's light background
 *    — see ADR 0026's #445 accessibility QA addendum.
 */
import { test, expect } from "@playwright/test";

test.describe("Stopwatch MD3 accessibility QA (#445)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/stopwatch");
    await page.waitForSelector('[data-testid="sw-mode-stopwatch"]', { timeout: 10000 });
  });

  test("plain-button MD3 control shows a 2px blue-primary focus-visible ring", async ({ page }) => {
    const largeDisplayBtn = page.getByRole("button", { name: /large display/i });
    await expect(largeDisplayBtn).toBeVisible();

    // Programmatic focus is treated as keyboard-equivalent by Chromium's
    // focus-visible heuristic when there has been no prior pointer
    // interaction with the element, so this reliably triggers the
    // `:focus-visible` rule rather than the plain `:focus` (mouse-click, no
    // ring) state.
    await largeDisplayBtn.focus();

    const outline = await largeDisplayBtn.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.outlineColor, width: cs.outlineWidth, style: cs.outlineStyle };
    });

    expect(outline.style).toBe("solid");
    expect(outline.width).toBe("2px");
    // #0B6FB3 (blue-primary)
    expect(outline.color).toBe("rgb(11, 111, 179)");
  });

  test("md3-stopwatch-scope exposes a blue-primary/2px --md-focus-ring-* override for @material/web components", async ({ page }) => {
    const tokens = await page.evaluate(() => {
      const scope = document.querySelector(".md3-stopwatch-scope");
      if (!scope) return null;
      const cs = getComputedStyle(scope);
      return {
        color: cs.getPropertyValue("--md-focus-ring-color").trim(),
        width: cs.getPropertyValue("--md-focus-ring-width").trim(),
        primary: cs.getPropertyValue("--md-sys-color-primary").trim(),
      };
    });

    expect(tokens).not.toBeNull();
    expect(tokens!.width).toBe("2px");
    // The browser resolves `var(--md-sys-color-primary)` to its computed
    // value, so compare against the scope's own --md-sys-color-primary
    // rather than hardcoding the hex twice.
    expect(tokens!.color).toBe(tokens!.primary);
    expect(tokens!.primary).toBe("#0b6fb3");
  });
});
