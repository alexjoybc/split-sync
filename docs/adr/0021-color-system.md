# ADR 0021 — Canonical Color System and WCAG AA Palette

**Status:** Accepted  
**Date:** 2026-08-30  
**Issue:** #258

---

## Context

SplitSync's current stylesheet (`apps/web/src/app/globals.css`) contains ad-hoc hex values
that have accumulated across features. There are 5+ different reds, no formal semantic token
layer, and several text/background pairings that fail WCAG 2.1 AA contrast. The upcoming
design refresh (milestone) requires a single canonical palette that every surface can encode
consistently and that every accessibility audit can reference.

Key constraints coming into this decision:

- The brand blue comes from the native stopwatch LCD: **`#5BC8F5`** (bright cyan-blue).
- Yellow has always denoted the leader; red has historically been the primary action color.
  The refresh inverts this: **blue is now the primary interactive color**, red is reserved
  for critical-only states.
- No dark theme on organizer/spectator surfaces. The announce board (TV masthead) and
  stopwatch dials are intentionally dark instruments and keep their own dark backgrounds via
  explicit tokens.
- WCAG 2.1 Level AA: 4.5:1 minimum for normal text, 3:1 for large text (≥ 18 pt regular
  or ≥ 14 pt bold) and UI components.

---

## WCAG Contrast Methodology

Relative luminance **L** for a hex colour is computed as:

```
For each channel c = value/255:
  if c ≤ 0.04045 → c_lin = c / 12.92
  else            → c_lin = ((c + 0.055) / 1.055) ^ 2.4

L = 0.2126 · R_lin + 0.7152 · G_lin + 0.0722 · B_lin
```

Contrast ratio = **(L_lighter + 0.05) / (L_darker + 0.05)**.

All ratios below were computed by hand using this formula and rounded to two decimal places.

---

## Decision

### Token definitions

The canonical palette is organised into five groups. Every token has a single hex value,
a computed relative luminance (L), and a mandated semantic scope.

#### Neutrals

| Token | Hex | L (approx) | Semantic role |
|-------|-----|-----------|---------------|
| `paper` | `#f4f1ea` | 0.881 | Page / viewport background — warm off-white, the "race paper" surface |
| `panel` | `#ffffff` | 1.000 | Card, table-cell, modal backgrounds — pure white lift above paper |
| `panel-alt` | `#e9e6df` | 0.793 | Alternating table rows, subtle inset sections — darker than paper |
| `ink` | `#18181b` | 0.009 | Primary body text and high-emphasis labels on any light surface |
| `muted` | `#636369` | 0.126 | Secondary / de-emphasised text (timestamps, sub-labels, metadata) |
| `line` | `#d4d1ca` | 0.639 | Borders, dividers, table rules — non-text UI only |

> **`muted` was darkened from the current `#71717a` (L ≈ 0.167, ratio ≈ 4.08:1 on paper).**
> The replacement `#636369` (L ≈ 0.126) yields **5.29:1 on `paper`** and **4.79:1 on
> `panel-alt`**, both passing AA for normal text. See contrast table below.

#### Brand / Interactive

| Token | Hex | L (approx) | Semantic role |
|-------|-----|-----------|---------------|
| `blue-accent` | `#5BC8F5` | 0.501 | Brand highlight, badges, decorative accents, hover halos — **ink text only; never white text** |
| `blue-primary` | `#0B6FB3` | 0.147 | Primary buttons, links, focus rings, interactive controls — white text on this background |
| `blue-dim` | `#00213A` | 0.014 | Dark instrument surfaces: announce-board masthead, stopwatch LCD background |

> **`blue-accent` (#5BC8F5) is intentionally too bright for white text** (white-on-accent
> = 1.91:1). It is a decorative/badge colour only. Interactive elements that carry text must
> use `blue-primary`.
>
> **`blue-primary` was evaluated against several candidates:**
> - `#0A72B8` → white-on-blue 5.11:1 ✓
> - `#0B6FB3` → white-on-blue 5.33:1 ✓ ← **chosen** (clear margin, aesthetically balanced)
> - `#1565C0` → white-on-blue 5.74:1 ✓ (too dark/navy for the product aesthetic)

#### Emphasis (leader / highlight)

| Token | Hex | L (approx) | Semantic role |
|-------|-----|-----------|---------------|
| `yellow` | `#FFD700` | 0.699 | Leader jersey, leader-row accent stripe, trophy / gold medal — **ink text only** |
| `yellow-tint` | `#FFF8CC` | 0.956 | Leader row background fill, highlight band |
| `yellow-ink` | *(alias → `ink`)* | 0.009 | Explicit token meaning "text on a yellow surface"; resolves to `#18181b` |

> Yellow (`#FFD700`) replaces the current approximate `#f6d428`. `#FFD700` is the
> canonical "gold" value, produces **12.63:1** with ink, and **fails with white text**
> (1.40:1) — white must never be placed on yellow.

#### Critical

| Token | Hex | L (approx) | Semantic role |
|-------|-----|-----------|---------------|
| `red` | `#CC1A22` | 0.137 | LIVE badge, error messages, DSQ / penalty indicators, destructive-action buttons |
| `red-tint` | `#FDECEA` | 0.946 | Alert / error background fill (ink or red text on red-tint) |

> **`red` was darkened from the current `#ec1c24`** (L ≈ 0.188, white-on-red ≈ 4.41:1 —
> just below the 4.5:1 AA threshold for normal text). The new `#CC1A22` (L ≈ 0.137)
> yields **5.62:1 white-on-red** and **4.98:1 red-on-paper**, both passing normal-text AA.
>
> **Red is reserved for critical states only.** It is no longer the default action/button
> colour — that role belongs to `blue-primary`.

#### Status

| Token | Hex | L (approx) | Semantic role |
|-------|-----|-----------|---------------|
| `success` | `#166534` | 0.097 | Positive outcomes: check-in confirmed, finish recorded, result valid |
| `warning` | `#92400E` | 0.098 | Caution states: offline pending, data gap, DNS warning |

Semantic alias tokens (resolved at implementation time):

| Alias | Resolves to |
|-------|-------------|
| `live` | `red` |
| `dsq-penalty` | `red` |
| `upcoming` | `muted` |
| `finished` | `muted` |

---

### WCAG 2.1 AA Contrast Audit

All foreground/background pairings for intended production use cases:

| # | Foreground | Background | Pair description | Ratio | AA Normal ≥4.5 | AA Large ≥3.0 |
|---|-----------|-----------|-----------------|-------|----------------|---------------|
| 1 | `ink` #18181b | `paper` #f4f1ea | Body text on page | **15.71:1** | ✓ | ✓ |
| 2 | `ink` #18181b | `panel` #ffffff | Body text on card | **17.72:1** | ✓ | ✓ |
| 3 | `ink` #18181b | `panel-alt` #e9e6df | Body text on alt row | **14.27:1** | ✓ | ✓ |
| 4 | `muted` #636369 | `paper` #f4f1ea | Secondary text on page | **5.29:1** | ✓ | ✓ |
| 5 | `muted` #636369 | `panel-alt` #e9e6df | Secondary text on alt row | **4.79:1** | ✓ | ✓ |
| 6 | `ink` #18181b | `yellow` #FFD700 | Text on leader accent | **12.63:1** | ✓ | ✓ |
| 7 | `ink` #18181b | `yellow-tint` #FFF8CC | Text on leader row bg | **17.07:1** | ✓ | ✓ |
| 8 | `ink` #18181b | `blue-accent` #5BC8F5 | Text on brand badge | **9.30:1** | ✓ | ✓ |
| 9 | white #ffffff | `blue-accent` #5BC8F5 | White text on brand badge | **1.91:1** | ✗ | ✗ |
| 10 | white #ffffff | `blue-primary` #0B6FB3 | White text on action button | **5.33:1** | ✓ | ✓ |
| 11 | `blue-primary` #0B6FB3 | `paper` #f4f1ea | Link text on page | **4.73:1** | ✓ | ✓ |
| 12 | white #ffffff | `red` #CC1A22 | White text on LIVE badge / error btn | **5.62:1** | ✓ | ✓ |
| 13 | `red` #CC1A22 | `paper` #f4f1ea | Red text (DSQ, error) on page | **4.98:1** | ✓ | ✓ |
| 14 | `ink` #18181b | `red-tint` #FDECEA | Body text in error alert | **15.12:1** | ✓ | ✓ |
| 15 | white #ffffff | `success` #166534 | White text on success badge | **7.12:1** | ✓ | ✓ |
| 16 | `success` #166534 | `paper` #f4f1ea | Success text on page | **6.31:1** | ✓ | ✓ |
| 17 | white #ffffff | `warning` #92400E | White text on warning badge | **7.08:1** | ✓ | ✓ |
| 18 | `warning` #92400E | `paper` #f4f1ea | Warning text on page | **6.28:1** | ✓ | ✓ |
| 19 | white #ffffff | `blue-dim` #00213A | White text on dark masthead/LCD | **16.43:1** | ✓ | ✓ |
| 20 | white #ffffff | `yellow` #FFD700 | White text on yellow — **FORBIDDEN** | **1.40:1** | ✗ | ✗ |

> **Row 9** (white on `blue-accent`) and **Row 20** (white on `yellow`) both fail. These
> are documented as hard constraints: those backgrounds require **`ink` text only**.

**`line` border note:** `line` (#d4d1ca) vs `paper` (#f4f1ea) yields ≈ 1.35:1 — it is not
intended for text or as the sole focus indicator. Where WCAG 1.4.11 (UI components, 3:1)
applies — e.g., focus outlines — use `blue-primary` or `ink` instead of `line`.

---

### Semantic role rules (mandatory)

1. **Blue is the interactive colour.** All links, primary buttons, focus rings, and
   interactive affordances use `blue-primary` (or `blue-accent` for decorative-only states
   where no text is placed on the accent surface).
2. **Red is for critical states only.** LIVE badge, errors, DSQ/penalty, destructive
   actions. It must not be used for generic navigation, secondary actions, or branding.
3. **Yellow is for the leader / gold emphasis only.** Do not use yellow for interactive
   elements, warnings, or general highlights.
4. **White text on `blue-accent` or `yellow` is forbidden** (contrast < 2:1). Always use
   `ink` (#18181b) on those backgrounds.
5. **`muted` text must only appear on `paper`, `panel`, or `panel-alt` backgrounds.**
   Using it on coloured surfaces (yellow, blue-accent, red) is not defined and may fail
   contrast — use `ink` instead.
6. **The announce-board masthead and stopwatch LCD are intentionally dark instruments.**
   They use `blue-dim` (#00213A) as their background, which is not part of the light-surface
   token hierarchy.

---

## Consequences

### Positive

- Every text/background pairing used in production has a documented and verified contrast
  ratio ≥ 4.5:1 (normal text) or ≥ 3:1 (large/UI).
- Semantic token names decouple design intent from raw hex values; future palette revisions
  are a single-source-of-truth change.
- The "red = critical only" rule eliminates visual ambiguity between destructive and
  navigation actions.
- Single canonical red (`#CC1A22`) replaces the current 5+ reds scattered across the
  codebase.

### Negative / trade-offs

- `blue-primary` (#0B6FB3) is noticeably darker than the bright brand `blue-accent`
  (#5BC8F5). Buttons will feel heavier than accent badges — this is intentional
  (accessibility requires the darker value for white text).
- `muted` (#636369) is slightly darker than the existing `#71717a`; secondary labels will
  be marginally more prominent. This is a deliberate accessibility improvement.
- Canonical `yellow` shifts from the current approximate `#f6d428` to `#FFD700`. Visual
  difference is minimal but may require a sweep of hardcoded values in existing components.

### Implementation note

This ADR defines the canonical values only. No code changes are made here. The next issue
(#261) will encode these tokens into `apps/web/src/app/globals.css` CSS custom properties
and the mobile `colors` object. Until that PR lands, the values in this ADR are the
normative reference.

---

## Palette reference table (implementation-ready)

| Token | Hex | RGB |
|-------|-----|-----|
| `paper` | `#f4f1ea` | 244, 241, 234 |
| `panel` | `#ffffff` | 255, 255, 255 |
| `panel-alt` | `#e9e6df` | 233, 230, 223 |
| `ink` | `#18181b` | 24, 24, 27 |
| `muted` | `#636369` | 99, 99, 105 |
| `line` | `#d4d1ca` | 212, 209, 202 |
| `blue-accent` | `#5BC8F5` | 91, 200, 245 |
| `blue-primary` | `#0B6FB3` | 11, 111, 179 |
| `blue-dim` | `#00213A` | 0, 33, 58 |
| `yellow` | `#FFD700` | 255, 215, 0 |
| `yellow-tint` | `#FFF8CC` | 255, 248, 204 |
| `yellow-ink` | *(→ ink)* | 24, 24, 27 |
| `red` | `#CC1A22` | 204, 26, 34 |
| `red-tint` | `#FDECEA` | 253, 236, 234 |
| `success` | `#166534` | 22, 101, 52 |
| `warning` | `#92400E` | 146, 64, 14 |
