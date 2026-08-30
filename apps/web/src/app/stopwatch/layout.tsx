import type { Metadata } from "next";

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
  return <>{children}</>;
}
