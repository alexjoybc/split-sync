"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function AuthCallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const next = params.get("next") || "/";
    const complete = () => router.replace(next);
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) complete();
    });

    const code = params.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
        if (exchangeError && active) setError("This sign-in link has expired or was already used. Request a new one.");
        else if (!exchangeError) complete();
      });
    } else {
      // Implicit flow: Supabase consumes the access-token hash asynchronously.
      // Do not redirect early or valid magic links will bounce back to /login.
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) complete();
      });
      const timeout = window.setTimeout(() => {
        if (active) setError("We could not finish signing you in. Request a new link from the same browser.");
      }, 5000);
      return () => {
        active = false;
        window.clearTimeout(timeout);
        listener.subscription.unsubscribe();
      };
    }

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [params, router]);
  return error ? <div className="text-center"><p className="text-sm font-black uppercase tracking-wide text-race-ink">{error}</p><a href="/login" className="race-action--muted mt-5 inline-block">Back to sign in</a></div> : <p className="text-sm font-black uppercase tracking-wide text-race-muted">Signing you in…</p>;
}

export default function AuthCallback() {
  return <main className="race-page grid place-items-center"><Suspense fallback={<p className="text-sm font-black uppercase tracking-wide text-race-muted">Signing you in…</p>}><AuthCallbackContent /></Suspense></main>;
}
