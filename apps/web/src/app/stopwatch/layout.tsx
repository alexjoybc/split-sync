import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stopwatch",
  description:
    "A solo stopwatch with lap recording, best-lap highlighting, and keyboard shortcuts. No sign-in required.",
};

export default function StopwatchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
