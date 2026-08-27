"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export function AuthStatus({ user, loading }: { user: User | null; loading: boolean }) {
  const router = useRouter();

  if (loading) return null;

  if (!user) {
    return (
      <Link href="/login" className="text-[11px] font-black uppercase tracking-wide text-race-muted hover:text-race-red">
        Sign in
      </Link>
    );
  }

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-[11px] font-bold uppercase tracking-wide text-race-muted sm:inline">
        Signed in as <span className="text-race-ink">{user.email}</span>
      </span>
      <button onClick={signOut} className="text-[11px] font-black uppercase tracking-wide text-race-muted hover:text-race-red">
        Sign out
      </button>
    </div>
  );
}
