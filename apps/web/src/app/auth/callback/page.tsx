"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { consumePendingAuthRedirect } from "@/lib/authRedirect";

function AuthCallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // `next` was carried via sessionStorage (set on /login before redirecting
    // to Google/email), not a `?next=` query string — Supabase's Redirect
    // URL allow-list only permits the bare /auth/callback URL, so any query
    // string on redirectTo fails validation and Supabase bounces to the
    // Site URL instead of here. Fall back to the query param for any old
    // links still in flight, then a sane default.
    const next = consumePendingAuthRedirect(params.get("next") || "/events");
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
