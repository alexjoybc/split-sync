# ADR 0026 — Stopwatch Material Design 3 Redesign (Native Foundation)

**Status:** Accepted
**Date:** 2026-09-04
**Issue:** #434

---

## Context

The casual stopwatch surface (`apps/stopwatch` native app, and its web
companion at `apps/web/src/app/stopwatch`) uses hand-rolled `StyleSheet`
styling with no formal design system. As the stopwatch grows more screens
(session switcher, live view, repeat/Pomodoro config, join/create flows), the
lack of consistent elevation, shape, typography scale, and component
interaction patterns (ripple, focus, disabled states) is becoming a
maintenance and consistency cost.

Material Design 3 (MD3) provides a mature, well-documented system for these
concerns — elevation tiers, a semantic color-role vocabulary, a type scale,
and pre-built components (buttons, dialogs, text fields, app bars, cards)
with accessible interaction states out of the box.

This ADR **does not discard SplitSync's existing palette**
(`packages/palette/src/index.ts`, ADR 0021). It defines how that palette maps
onto MD3's semantic color roles so the stopwatch can adopt MD3 structure and
components while keeping the same brand colors and the same WCAG AA
guarantees ADR 0021 already established.

### Constraints coming into this decision

- ADR 0021 is the single source of truth for color values and already has a
  full WCAG 2.1 AA contrast audit. Any MD3 role mapping must not violate that
  audit's forbidden pairings (white text on `blueAccent`/`yellow`) or
  introduce new hex values outside the existing palette or its documented
  tonal derivatives.
- The stopwatch's **instrument face** — the dark LCD display, its bezel,
  casing, and the DSEG7 seven-segment digit font — is a deliberate
  skeuomorphic design choice (a "real stopwatch" look), not a generic app
  surface. It must not be flattened into a standard MD3 `surface` +
  elevation card. See ADR 0021's note that "the announce-board masthead and
  stopwatch LCD are intentionally dark instruments."
- The native app runs Expo SDK 54 / React Native 0.81 (`apps/stopwatch`).
  Any UI library must be compatible with the New Architecture (Fabric) that
  Expo 54 defaults to, and must not require ejecting from Expo-managed
  workflow.
- This ADR's scope is the **native app foundation only** (theme + provider
  wiring). The web companion's MD3 adoption (`@material/web`) and all
  individual screen restylings are tracked as separate, dependent issues so
  each can be reviewed and shipped independently without a single
  all-screens-at-once migration.

---

## Decision

### Library choice

- **Native (`apps/stopwatch`): [`react-native-paper`](https://callstack.github.io/react-native-paper/)
  v5.** It is the most widely adopted MD3 component library for React
  Native, ships full MD3 (not just MD2) component variants, supports
  supplying a fully custom `MD3Theme` (which is required here, since we are
  not using Google's default purple), and its peer dependencies
  (`react`, `react-native`, `react-native-safe-area-context`) are already
  satisfied by the existing `apps/stopwatch` dependency set — no new native
  modules or config plugins are required, so it works cleanly with Expo's
  managed workflow and the New Architecture.
- **Web (`apps/web/src/app/stopwatch`): [`@material/web`](https://github.com/material-components/material-web)
  (tracked in a separate issue).** Google's official MD3 web component
  library. Not implemented by this ADR's issue; called out here so both
  surfaces converge on the same design language under one architectural
  decision rather than two independent ones.

### MD3 color-role mapping

MD3 defines a semantic set of color roles (`primary`/`onPrimary`, container
pairs, `surface`/`surfaceVariant`, `outline`, inverse roles, elevation
tiers, disabled-state overlays). SplitSync's existing palette
(`packages/palette/src/index.ts`) does not have a 1:1 token for every MD3
role — MD3's "container" roles in particular expect a light tonal tint of
the base role with a matching dark-on-light text color, which the palette
does not define for the blue family.

**Rule: where a direct palette token exists, use it verbatim. Where MD3
requires a tonal pair and no token exists, derive it from the existing hex
value by adjusting only its HSL *lightness* (hue and saturation are
preserved) — never introduce a new hue.** This derivation is implemented in
`apps/stopwatch/src/theme.ts` via a small `withLightness()` helper so the
derived tones stay mathematically tied to the palette and are trivially
recomputed if a source token ever changes.

| MD3 role | Source | Value | Contrast | Notes |
|---|---|---|---|---|
| `primary` | `palette.bluePrimary` | `#0B6FB3` | — | Primary buttons, FAB, active states |
| `onPrimary` | white | `#ffffff` | **5.33:1** vs primary (ADR 0021 row 10) | |
| `primaryContainer` | derived: `withLightness(bluePrimary, 0.92)` | `#d9eefd` | — | Tonal container (e.g. filled-tonal button, selected chip) |
| `onPrimaryContainer` | derived: `withLightness(bluePrimary, 0.20)` | `#063c60` | **9.65:1** vs primaryContainer | |
| `secondary` | `palette.blueAccent` | `#5BC8F5` | — | Secondary actions, brand accent |
| `onSecondary` | `palette.ink` | `#18181b` | **9.30:1** vs secondary (ADR 0021 row 8) | White is **forbidden** on `blueAccent` (ADR 0021 row 9, 1.91:1) — MD3's default `onSecondary: white` cannot be used |
| `secondaryContainer` | derived: `withLightness(blueAccent, 0.90)` | `#cfeffc` | — | |
| `onSecondaryContainer` | derived: `withLightness(blueAccent, 0.18)` | `#053f57` | **9.38:1** vs secondaryContainer | |
| `tertiary` | `palette.yellow` | `#FFD700` | — | Leader/highlight emphasis only — must not be used for generic interactive chrome (ADR 0021 rule 3) |
| `onTertiary` | `palette.ink` | `#18181b` | **12.63:1** vs tertiary (ADR 0021 row 6) | White is **forbidden** on `yellow` (ADR 0021 row 20, 1.40:1) |
| `tertiaryContainer` | `palette.yellowTint` (existing token) | `#FFF8CC` | — | No derivation needed — the palette already defines this tonal pair |
| `onTertiaryContainer` | `palette.ink` | `#18181b` | **16.49:1** vs tertiaryContainer (ADR 0021 row 7) | |
| `error` | `palette.red` | `#CC1A22` | — | |
| `onError` | white | `#ffffff` | **5.62:1** vs error (ADR 0021 row 12) | |
| `errorContainer` | `palette.redTint` (existing token) | `#FDECEA` | — | |
| `onErrorContainer` | `palette.red` | `#CC1A22` | **4.91:1** vs errorContainer | |
| `background` | `palette.paper` | `#f4f1ea` | — | |
| `onBackground` | `palette.ink` | `#18181b` | **15.71:1** vs background (ADR 0021 row 1) | |
| `surface` | `palette.panel` | `#ffffff` | — | |
| `onSurface` | `palette.ink` | `#18181b` | **17.72:1** vs surface (ADR 0021 row 2) | |
| `surfaceVariant` | `palette.panelAlt` | `#e9e6df` | — | |
| `onSurfaceVariant` | `palette.muted` | `#636369` | **4.79:1** vs surfaceVariant (ADR 0021 row 5) | |
| `outline` | `palette.muted` | `#636369` | **5.29:1** vs background, **5.97:1** vs surface | Meets WCAG 1.4.11 (3:1 non-text UI component) with margin — used for input borders, outlined-button strokes |
| `outlineVariant` | `palette.line` | `#d4d1ca` | ~1.35:1 vs paper (ADR 0021 note) | Decorative dividers only — never a required-contrast boundary, per ADR 0021's existing caveat on `line` |
| `shadow` / `scrim` | `palette.ink` | `#18181b` | — | Standard MD3 usage (drop shadows, modal scrims) |
| `backdrop` | `palette.ink` @ 40% alpha | `rgba(24,24,27,0.4)` | — | Modal/dialog backdrop |
| `inverseSurface` | `palette.blueDim` | `#00213A` | — | Reuses the existing dark-instrument token (ADR 0021) for MD3's dark-on-light-theme inverse surface (e.g. snackbars) |
| `inverseOnSurface` | white | `#ffffff` | **16.42:1** vs inverseSurface (ADR 0021 row 19) | |
| `inversePrimary` | `palette.blueAccent` | `#5BC8F5` | **8.62:1** vs inverseSurface | Accent color for actions placed on the dark inverse surface |
| `surfaceDisabled` | `palette.ink` @ 12% alpha | `rgba(24,24,27,0.12)` | — | Standard MD3 disabled-surface opacity |
| `onSurfaceDisabled` | `palette.ink` @ 38% alpha | `rgba(24,24,27,0.38)` | — | Standard MD3 disabled-content opacity |
| `elevation.level0`–`level5` | `mix(panel, bluePrimary, 0%/5%/8%/11%/12%/14%)` | `#ffffff` → `#ddebf4` | — | Standard MD3 tonal-elevation overlay ratios, tinted with the brand primary instead of MD3's default purple |

All derivations and their exact hex outputs are computed in
`apps/stopwatch/src/theme.ts` at load time (not hand-copied constants), so
they can never drift from `packages/palette/src/index.ts`.

### WCAG AA re-confirmation

Every role pairing above reuses either an ADR 0021 pairing verbatim (with
its already-documented ratio cited) or a newly derived tonal pair, each of
which was computed and checked against the same relative-luminance formula
ADR 0021 defines. All pairings meet or exceed 4.5:1 (normal text) or 3:1
(the `outline` UI-component case). No new forbidden pairing is introduced:
`onSecondary` and `onTertiary` both correctly resolve to `ink`, not white,
consistent with ADR 0021's hard constraint on `blueAccent` and `yellow`.

### Instrument face stays out of MD3

The stopwatch's **LCD display, casing, and bezel** — the `instrumentFace`,
`instrumentCasing`, `instrumentBezel`, and `instrumentInner` tokens, plus the
`DSEG7Classic` digit font — are explicitly **not** re-expressed as an MD3
`surface` + elevation card. They remain bespoke, hand-styled components
consumed directly from `packages/palette/src/index.ts`, exactly as before
this ADR. MD3 governs the **chrome around** the instrument: app bars,
buttons, dialogs, text fields, cards, menus, session-switcher list items,
and similar generic UI. This mirrors ADR 0021's own carve-out that "the
announce-board masthead and stopwatch LCD are intentionally dark
instruments" outside the general light-surface token hierarchy.

### Foundation-only rollout

This ADR's own issue (#434) implements only:

1. Adding `react-native-paper` to `apps/stopwatch/package.json`.
2. `apps/stopwatch/src/theme.ts` — the `MD3LightTheme` override described
   above.
3. Wrapping the app root (`App.tsx`, inside `SafeAreaProvider`, around
   `RootNavigator`) in `<PaperProvider theme={stopwatchTheme}>`.

No screen's JSX or styling changes in this issue — the app must render and
behave identically. Each screen's migration to `react-native-paper`
components (Login/Home, Create/Join, Session, Solo, Timer, modals) is
tracked as its own follow-up issue in the same milestone, and the web
(`@material/web`) foundation is tracked separately. All of those issues
reference this ADR for their color-role mapping instead of re-deriving it.

---

## Material 3 Expressive

**Status:** Accepted (amendment)
**Date:** 2026-09-04
**Issue:** #460

### Context

Google published **Material 3 Expressive (M3E)** in 2025 as an evolution of
standard MD3: an expanded color-role set (tone-locked "fixed" roles), a
bolder/morphing shape system, spring-physics motion, and an "emphasized"
type scale for high-attention text. Neither `react-native-paper` (native)
nor `@material/web` (web) expose M3E as a first-class theme option yet —
there is no `MD3ExpressiveTheme` to swap in. Adopting M3E therefore means
layering these additions on top of the standard-MD3 foundation this ADR
already defined, using the exact same palette-derivation discipline.

This amendment is **foundation only**, mirroring the original ADR's
foundation-only rollout: it extends `apps/stopwatch/src/theme.ts` and
`apps/web/src/app/stopwatch/md3-theme.css` with new exported
tokens/constants. **No screen's JSX changes in this issue.** Applying these
tokens to actual components is tracked in the dependent follow-up, issue
#461.

The instrument face (LCD display, casing, bezel) remains completely
out of scope, unchanged from the original ADR's carve-out — none of this
section's shape/motion/color additions apply to it.

### Fixed color roles

M3E's "fixed" roles are tone-locked color pairs that do not invert between
light/dark themes (unlike `primaryContainer`, which is `role`-inverted in a
dark theme). SplitSync's stopwatch has no dark theme today, but these roles
are exported now so components requiring a color that must never darken
(e.g. a persistent "fixed" chip) have one, and so the follow-up issue isn't
blocked on deriving them later.

They reuse the **exact same HSL-lightness-only derivation rule** as this
ADR's original container roles (hue and saturation preserved, only
lightness changes), computed in `apps/stopwatch/src/theme.ts` via the same
`withLightness()` helper — no new derivation mechanism:

| M3E role | Source | Derivation | Value |
|---|---|---|---|
| `primaryFixed` | `palette.bluePrimary` | `withLightness(bluePrimary, 0.90)` | `#cfeafc` |
| `primaryFixedDim` | `palette.bluePrimary` | `withLightness(bluePrimary, 0.80)` | `#9fd5f9` |
| `onPrimaryFixed` | `palette.bluePrimary` | `withLightness(bluePrimary, 0.10)` | `#031e30` |
| `onPrimaryFixedVariant` | `palette.bluePrimary` | `withLightness(bluePrimary, 0.20)` (= `onPrimaryContainer`, reused) | `#063c60` |
| `secondaryFixed` | `palette.blueAccent` | `withLightness(blueAccent, 0.90)` | `#cfeffc` |
| `secondaryFixedDim` | `palette.blueAccent` | `withLightness(blueAccent, 0.80)` | `#9fdff9` |
| `onSecondaryFixed` | `palette.blueAccent` | `withLightness(blueAccent, 0.10)` | `#032330` |
| `onSecondaryFixedVariant` | `palette.blueAccent` | `withLightness(blueAccent, 0.18)` (= `onSecondaryContainer`, reused) | `#053f57` |
| `tertiaryFixed` | `palette.yellow` | `withLightness(yellow, 0.90)` | `#fff7cc` |
| `tertiaryFixedDim` | `palette.yellow` | `withLightness(yellow, 0.80)` | `#ffef99` |
| `onTertiaryFixed` | `palette.ink` | direct (see note below) | `#18181b` |
| `onTertiaryFixedVariant` | `palette.ink` | direct (see note below) | `#18181b` |

> **Tertiary note:** the mathematically-derived `onFixedVariant` tone for
> `yellow` (`withLightness(yellow, 0.30)` → `#998100`) yields only **3.29:1**
> against `tertiaryFixedDim` — below the 4.5:1 AA threshold for normal text
> (it does clear 3:1 for large text/UI, but not normal text). Consistent
> with this ADR's original table, where `onTertiary` and
> `onTertiaryContainer` already resolve to `palette.ink` rather than a
> derived tone (because white is forbidden on `yellow` per ADR 0021), both
> `onTertiaryFixed` and `onTertiaryFixedVariant` use `palette.ink` directly.

#### WCAG AA contrast — fixed color roles

All ratios computed with ADR 0021's relative-luminance formula, rounded to
two decimals.

| # | Foreground | Background | Pair | Ratio | AA Normal ≥4.5 | AA Large/UI ≥3.0 |
|---|---|---|---|---|---|---|
| 1 | `onPrimaryFixed` `#031e30` | `primaryFixed` `#cfeafc` | Text on primary-fixed | **13.66:1** | ✓ | ✓ |
| 2 | `onPrimaryFixed` `#031e30` | `primaryFixedDim` `#9fd5f9` | Text on primary-fixed-dim | **10.84:1** | ✓ | ✓ |
| 3 | `onPrimaryFixedVariant` `#063c60` | `primaryFixed` `#cfeafc` | Variant text on primary-fixed | **9.23:1** | ✓ | ✓ |
| 4 | `onPrimaryFixedVariant` `#063c60` | `primaryFixedDim` `#9fd5f9` | Variant text on primary-fixed-dim | **7.33:1** | ✓ | ✓ |
| 5 | `onSecondaryFixed` `#032330` | `secondaryFixed` `#cfeffc` | Text on secondary-fixed | **13.52:1** | ✓ | ✓ |
| 6 | `onSecondaryFixed` `#032330` | `secondaryFixedDim` `#9fdff9` | Text on secondary-fixed-dim | **11.19:1** | ✓ | ✓ |
| 7 | `onSecondaryFixedVariant` `#053f57` | `secondaryFixed` `#cfeffc` | Variant text on secondary-fixed | **9.38:1** | ✓ | ✓ |
| 8 | `onSecondaryFixedVariant` `#053f57` | `secondaryFixedDim` `#9fdff9` | Variant text on secondary-fixed-dim | **7.76:1** | ✓ | ✓ |
| 9 | `onTertiaryFixed` (`ink`) `#18181b` | `tertiaryFixed` `#fff7cc` | Text on tertiary-fixed | **16.39:1** | ✓ | ✓ |
| 10 | `onTertiaryFixed` (`ink`) `#18181b` | `tertiaryFixedDim` `#ffef99` | Text on tertiary-fixed-dim | **15.24:1** | ✓ | ✓ |
| 11 | `onTertiaryFixedVariant` (`ink`) `#18181b` | `tertiaryFixed` `#fff7cc` | Variant text on tertiary-fixed | **16.39:1** | ✓ | ✓ |
| 12 | `onTertiaryFixedVariant` (`ink`) `#18181b` | `tertiaryFixedDim` `#ffef99` | Variant text on tertiary-fixed-dim | **15.24:1** | ✓ | ✓ |

Every new pairing clears 4.5:1 (normal text) with margin. No forbidden
pairing is introduced — the tertiary (yellow) family again correctly
resolves its "on" roles to `ink`, never white or a derived tone that fails.

### Emphasized type scale

M3E adds "Emphasized" variants of select M3 typescale roles for
high-attention text (primary headlines, selected segmented-button labels,
CTA copy): bolder weight and tighter letter-spacing than the standard role,
**reusing the same brand font family and the same font-size/line-height** —
no new font is introduced.

| M3E role | Base MD3 role | Weight | Letter-spacing | Font size / line height |
|---|---|---|---|---|
| `headlineSmallEmphasized` | `headlineSmall` | `700` (vs `400` standard) | `-0.25` (vs `0` standard) | 24 / 32 (unchanged) |
| `titleMediumEmphasized` | `titleMedium` | `700` (vs `500` standard) | `0.05` (vs `0.15` standard) | 16 / 24 (unchanged) |
| `labelLargeEmphasized` | `labelLarge` | `700` (vs `500` standard) | `0.05` (vs `0.1` standard) | 14 / 20 (unchanged) |

Native: `stopwatchEmphasizedFonts` in `apps/stopwatch/src/theme.ts`, each
entry shaped as an `MD3Type` object (spreads the standard role from
`MD3LightTheme.fonts`, overriding only `fontWeight`/`letterSpacing`). Web:
`--md-sys-typescale-{role}-emphasized-{weight,tracking}` custom properties
in `md3-theme.css` — the size/line-height custom properties from the
standard scale are reused unchanged.

Emphasized type styles carry text colors from the standard MD3 roles above
(`onSurface`, `onPrimary`, etc.) — weight/tracking changes do not alter
contrast, so no new contrast entries are needed for this section.

### Expressive shape system

Standard MD3's corner-radius scale (`extraSmall` 4 / `small` 8 / `medium`
12 / `large` 16 / `extraLarge` 28) has no fully-rounded token and no
press-state shape change. M3E adds both:

- **`pill`/`stadium` (999)** — a fully-rounded corner radius for primary
  CTAs and the instrument's physical control buttons (the `DeviceBtn`
  equivalent), giving them a bolder, more tactile silhouette than a
  standard MD3 `large`-radius button.
- **`pressedDelta` (-8)** — subtracted from a shape's resting corner radius
  on press/active state, producing a subtle "morph" (the shape tightens
  slightly) as tactile feedback. Consumers clamp the result at 0 (see
  `pressedCornerRadius()` helper in `theme.ts`).

Native: `stopwatchShape` object (`extraSmall`/`small`/`medium`/`large`/
`extraLarge`/`pill`/`pressedDelta`) plus a `pressedCornerRadius(radius)`
helper, both exported from `apps/stopwatch/src/theme.ts`.
`stopwatchTheme.roundness` (8) is unchanged — these are additive tokens for
components that opt into expressive shape, not a global roundness change.
Web: matching `--md-sys-shape-corner-*` custom properties (including
`--md-sys-shape-corner-pressed-delta`, a signed px value for use with
`calc()`) in `md3-theme.css`.

This section does not apply to the instrument face (LCD, casing, bezel),
which keeps its own hand-styled corner radii untouched, per this ADR's
existing instrument carve-out above.

### Spring motion

M3E replaces MD3's default linear/ease transitions with spring physics for
primary interactive feedback: button press, dialog open/close, and
segmented-button selection. Three named presets cover this issue's scoped
use cases; screens choose the matching preset rather than inventing new
constants:

| Preset | Use case | damping | stiffness | mass |
|---|---|---|---|---|
| `standard` | Button press / one-tap feedback | 20 | 300 | 1 |
| `expressive` | Segmented-button selection | 12 | 250 | 1 |
| `dialog` | Dialog open/close | 24 | 200 | 1 |

Native: `stopwatchSpring` in `apps/stopwatch/src/theme.ts`, keyed
`standard`/`expressive`/`dialog`, each an object with `damping`/`mass`/
`stiffness` — directly usable as the `config` argument to `Animated.spring`
(RN's stiffness-based config style) or `react-native-reanimated`'s
`withSpring()`, which share the same key names.

Web: true CSS spring-timing easing is not yet broadly supported, so
`md3-theme.css` defines `cubic-bezier` + duration **approximations** of a
spring curve (slight overshoot, matching the "snappier vs. bouncier vs.
settled" feel of the three native presets) as
`--md-motion-spring-{standard,expressive,dialog}-{easing,duration}` custom
properties, scoped to `.md3-stopwatch-scope` alongside the color/shape
tokens — no separate `md3-motion.css` file, since the token count is small
enough to stay in the existing file without harming readability (this is a
deliberate deviation from the issue's suggested-but-optional separate-file
option).

### WCAG AA re-confirmation

Every new color pairing introduced by this amendment — the twelve fixed-role
pairings in the table above — was computed with the identical
relative-luminance formula ADR 0021 defines and meets or exceeds 4.5:1
(normal text). No forbidden pairing (white on `blueAccent`/`yellow`) is
introduced anywhere in this amendment. The emphasized type scale and
expressive shape/motion tokens introduce no new colors and therefore
require no additional contrast entries.

### Foundation-only rollout (amendment)

This amendment's own issue (#460) implements only:

1. This "Material 3 Expressive" ADR section.
2. `apps/stopwatch/src/theme.ts` — `stopwatchFixedColors`,
   `stopwatchEmphasizedFonts`, `stopwatchShape` (+ `pressedCornerRadius()`),
   and `stopwatchSpring`, exported alongside the existing `stopwatchTheme`.
3. `apps/web/src/app/stopwatch/md3-theme.css` — the analogous
   `--md-sys-color-*-fixed*`, `--md-sys-typescale-*-emphasized-*`,
   `--md-sys-shape-corner-*`, and `--md-motion-spring-*` custom properties,
   scoped to `.md3-stopwatch-scope`.

No screen's JSX or styling changes in this issue. Applying these tokens to
actual components (buttons, dialogs, segmented controls, CTAs) is tracked
in the dependent follow-up, issue #461.

---

## Consequences

### Positive

- The stopwatch gains a real design-system component library (buttons,
  dialogs, text fields, app bars, snackbars, menus) with built-in
  accessible interaction states (ripple, focus, disabled), without
  discarding SplitSync's brand palette or its WCAG AA guarantees.
- Every MD3 role is traceable to a single palette token or a documented,
  reproducible derivation formula — there is no hand-picked hex value in the
  new theme that isn't accountable to `packages/palette/src/index.ts`.
- The instrument face's distinct, skeuomorphic identity is explicitly
  preserved and documented as intentional, preventing a well-meaning future
  contributor from "fixing" it into a generic Material card.
- Splitting the rollout into a foundation issue plus per-screen follow-ups
  keeps each PR reviewable and revertible independently.

### Negative / trade-offs

- Two parallel styling systems now coexist in the native app during the
  migration window: `StyleSheet`-based screens (unmigrated) and
  `react-native-paper` components (as screens migrate). This is intentional
  and temporary, but contributors must know which screens have moved.
- The derived tonal containers (`primaryContainer`, `secondaryContainer`,
  and their `onX` pairs) are new hex values that exist only inside
  `apps/stopwatch/src/theme.ts` — they are not exported from
  `packages/palette/src/index.ts` itself, since they are MD3-specific tonal
  derivatives rather than canonical brand colors. If a future surface needs
  the same containers outside `react-native-paper`, the derivation helper
  should be lifted into a shared location rather than re-hand-copied.
- `react-native-paper`'s default icon set expects `react-native-vector-icons`
  (or an Expo font substitute) for full icon support; no screen currently
  uses Paper's icon-bearing components, so this is deferred until a
  follow-up issue actually needs icons.

### Implementation

- `apps/stopwatch/package.json` — `react-native-paper` added as a
  dependency.
- `apps/stopwatch/src/theme.ts` — `stopwatchTheme: MD3Theme`, derived from
  `packages/palette/src/index.ts` as described above.
- `apps/stopwatch/App.tsx` — `App()` wraps `RootNavigator` in
  `<PaperProvider theme={stopwatchTheme}>`, nested inside the existing
  `SafeAreaProvider`. No other change to `App.tsx`.
