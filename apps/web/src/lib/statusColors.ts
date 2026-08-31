/**
 * Shared race-status pill colour map.
 * Use these Tailwind class strings anywhere a status badge is rendered so that
 * upcoming/active/finished always render with the same canonical token colours.
 *
 * upcoming  → neutral panel-alt + muted text   (not-yet-started)
 * active    → blue-primary + white              (in progress)
 * finished  → ink (near-black) + white          (done)
 */
export const STATUS_COLORS: Record<string, string> = {
  upcoming: "bg-race-panel-alt text-race-muted",
  active: "bg-race-blue-primary text-white",
  finished: "bg-race-ink text-white",
};
