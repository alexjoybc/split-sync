interface SplitSyncMarkProps {
  className?: string;
  /** Override width (default: derived from viewBox aspect ratio) */
  width?: number | string;
  /** Override height */
  height?: number | string;
}

/**
 * SplitSync wordmark mark — "SPLIT" on the dark left panel and "SYNC" on the
 * yellow right panel, separated by a paper-coloured diagonal slash that echoes
 * the race-angle-offset geometry from ADR 0015.
 *
 * Self-contained SVG: no external Tailwind or CSS required.
 * Designed to read clearly from 20 px header use up to large display sizes.
 */
export function SplitSyncMark({
  className = "",
  width,
  height,
}: SplitSyncMarkProps) {
  return (
    <svg
      viewBox="0 0 86 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      width={width}
      height={height}
      className={className}
    >
      {/* Dark "SPLIT" panel — left side of the diagonal */}
      <polygon points="0,0 50,0 42,20 0,20" fill="#18181b" />
      {/* Yellow "SYNC" panel — right side of the diagonal */}
      <polygon points="50,0 86,0 86,20 42,20" fill="#f6d428" />
      {/* Paper-coloured diagonal cut — echoes --race-angle-offset clip-path */}
      <polygon points="48,0 50,0 42,20 40,20" fill="#f4f1ea" />

      {/* "SPLIT" — centred in the dark panel (midpoint ≈ x 21 at half-height) */}
      <text
        x="21"
        y="13.5"
        fill="white"
        fontSize="7.5"
        fontWeight="900"
        letterSpacing="0.8"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, Arial, sans-serif"
      >
        SPLIT
      </text>

      {/* "SYNC" — centred in the yellow panel (midpoint ≈ x 66 at half-height) */}
      <text
        x="66"
        y="13.5"
        fill="#18181b"
        fontSize="7.5"
        fontWeight="900"
        letterSpacing="0.8"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, Arial, sans-serif"
      >
        SYNC
      </text>
    </svg>
  );
}
