import type { Metadata } from "next";
import "./md3-theme.css";
import "./md3-components";

export const metadata: Metadata = {
  title: "Stopwatch — free, no ads, no account",
  description:
    "A free stopwatch with lap recording, best-lap highlighting, and keyboard shortcuts. No ads, no subscription, no account needed — join shared Time Together sessions with just a display name.",
};

export default function StopwatchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `md3-stopwatch-scope` scopes the MD3 sys-color tokens (md3-theme.css) to
  // this route subtree only — the rest of apps/web stays on the existing
  // `race-*` design language (AGENTS.md surface table). Do not move these
  // tokens onto `:root` or globals.css.
  return <div className="md3-stopwatch-scope">{children}</div>;
}
