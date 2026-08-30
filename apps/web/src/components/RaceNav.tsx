"use client";

import Link from "next/link";
import { useAuth } from "@/lib/useAuth";
import { AuthStatus } from "./AuthStatus";
import { Logo } from "./Logo";

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
    <nav className="border-b border-race-line bg-race-panel px-4 py-3 sm:px-6" aria-label="Primary navigation">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
        <Link href="/" className="hover:opacity-80"><Logo size="sm" /></Link>
        <div className="flex items-center gap-4">
          {links && links.length > 0 && links.map((link) => <Link key={link.href} href={link.href} className="text-[11px] font-black uppercase tracking-wide text-race-muted hover:text-race-red">{link.label}</Link>)}
          <Link href="/help" className="text-[11px] font-black uppercase tracking-wide text-race-muted hover:text-race-red">Help</Link>
          {showAuth && <RaceNavAuth />}
        </div>
      </div>
    </nav>
  );
}
