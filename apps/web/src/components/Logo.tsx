import { SplitSyncMark } from "./SplitSyncMark";

interface LogoProps {
  className?: string;
  /** Height of the mark. Width scales automatically from the 86:20 viewBox aspect ratio. */
  size?: "sm" | "md" | "lg";
}

const heightClass: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "h-5",
  md: "h-6",
  lg: "h-8",
};

/**
 * SplitSync wordmark — "SPLIT" on the dark panel, "SYNC" on the yellow panel,
 * separated by a diagonal slash. Self-contained; no external text spans needed.
 */
export function Logo({ className = "", size = "md" }: LogoProps) {
  return (
    <span
      role="img"
      aria-label="SplitSync"
      className={`inline-flex select-none items-center ${className}`}
    >
      <SplitSyncMark className={`${heightClass[size]} w-auto`} />
    </span>
  );
}
