interface SplitSyncMarkProps {
  className?: string;
  /** Override width (default: derived from height via aspect ratio 1:1) */
  width?: number | string;
  /** Override height */
  height?: number | string;
}

/**
 * SplitSync icon mark — two angled bars in ink and yellow separated by a
 * paper-coloured diagonal cut, echoing the race-angle-offset geometry from
 * the broadcast design system (ADR 0015).
 *
 * Designed to read clearly from 16 px (favicon) up to large display sizes.
 * Colors are hardcoded to the palette constants so this file is shareable
 * without Tailwind context (e.g. as a standalone SVG export).
 */
export function SplitSyncMark({
  className = "",
  width,
  height,
}: SplitSyncMarkProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      width={width}
      height={height}
      className={className}
    >
      {/* Black left panel */}
      <polygon points="0,0 12,0 8,20 0,20" fill="#18181b" />
      {/* Yellow right panel */}
      <polygon points="12,0 20,0 20,20 8,20" fill="#f6d428" />
      {/* Paper-coloured diagonal cut — echoes --race-angle-offset clip-path */}
      <polygon points="10,0 12,0 8,20 6,20" fill="#f4f1ea" />
    </svg>
  );
}
