"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (authError) setError(authError.message);
  };

  return <main className="race-page"><div className="race-topline" /><header className="race-masthead"><div className="mx-auto max-w-lg"><p className="race-kicker">Organizer access</p><h1 className="race-title">Sign in</h1></div></header><div className="mx-auto max-w-lg px-4 py-10 sm:px-6"><div className="race-panel p-5"><p className="text-sm text-race-muted">Sign in with your Google account to manage your events.</p>{error && <p className="mt-3 text-sm font-bold text-race-red">{error}</p>}<button onClick={signIn} className="race-action mt-4 w-full">Continue with Google</button></div></div></main>;
}
