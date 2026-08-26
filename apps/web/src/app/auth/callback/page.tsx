"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function AuthCallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const code = params.get("code");
    if (!code) return router.replace("/login");
    supabase.auth.exchangeCodeForSession(code).then(() => router.replace("/"));
  }, [params, router]);
  return <p className="text-sm font-black uppercase tracking-wide text-race-muted">Signing you in…</p>;
}

export default function AuthCallback() {
  return <main className="race-page grid place-items-center"><Suspense fallback={<p className="text-sm font-black uppercase tracking-wide text-race-muted">Signing you in…</p>}><AuthCallbackContent /></Suspense></main>;
}
