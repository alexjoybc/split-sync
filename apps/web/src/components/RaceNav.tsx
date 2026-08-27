"use client";

import Link from "next/link";
import { useAuth } from "@/lib/useAuth";
import { AuthStatus } from "./AuthStatus";

interface NavLink {
  href: string;
  label: string;
}

function RaceNavAuth() {
  const { user, loading } = useAuth();
  return <AuthStatus user={user} loading={loading} />;
}

export function RaceNav({ links, showAuth = false }: { links?: NavLink[]; showAuth?: boolean }) {
  return (
    <nav className="border-b border-zinc-300 bg-race-panel px-4 py-3 sm:px-6" aria-label="Primary navigation">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
        <Link href="/" className="text-sm font-black uppercase tracking-tight text-race-ink hover:text-race-red">SplitSync</Link>
        <div className="flex items-center gap-4">
          {links && links.length > 0 && links.map((link) => <Link key={link.href} href={link.href} className="text-[11px] font-black uppercase tracking-wide text-race-muted hover:text-race-red">{link.label}</Link>)}
          {showAuth && <RaceNavAuth />}
        </div>
      </div>
    </nav>
  );
}
