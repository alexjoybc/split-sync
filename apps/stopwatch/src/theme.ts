/**
 * SplitSync Stopwatch — Material Design 3 theme.
 *
 * See ADR 0026 (`docs/adr/0026-stopwatch-material-3-redesign.md`) for the
 * full rationale, contrast audit, and scope boundary (chrome only — the
 * instrument face/LCD/casing stays a hand-styled skeuomorphic component and
 * is intentionally NOT expressed as MD3 surface elevation here).
 *
 * This file derives an `MD3LightTheme` override from the canonical palette
 * at `packages/palette/src/index.ts` (ADR 0021). Every raw hex value in this
 * file is either:
 *   (a) a direct reference to an existing palette token, or
 *   (b) a tonal derivative computed at load time from a palette token via
 *       `withLightness()`, so it stays in sync if the source palette ever
 *       changes — no new brand hues are introduced.
 *
 * ── MD3 role → palette mapping ──────────────────────────────────────────
 *
 * | MD3 role                | Source                                    | Contrast |
 * |--------------------------|-------------------------------------------|----------|
 * | primary                  | palette.bluePrimary (#0B6FB3)              | —        |
 * | onPrimary                | white                                      | 5.33:1 vs primary (ADR 0021 row 10) |
 * | primaryContainer         | withLightness(bluePrimary, 0.92)           | derived  |
 * | onPrimaryContainer       | withLightness(bluePrimary, 0.20)           | 9.65:1 vs primaryContainer |
 * | secondary                | palette.blueAccent (#5BC8F5)               | —        |
 * | onSecondary              | palette.ink                                | 9.30:1 vs secondary (ADR 0021 row 8); white is FORBIDDEN on blueAccent (row 9, 1.91:1) |
 * | secondaryContainer       | withLightness(blueAccent, 0.90)            | derived  |
 * | onSecondaryContainer     | withLightness(blueAccent, 0.18)            | 9.38:1 vs secondaryContainer |
 * | tertiary                 | palette.yellow (#FFD700)                   | —        |
 * | onTertiary                | palette.ink                                | 12.63:1 vs tertiary (ADR 0021 row 6); white is FORBIDDEN on yellow (row 20, 1.40:1) |
 * | tertiaryContainer         | palette.yellowTint (#FFF8CC)               | —        |
 * | onTertiaryContainer       | palette.ink                                | 16.49:1 vs tertiaryContainer (ADR 0021 row 7) |
 * | error                     | palette.red (#CC1A22)                      | —        |
 * | onError                   | white                                      | 5.62:1 vs error (ADR 0021 row 12) |
 * | errorContainer            | palette.redTint (#FDECEA)                  | —        |
 * | onErrorContainer          | palette.red (#CC1A22)                      | 4.91:1 vs errorContainer |
 * | background                | palette.paper (#f4f1ea)                    | —        |
 * | onBackground              | palette.ink                                | 15.71:1 vs background (ADR 0021 row 1) |
 * | surface                   | palette.panel (#ffffff)                    | —        |
 * | onSurface                 | palette.ink                                | 17.72:1 vs surface (ADR 0021 row 2) |
 * | surfaceVariant            | palette.panelAlt (#e9e6df)                 | —        |
 * | onSurfaceVariant          | palette.muted (#636369)                    | 4.79:1 vs surfaceVariant (ADR 0021 row 5) |
 * | outline                   | palette.muted (#636369)                    | 5.29:1 vs background, 5.97:1 vs surface — meets WCAG 1.4.11 (3:1 UI component) |
 * | outlineVariant            | palette.line (#d4d1ca)                     | decorative dividers only (ADR 0021 notes ~1.35:1 vs paper — never used for text or required-contrast boundaries) |
 * | shadow / scrim / backdrop | palette.ink (#18181b), alpha-blended        | standard MD3 scrim usage |
 * | inverseSurface            | palette.blueDim (#00213A)                  | dark instrument-family surface (announce board / LCD background), reused per ADR 0021 |
 * | inverseOnSurface          | white                                      | 16.42:1 vs inverseSurface (ADR 0021 row 19) |
 * | inversePrimary            | palette.blueAccent (#5BC8F5)               | 8.62:1 vs inverseSurface — accent action color on dark surfaces |
 * | surfaceDisabled           | palette.ink @ 12% alpha                    | standard MD3 disabled-surface opacity |
 * | onSurfaceDisabled         | palette.ink @ 38% alpha                    | standard MD3 disabled-content opacity |
 * | elevation.level0-5        | mix(panel, bluePrimary, 0%/5%/8%/11%/12%/14%) | standard MD3 tonal-elevation overlay ratios, tinted with the brand primary instead of a generic MD3 purple |
 *
 * Explicitly OUT of scope for this theme: `instrumentFace`, `instrumentCasing`,
 * `instrumentBezel`, `instrumentInner`, and the DSEG7 LCD digit font. Those
 * remain hand-styled skeuomorphic tokens consumed directly from
 * `packages/palette/src/index.ts` — never routed through this MD3 theme.
 *
 * ── Material 3 Expressive (M3E) additions ───────────────────────────────
 *
 * This file also exports standalone Material 3 Expressive tokens —
 * `stopwatchFixedColors`, `stopwatchEmphasizedFonts`, `stopwatchShape`, and
 * `stopwatchSpring` — layered on top of the standard-MD3 `stopwatchTheme`
 * above. `react-native-paper` v5 has no first-class M3E support, so these
 * live alongside `stopwatchTheme` rather than inside its `MD3Theme` shape.
 * See ADR 0026's "Material 3 Expressive" section for the full contrast
 * table and rationale. Foundation only (issue #460) — no screen consumes
 * these yet; that's the follow-up polish issue (#461).
 */

import { MD3LightTheme } from "react-native-paper";
import type { MD3Theme } from "react-native-paper";
import { palette } from "../../../packages/palette/src/index";

// ── Color math helpers (HSL tonal derivation) ───────────────────────────────
// These exist solely to keep MD3 "container" tonal pairs in sync with the
// canonical palette. They intentionally only ever adjust *lightness* — hue
// and saturation are preserved so no new brand color is introduced.

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}

/** Returns `hex` re-expressed with its HSL lightness set to `l` (0–1). */
function withLightness(hex: string, l: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb({ ...hsl, l }));
}

/** Linear-interpolates between two hex colors by `t` (0–1). */
function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

// ── Derived tonal pairs (see mapping table above for contrast ratios) ──────
const primaryContainer = withLightness(palette.bluePrimary, 0.92);
const onPrimaryContainer = withLightness(palette.bluePrimary, 0.2);
const secondaryContainer = withLightness(palette.blueAccent, 0.9);
const onSecondaryContainer = withLightness(palette.blueAccent, 0.18);

// ── Material 3 Expressive (M3E) additions ───────────────────────────────────
// See ADR 0026's "Material 3 Expressive" section for full rationale and the
// WCAG contrast table. `react-native-paper` v5 does not model M3E as a first
// -class theme (no `MD3Theme.colors.*Fixed*` keys, no expressive shape/motion
// config), so these are exported as standalone constants alongside
// `stopwatchTheme` rather than merged into its `colors`/`fonts`/`roundness`
// shape. Consumers (the #461 polish issue) import them directly.
//
// ── M3E "fixed" color roles ─────────────────────────────────────────────
// M3E's fixed roles are tone-locked regardless of light/dark theme (unlike
// `*Container`, which inverts in a dark theme). They use the same
// HSL-lightness-only derivation rule as the container roles above:
//   Fixed        → withLightness(source, 0.90)  (~MD3 tone 90)
//   FixedDim     → withLightness(source, 0.80)  (~MD3 tone 80)
//   onFixed      → withLightness(source, 0.10)  (~MD3 tone 10)
//   onFixedVariant → withLightness(source, 0.20 primary / 0.18 secondary)
//                    (~MD3 tone 30; reuses the exact onPrimaryContainer /
//                    onSecondaryContainer derivation above so the same hex
//                    value serves both roles)
// For `tertiary` (palette.yellow), the derived onFixedVariant tone fails AA
// against `tertiaryFixedDim` (3.29:1 — below the 4.5:1 normal-text
// threshold), so — consistent with `onTertiary`/`onTertiaryContainer`
// already resolving to `palette.ink` above rather than a derived tone —
// both `onTertiaryFixed` and `onTertiaryFixedVariant` use `palette.ink`
// directly instead of a derived value.
const primaryFixed = withLightness(palette.bluePrimary, 0.9); // #cfeafc
const primaryFixedDim = withLightness(palette.bluePrimary, 0.8); // #9fd5f9
const onPrimaryFixed = withLightness(palette.bluePrimary, 0.1); // #031e30
const onPrimaryFixedVariant = onPrimaryContainer; // #063c60 (reused, see above)

const secondaryFixed = withLightness(palette.blueAccent, 0.9); // #cfeffc
const secondaryFixedDim = withLightness(palette.blueAccent, 0.8); // #9fdff9
const onSecondaryFixed = withLightness(palette.blueAccent, 0.1); // #032330
const onSecondaryFixedVariant = onSecondaryContainer; // #053f57 (reused, see above)

const tertiaryFixed = withLightness(palette.yellow, 0.9); // #fff7cc
const tertiaryFixedDim = withLightness(palette.yellow, 0.8); // #ffef99
const onTertiaryFixed = palette.ink; // derived tone fails AA — use ink (see above)
const onTertiaryFixedVariant = palette.ink; // derived tone fails AA — use ink (see above)

/**
 * M3E "fixed" color role pairs, keyed exactly like MD3's `*Container` roles
 * but tone-locked across light/dark themes. See ADR 0026's "Material 3
 * Expressive" section for the full WCAG AA contrast table (every pairing
 * below is ≥4.5:1, computed with ADR 0021's relative-luminance formula).
 *
 * Not part of `stopwatchTheme.colors` — `MD3Theme` (react-native-paper v5)
 * has no fixed-role keys. Import this object directly wherever an M3E fixed
 * surface is needed (e.g. a "fixed" chip or CTA that must not flip color in
 * a future dark theme).
 */
export const stopwatchFixedColors = {
  primaryFixed,
  primaryFixedDim,
  onPrimaryFixed,
  onPrimaryFixedVariant,

  secondaryFixed,
  secondaryFixedDim,
  onSecondaryFixed,
  onSecondaryFixedVariant,

  tertiaryFixed,
  tertiaryFixedDim,
  onTertiaryFixed,
  onTertiaryFixedVariant,
} as const;

// ── M3E emphasized type scale ────────────────────────────────────────────
// M3E adds bolder, tighter-tracked "Emphasized" variants of select M3
// typescale roles for high-attention UI (primary headlines, selected
// segmented-button labels, CTA text). These reuse the exact same
// `fontFamily`/`fontSize`/`lineHeight` as their standard MD3 counterpart in
// `MD3LightTheme.fonts` — only `fontWeight` (bumped to bold) and
// `letterSpacing` (tightened) change. No new font family is introduced.
const standardFonts = MD3LightTheme.fonts;

export const stopwatchEmphasizedFonts = {
  headlineSmallEmphasized: {
    ...standardFonts.headlineSmall,
    fontWeight: "700" as const,
    letterSpacing: -0.25, // standard headlineSmall: 0
  },
  titleMediumEmphasized: {
    ...standardFonts.titleMedium,
    fontWeight: "700" as const,
    letterSpacing: 0.05, // standard titleMedium: 0.15
  },
  labelLargeEmphasized: {
    ...standardFonts.labelLarge,
    fontWeight: "700" as const,
    letterSpacing: 0.05, // standard labelLarge: 0.1
  },
} as const;

// ── M3E expressive shape system ──────────────────────────────────────────
// Standard MD3's corner-radius scale (extraSmall…extraLarge) tops out at a
// fixed 28dp. M3E adds a fully-rounded `pill`/`stadium` token for primary
// CTAs and the instrument's physical control buttons (the `DeviceBtn`
// equivalent), plus a documented "pressed" delta that shaves a few dp off
// a shape's corner radius on press/active state — a subtle morph that reads
// as tactile feedback. `stopwatchTheme.roundness` (8) is unchanged; these
// are additive tokens for components that opt into expressive shape.
export const stopwatchShape = {
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 28,
  /** Fully rounded — for primary CTAs and instrument control buttons. */
  pill: 999,
  /**
   * Subtracted from a shape's resting corner radius on press/active state
   * to produce the M3E "morph" effect. Clamp the result at 0 — see
   * `pressedCornerRadius()`.
   */
  pressedDelta: -8,
} as const;

/** Applies `stopwatchShape.pressedDelta` to `radius`, clamped at 0. */
export function pressedCornerRadius(radius: number): number {
  return Math.max(0, radius + stopwatchShape.pressedDelta);
}

// ── M3E spring motion ─────────────────────────────────────────────────────
// M3E replaces MD3's default ease-based transitions with spring physics for
// primary interactive feedback. These constants are shaped for direct use
// with `Animated.spring` (RN's newer stiffness/damping/mass config style) or
// `react-native-reanimated`'s `withSpring()`, which share the same key
// names. Three presets cover this issue's named use cases; screens choose
// the preset matching their interaction, they don't invent new constants.
export const stopwatchSpring = {
  /** Button press / one-tap feedback — snappy, minimal overshoot. */
  standard: { damping: 20, mass: 1, stiffness: 300 },
  /** Segmented-button selection — bouncier, more expressive. */
  expressive: { damping: 12, mass: 1, stiffness: 250 },
  /** Dialog open/close — slightly slower, settled. */
  dialog: { damping: 24, mass: 1, stiffness: 200 },
} as const;

// Standard MD3 tonal-elevation overlay ratios (0%, 5%, 8%, 11%, 12%, 14%),
// tinted with the brand primary rather than MD3's default purple.
const elevation = {
  level0: "transparent",
  level1: mix(palette.panel, palette.bluePrimary, 0.05),
  level2: mix(palette.panel, palette.bluePrimary, 0.08),
  level3: mix(palette.panel, palette.bluePrimary, 0.11),
  level4: mix(palette.panel, palette.bluePrimary, 0.12),
  level5: mix(palette.panel, palette.bluePrimary, 0.14),
};

/**
 * MD3 light theme for react-native-paper, mapped onto SplitSync's canonical
 * palette. See the file-level comment for the full role → token table.
 *
 * Scope: this theme governs generic chrome only — app bars, buttons,
 * dialogs, text fields, cards, menus. It does NOT touch the stopwatch
 * instrument face (LCD/casing/bezel), which stays a bespoke component
 * outside react-native-paper per ADR 0026.
 */
export const stopwatchTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: palette.bluePrimary,
    onPrimary: "#ffffff",
    primaryContainer,
    onPrimaryContainer,

    secondary: palette.blueAccent,
    onSecondary: palette.ink,
    secondaryContainer,
    onSecondaryContainer,

    tertiary: palette.yellow,
    onTertiary: palette.ink,
    tertiaryContainer: palette.yellowTint,
    onTertiaryContainer: palette.ink,

    error: palette.red,
    onError: "#ffffff",
    errorContainer: palette.redTint,
    onErrorContainer: palette.red,

    background: palette.paper,
    onBackground: palette.ink,

    surface: palette.panel,
    onSurface: palette.ink,
    surfaceVariant: palette.panelAlt,
    onSurfaceVariant: palette.muted,

    outline: palette.muted,
    outlineVariant: palette.line,

    shadow: palette.ink,
    scrim: palette.ink,
    backdrop: "rgba(24,24,27,0.4)", // palette.ink @ 40% alpha

    inverseSurface: palette.blueDim,
    inverseOnSurface: "#ffffff",
    inversePrimary: palette.blueAccent,

    surfaceDisabled: "rgba(24,24,27,0.12)", // palette.ink @ 12% alpha (MD3 default)
    onSurfaceDisabled: "rgba(24,24,27,0.38)", // palette.ink @ 38% alpha (MD3 default)

    elevation,
  },
  roundness: 8,
};
