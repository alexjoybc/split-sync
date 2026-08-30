/**
 * @splitsync/palette — Single source of truth for the SplitSync color system.
 *
 * All canonical tokens are defined here and consumed by:
 *   - apps/web  (globals.css :root + Tailwind @theme)
 *   - apps/mobile (colors object in App.tsx)
 *   - apps/stopwatch (palette C in App.tsx)
 *
 * Canonical values are from ADR 0021.
 * Do NOT define divergent copies in any surface.
 */

export const palette = {
  // ── Base surface ──────────────────────────────────────────────────────────
  paper:     '#f4f1ea',
  panel:     '#ffffff',
  panelAlt:  '#e9e6df',

  // ── Typography ────────────────────────────────────────────────────────────
  ink:       '#18181b',
  muted:     '#636369',   // darkened from #71717a for WCAG AA

  // ── Structural ───────────────────────────────────────────────────────────
  line:      '#d4d1ca',

  // ── Blue family ──────────────────────────────────────────────────────────
  blueAccent:  '#5BC8F5',
  bluePrimary: '#0B6FB3',
  blueDim:     '#00213A',

  // ── Status / action ───────────────────────────────────────────────────────
  yellow:      '#FFD700',
  yellowTint:  '#FFF8CC',
  red:         '#CC1A22',   // darkened from #ec1c24 for WCAG AA
  redTint:     '#FDECEA',
  success:     '#166534',
  warning:     '#92400E',

  // ── Semantic shortcuts ────────────────────────────────────────────────────
  live:     '#CC1A22',  // alias: palette.red
  dsq:      '#CC1A22',  // alias: palette.red
  upcoming: '#636369',  // alias: palette.muted
  finished: '#18181b',  // alias: palette.ink

  // ── Yellow-on-ink text pairing ────────────────────────────────────────────
  yellowInk:  '#18181b',                  // ink-on-yellow is the correct pair
  yellowBg:   'rgba(255,215,0,0.20)',     // 20% yellow tint for row backgrounds

  // ── Glow / shadow depth tokens ────────────────────────────────────────────
  accentGlow:   'rgba(11,111,179,0.14)',            // blue-primary based
  leaderGlow:   'rgba(255,215,0,0.22)',
  liveShadow:   '0 2px 12px rgba(204,26,34,0.20)', // red-based (live/critical)
  leaderShadow: '0 2px 12px rgba(255,215,0,0.28)',

  // ── Instrument-only dark tokens (stopwatch dial, announce TV) ────────────
  instrumentFace:   '#0D0D0D',
  instrumentCasing: '#1A1A1A',
  instrumentBezel:  '#1a1a1c',
  instrumentInner:  '#111113',
} as const;

export type Palette = typeof palette;
