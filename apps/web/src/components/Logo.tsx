import { SplitSyncMark } from "./SplitSyncMark";

interface LogoProps {
  className?: string;
  /** Height of the mark in pixels. Text scales with it via inherited font-size. */
  size?: "sm" | "md" | "lg";
}

const sizeClasses: Record<NonNullable<LogoProps["size"]>, string> = {
  sm: "h-5 text-[10px]",
  md: "h-6 text-[11px]",
  lg: "h-8 text-sm",
};

/**
 * SplitSync wordmark, styled like a two-tone "scoped label" (GitLab-style
 * key::value badge): a black "SPLIT" segment fused to a yellow "SYNC"
 * segment, matching the leader/emphasis color used on the live board.
 *
 * An icon mark (two angled bars in ink/yellow) precedes the wordmark text,
 * giving the badge a recognisable graphic element at all sizes.
 */
export function Logo({ className = "", size = "md" }: LogoProps) {
  return (
    <span
      className={`inline-flex select-none items-stretch overflow-hidden rounded-sm font-black uppercase tracking-wide leading-none ${sizeClasses[size]} ${className}`}
      role="img"
      aria-label="SplitSync"
    >
      <span className="flex items-center bg-race-ink pl-1 pr-2 text-white gap-1">
        <SplitSyncMark className="h-full w-auto" />
        Split
      </span>
      <span className="flex items-center bg-race-yellow px-2 text-race-ink">Sync</span>
    </span>
  );
}
