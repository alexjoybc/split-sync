/**
 * M3E dialog open/close spring motion for `@material/web`'s `md-dialog`
 * (issue #461 — the M3E polish pass on top of the #442/#444 MD3 redesign).
 *
 * `md-dialog` exposes `getOpenAnimation`/`getCloseAnimation` as public,
 * assignable instance properties (see
 * `@material/web/dialog/internal/dialog.js`) that the element calls
 * whenever it opens/closes — reassigning them is a supported customization
 * point, not a fork of the component. We only replace the primary
 * "dialog" translateY keyframe's easing/duration with the M3E dialog
 * spring approximation from `md3-theme.css`'s `--md-motion-spring-dialog-*`
 * tokens (read live via `getComputedStyle` so this file never hardcodes a
 * duplicate value); the scrim/container/headline/content/actions fades
 * keep their default M3 timings, since the issue only calls for spring
 * motion on the dialog's own open/close transition.
 */

/** Minimal shape of the `md-dialog` animation-override hook we use. */
export interface MdDialogAnimationElement extends HTMLElement {
  getOpenAnimation?: () => unknown;
  getCloseAnimation?: () => unknown;
}

function readCssVar(el: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Overrides `el`'s open/close animations to use the M3E dialog spring
 * timing for the dialog's own slide transform. Safe to call once per
 * mount (e.g. in a `useEffect`) — it only assigns functions, it doesn't
 * trigger an animation itself.
 */
export function applyDialogSpringMotion(el: MdDialogAnimationElement | null): void {
  if (!el || typeof el.animate !== "function") return; // SSR / test-env guard

  const easing = readCssVar(el, "--md-motion-spring-dialog-easing", "cubic-bezier(0.3, 1.2, 0.5, 1)");
  const durationStr = readCssVar(el, "--md-motion-spring-dialog-duration", "220ms");
  const duration = parseFloat(durationStr) || 220;

  el.getOpenAnimation = () => ({
    dialog: [
      [
        [{ transform: "translateY(-50px)" }, { transform: "translateY(0)" }],
        { duration, easing },
      ],
    ],
    scrim: [[[{ opacity: 0 }, { opacity: 0.32 }], { duration: 500, easing: "linear" }]],
    container: [
      [[{ opacity: 0 }, { opacity: 1 }], { duration: 50, easing: "linear", pseudoElement: "::before" }],
      [
        [{ height: "35%" }, { height: "100%" }],
        { duration: 500, easing: "cubic-bezier(0.3, 0, 0, 1)", pseudoElement: "::before" },
      ],
    ],
    headline: [
      [
        [{ opacity: 0 }, { opacity: 0, offset: 0.2 }, { opacity: 1 }],
        { duration: 250, easing: "linear", fill: "forwards" },
      ],
    ],
    content: [
      [
        [{ opacity: 0 }, { opacity: 0, offset: 0.2 }, { opacity: 1 }],
        { duration: 250, easing: "linear", fill: "forwards" },
      ],
    ],
    actions: [
      [
        [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }],
        { duration: 300, easing: "linear", fill: "forwards" },
      ],
    ],
  });

  el.getCloseAnimation = () => ({
    dialog: [
      [
        [{ transform: "translateY(0)" }, { transform: "translateY(-50px)" }],
        { duration: Math.round(duration * 0.68), easing },
      ],
    ],
    scrim: [[[{ opacity: 0.32 }, { opacity: 0 }], { duration: 150, easing: "linear" }]],
    container: [
      [
        [{ height: "100%" }, { height: "35%" }],
        { duration: 150, easing: "cubic-bezier(0.3, 0, 0.8, 0.15)", pseudoElement: "::before" },
      ],
      [
        [{ opacity: "1" }, { opacity: "0" }],
        { delay: 100, duration: 50, easing: "linear", pseudoElement: "::before" },
      ],
    ],
    headline: [[[{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: "linear", fill: "forwards" }]],
    content: [[[{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: "linear", fill: "forwards" }]],
    actions: [[[{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: "linear", fill: "forwards" }]],
  });
}
