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
