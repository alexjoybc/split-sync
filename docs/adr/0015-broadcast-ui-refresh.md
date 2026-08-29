# ADR 0015: Broadcast-Style Design System Refresh — Tokens, Typography, and Motion Contract

## Status

Accepted.

## Context

SplitSync's visual language is deliberately editorial: race-paper background, black rules, red actions, yellow leader emphasis. That language is the right foundation, but it currently reads as a print programme rather than a live broadcast feed. Modern sport broadcast graphics (F1 timing tower, Eurosport/TSN cycling GC overlays, velodrome omnium leaderboards) add three things on top of a similarly restrained typographic base:

1. **Angled panel geometry** on hero elements — not a full redesign, just a small diagonal cut on one corner that signals "dynamic" rather than "static."
2. **Selective depth** — a subtle gradient or shadow reserved exclusively for "live" or "leader" elements, so the eye immediately identifies what is happening *now* versus what is historical context.
3. **Real-time typography** — condensed tabular numerals so digits do not cause layout jitter as they update every second.
4. **A universal live-pulse motif** — the animated dot/ring that broadcasting has used for decades to signal "this data is live."
5. **Named motion patterns** — rank-change slides and leader-change flashes that give the board kinetic coherence instead of the current instant FLIP-only reposition.

The `race-*` CSS custom properties (`globals.css`) and the `colors` object (`apps/mobile/App.tsx`) are an explicit cross-surface contract (AGENTS.md). Any extension of that contract requires an ADR before any implementation work starts, so all surfaces converge on the same language.

This ADR locks that contract. No implementation changes are made in this issue.

---

## Decisions

### 1. New CSS custom properties (web `globals.css`)

The following tokens are **added** to the `:root` block. No existing token is removed or renamed; this is purely additive.

```css
/* ── Broadcast depth tokens ───────────────────────────────────────────────
   Used ONLY on hero/live elements (see element rule table below).
   Every other surface stays flat — no glow, no gradient.               */
--race-accent-glow:   rgba(220, 38, 38, 0.14);   /* red halo on live badge / on-course row */
--race-leader-glow:   rgba(246, 212, 40, 0.22);  /* yellow halo on leader row               */
--race-live-shadow:   0 2px 12px rgba(220, 38, 38, 0.20); /* box-shadow for live card      */
--race-leader-shadow: 0 2px 12px rgba(246, 212, 40, 0.28); /* box-shadow for leader card   */

/* ── Section line ─────────────────────────────────────────────────────────
   Unifies the muted divider already used in mobile (colors.line).
   Web was using ad-hoc Tailwind borders; this token creates parity.    */
--race-line: #d4d1ca;

/* ── Angled accent geometry ───────────────────────────────────────────────
   A clip-path that shears the trailing edge 14 px, used on hero panels.
   Applied as a utility class .race-angle-cut (see below).
   14 px is the calibrated minimum visible at 16 px base font size.     */
--race-angle-offset: 14px;

/* ── Live-pulse color ─────────────────────────────────────────────────────
   The animated dot uses race-red; this alias makes intent legible.     */
--race-pulse-color: var(--race-red);

/* ── Motion durations and easings ────────────────────────────────────────
   Exact values; implementation issues must not deviate without a new ADR. */
--motion-live-pulse-duration:   1.4s;
--motion-live-pulse-easing:     ease-in-out;
--motion-rank-flash-duration:   280ms;
--motion-rank-flash-easing:     ease-out;
--motion-leader-change-duration: 380ms;
--motion-leader-change-easing:  cubic-bezier(0.34, 1.56, 0.64, 1);  /* slight overshoot */

/* ── Display font variable ───────────────────────────────────────────────
   Wired by layout.tsx once Barlow Condensed is added to next/font/google.
   Used only on numeral-heavy elements (rank, lap count, gap, elapsed).  */
--font-display: var(--font-barlow-condensed);
```

Additionally, two new **utility classes** are added to `globals.css` alongside the existing `race-*` classes:

```css
/* Angled trailing-edge cut for hero panels. The clip-path shears
   the top-right corner by --race-angle-offset.
   DO NOT apply to table rows, admin panels, or static content.        */
.race-angle-cut {
  clip-path: polygon(
    0 0,
    calc(100% - var(--race-angle-offset)) 0,
    100% var(--race-angle-offset),
    100% 100%,
    0 100%
  );
}

/* Tabular condensed numerals — applied to rank, lap count, gap, and
   elapsed-time cells regardless of which surface they appear on.      */
.race-numeral {
  font-family: var(--font-display, var(--font-geist-mono));
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: -0.01em;
}
```

The `@theme inline` block in `globals.css` gains matching Tailwind aliases:

```css
--color-race-line:         var(--race-line);
--color-race-accent-glow:  var(--race-accent-glow);
--color-race-leader-glow:  var(--race-leader-glow);
```

### 2. Mobile `colors` object parity (`apps/mobile/App.tsx`)

Every new web token has a matching mobile key. Names use camelCase to follow the existing object style. Hex values are equivalent to the CSS `rgba()` values above at their respective alpha levels.

```ts
const colors = {
  // ── Existing (unchanged) ──────────────────────────────────────────────
  paper:     "#f4f1ea",
  panel:     "#ffffff",
  ink:       "#18181b",
  muted:     "#71717a",
  red:       "#ec1c24",
  yellow:    "#f6d428",
  line:      "#d4d1ca",   // already present; web now matches this value
  ttSection: "#f0ece3",

  // ── New broadcast tokens ──────────────────────────────────────────────
  accentGlow:   "rgba(220, 38, 38, 0.14)",   // live badge / on-course row halo
  leaderGlow:   "rgba(246, 212, 40, 0.22)",  // leader row halo
  pulseColor:   "#ec1c24",                   // alias of red; live-pulse dot fill

  // Motion durations (milliseconds, used with Animated/Reanimated):
  // motionLivePulseDuration:    1400
  // motionRankFlashDuration:     280
  // motionLeaderChangeDuration:  380
  // (documented as comments, not runtime values, since RN uses numeric ms)
};
```

Shadow equivalents for mobile use React Native's `shadowColor`/`shadowOpacity` props (iOS) and `elevation` (Android), targeting the same visual weight as the web `box-shadow` values:

| Element | `shadowColor` | `shadowOpacity` | `shadowRadius` | `elevation` |
|---|---|---|---|---|
| Live card / on-course row | `#dc2626` | `0.20` | `8` | `4` |
| Leader card | `#f6d428` | `0.28` | `8` | `4` |

### 3. Typography decision

**Decision: adopt Geist for body/UI text and add Barlow Condensed for numeral-heavy display columns.**

Rationale:

- `layout.tsx` already loads Geist Sans and Geist Mono via `next/font/google` and injects them as `--font-geist-sans` / `--font-geist-mono` CSS variables on `<html>`. The `body` rule in `globals.css` line 32 overrides this with a hardcoded `Arial, Helvetica, sans-serif`, making the imported fonts effectively unused.
- Fix: replace that `body` font-family declaration with `font-family: var(--font-geist-sans), system-ui, sans-serif;`. This is not a visual redesign — Geist is geometrically similar to the current fallback and the switch will be imperceptible in production; it simply activates what is already being downloaded.
- Geist does not include a condensed variant. Broadcast timing towers universally use a true condensed face for rank/numeral columns. Using `font-stretch: condensed` on a non-condensed font produces no condensing in most browsers. The only correct choice is a separate condensed typeface.
- **Barlow Condensed** (Google Fonts, SIL Open Font License) is chosen: it is in active use on Eurosport and Vox Media sport properties, it ships a `700` (Bold) weight that matches the existing `font-black` heaviness of the system, and it has full tabular-numeral support. It does not introduce a new runtime dependency — it is loaded through the same `next/font/google` mechanism already used for Geist.
- Scope: Barlow Condensed is used **only** for the `.race-numeral` class — rank cells, lap-count cells, gap cells, and elapsed-time cells. All other text (labels, names, headings, action buttons) stays on Geist Sans. This is a numeral-specific choice, not a headline font replacement.

**Web implementation sketch** (to be done in the implementing issue):

```ts
// apps/web/src/app/layout.tsx
import { Geist, Geist_Mono, Barlow_Condensed } from "next/font/google";

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["700"],
});
// Add barlowCondensed.variable to <html> className
```

```css
/* apps/web/src/app/globals.css — body rule replacement */
body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-geist-sans), system-ui, sans-serif;
}
```

**Mobile implementation:**

`@expo-google-fonts/barlow-condensed` is the established Expo pattern for Google Fonts. Load with `useFonts` from `expo-font` (standard Expo SDK 57 pattern), reference the `BarlowCondensed_700Bold` variant. Apply to numeral cells via a dedicated StyleSheet entry:

```ts
// apps/mobile/App.tsx — font loading (added alongside existing useFonts calls if any)
import { BarlowCondensed_700Bold } from "@expo-google-fonts/barlow-condensed";
// ...
const [fontsLoaded] = useFonts({ BarlowCondensed_700Bold });

// StyleSheet entry:
raceNumeral: {
  fontFamily: "BarlowCondensed_700Bold",
  fontVariant: ["tabular-nums"],
  fontWeight: "700",
  letterSpacing: -0.2,
},
```

### 4. Motion vocabulary — named patterns

Each pattern has a canonical name, a one-line definition, exact timing values, and a scope rule.

| Pattern name | Definition | Duration | Easing | Trigger |
|---|---|---|---|---|
| **live-pulse** | A small dot or ring (8–10 px) that scales from `0.8` to `1.0` and fades opacity from `1.0` to `0.4` in a looping breath, using `--race-pulse-color`. Conveys "actively updating." | `1.4 s` | `ease-in-out` | Applied to: live badge, on-course rider row indicator, LIVE kicker text ornament. |
| **rank-flash** | When a row's rank position changes (up or down), the row background briefly fills with `--race-accent-glow` (red) for a rank drop or `--race-leader-glow` (yellow) for a rank gain, then fades back to flat within one cycle. | `280 ms` | `ease-out` | Applied to: spectator live board standings rows on rank change. Not on organizer tables. |
| **leader-change** | When the leader row identity changes (a different rider becomes P1), the new leader row slides in from above with a slight overshoot (`cubic-bezier(0.34, 1.56, 0.64, 1)`) and the outgoing leader slides down, both completing within the window. Works alongside existing FLIP reordering. | `380 ms` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Applied to: spectator live board leader row only. |

Implementation note: all three patterns are opt-in via CSS classes / Animated calls added in implementing issues. They must respect `prefers-reduced-motion: reduce` — in reduced-motion environments, live-pulse collapses to a static dot at full opacity, rank-flash is omitted entirely, and leader-change becomes an instant reorder.

### 5. Element rule table — which elements get broadcast treatment

This table is the authoritative rule. Implementations must not extend broadcast treatment to elements not listed here without a follow-up ADR.

| Element | Depth/shadow | Angle cut | live-pulse | rank-flash | leader-change | Condensed numeral |
|---|---|---|---|---|---|---|
| Leader row (P1), spectator board | ✅ `--race-leader-shadow` | ✅ | ❌ | ✅ | ✅ | ✅ rank cell |
| On-course rider row, time trial | ✅ `--race-live-shadow` | ❌ | ✅ | ❌ | ❌ | ✅ elapsed cell |
| Live badge / LIVE kicker | ✅ `--race-live-shadow` | ✅ | ✅ | ❌ | ❌ | ❌ |
| Event masthead (spectator) | ❌ | ✅ (masthead decorative strip only) | ❌ | ❌ | ❌ | ❌ |
| Non-leader standings rows (P2+) | ❌ flat | ❌ | ❌ | ✅ | ❌ | ✅ rank + gap cells |
| Announcer board | ❌ flat | ❌ | ✅ live badge only | ❌ | ❌ | ✅ rank cells |
| Organizer admin tables | ❌ flat | ❌ | ❌ | ❌ | ❌ | ❌ |
| Organizer scorer (mobile tiles) | ❌ flat | ❌ | ❌ | ❌ | ❌ | ❌ |
| Help pages / static content | ❌ flat | ❌ | ❌ | ❌ | ❌ | ❌ |

Rule in plain language: **depth, shadow, and angle cuts are reserved for elements that represent a live, happening-now event.** The organizer admin and scorer surfaces stay entirely flat and square. The live-pulse animation is reserved for actual real-time data points. Condensed numerals are used wherever a digit column updates at sub-second frequency or where precise rank/gap reading is the primary purpose — never on labels or prose.

### 6. Non-goals

The following are explicitly out of scope for this milestone and must not be introduced without a dedicated ADR:

- **No border-radius system.** The race-paper language is square-cut. The new angle-cut is a clip-path geometry on a limited set of hero elements, not a general radius token.
- **No full color palette replacement.** `--race-red`, `--race-yellow`, `--race-ink`, `--race-paper` are unchanged in hue and usage. Only the new depth/glow tokens are added.
- **No new component library or animation library.** CSS animations and Animated API (already available in Expo SDK 57) are sufficient for all three motion patterns. Do not add Framer Motion, Lottie, or Reanimated unless a follow-up ADR justifies it.
- **No changes to `crossings`, `entries`, or any database schema.** This ADR is purely about the visual design system contract.
- **No changes to RLS or authentication.** Unrelated to this milestone.

---

## Rationale

**Why fix the Arial override now?** Geist is already downloaded on every page load (it is listed in `layout.tsx`). Keeping Arial means paying the network cost with zero visual benefit. Activating Geist is a one-line change with no visual regression risk, so there is no reason to defer it.

**Why Barlow Condensed over Geist + tabular-nums alone?** Tabular-nums fixes digit-width jitter but does not change the character's proportions. A true condensed face (narrower x-advance per character) lets more digits fit in a constrained rank/gap column at the same font size without truncation. Broadcast timing towers use condensed type for exactly this reason. Barlow Condensed is the lowest-risk choice: SIL licensed, loaded via the same mechanism already in use, zero JavaScript runtime cost.

**Why clip-path for the angle cut instead of a skewed pseudo-element?** `clip-path: polygon()` is hardware-accelerated, has no impact on sibling layout, and degrades gracefully (element remains fully readable if clip-path is unsupported). A `::after` pseudo-element with `skewX()` has known layout artifacts at small sizes and requires absolute positioning that is fragile across the multiple row widths on the board.

**Why `cubic-bezier(0.34, 1.56, 0.64, 1)` for leader-change?** The slight overshoot (spring feel) makes position changes feel earned rather than mechanical. F1 and cycling broadcast leaderboards use spring-physics transitions on leader row changes. The values are the same as `@spring-bounce-25` in CSS Motion Path proposals and work in all current browsers as a cubic-bezier approximation.

---

## Consequences

- `globals.css` gains six new CSS custom properties and two utility classes. Existing class names and token names are unchanged.
- `layout.tsx` loads one additional Google Font (`Barlow_Condensed`, weight `700` only, latin subset) — estimated ~8 kB additional transfer, offset by removing the wasted Geist download that currently produces no visual output.
- `apps/mobile/App.tsx` `colors` object grows by four keys. The mobile `@expo-google-fonts/barlow-condensed` package must be added to `apps/mobile/package.json`.
- All implementation issues in this milestone must reference this ADR and use the exact token names, durations, and easings defined here. Any deviation requires an amendment to this ADR first.
- `prefers-reduced-motion` compliance is not optional — each implementing issue must verify reduced-motion behavior before merging.
